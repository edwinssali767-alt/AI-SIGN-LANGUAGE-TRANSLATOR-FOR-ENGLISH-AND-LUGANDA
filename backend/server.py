"""
Sign Language Translator - Backend Server
Main Flask application file
"""

from flask import Flask, request, jsonify, g, send_from_directory
from flask_cors import CORS
try:
    from flask_socketio import SocketIO, emit
    HAS_SOCKETIO = True
except ImportError:
    HAS_SOCKETIO = False
from dotenv import load_dotenv
import os
import smtplib
import threading
import base64
import json
import subprocess
import sys
import uuid
from email.message import EmailMessage
from pathlib import Path
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

# Load environment variables before importing Config because config.py reads
# os.environ while defining the Config class.
load_dotenv(Path(__file__).resolve().parent / '.env')
load_dotenv()

from config import Config, PROJECT_BACKEND_DIR, PROJECT_ROOT_DIR
from database import init_db, get_db, get_nairobi_time, close_mongo_or_sqlite
from gesture_processor import GestureProcessor
from mongodb_client import (
    get_admins_collection,
    get_gestures_collection,
    get_letters_collection,
    get_tutorials_collection,
    get_translations_collection,
    get_users_collection,
)
from translator import Translator


# Flask's built-in /static route would otherwise answer 404 for /static/signs/... and /static/audio/lg/...
# before the catch-all frontend route is reached, so point it at frontend/static.
app = Flask(__name__, static_folder=str(PROJECT_BACKEND_DIR.parent / 'frontend' / 'static'), static_url_path='/static')
app.config.from_object(Config)

# Windows can map these wrongly; browsers refuse ES modules / WASM with the wrong type.
import mimetypes
mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('application/wasm', '.wasm')
mimetypes.add_type('application/octet-stream', '.task')
# The frontend is served by this same app, so no cross-origin access is needed by default.
# To allow another origin (e.g. a separate dev server) set CORS_ORIGINS=http://host:port in .env.
_cors_origins = [o.strip() for o in os.getenv('CORS_ORIGINS', '').split(',') if o.strip()]
if _cors_origins:
    CORS(app, resources={r"/api/*": {"origins": _cors_origins}})

if HAS_SOCKETIO:
    socketio = SocketIO(app, cors_allowed_origins=_cors_origins or None)
else:
    socketio = None


def socketio_event(event):
    """Register a Socket.IO event only when Flask-SocketIO is installed."""
    if socketio is None:
        def decorator(func):
            return func
        return decorator
    return socketio.on(event)


FRONTEND_FOLDER = PROJECT_BACKEND_DIR.parent / 'frontend'
VIDEO_FOLDER = app.config['LEARNING_VIDEO_FOLDER']
PROJECT_DIRS = [
    app.config['DATASETS_DIR'],
    app.config['GESTURE_DATASET_DIR'],
    app.config['LETTER_DATASET_DIR'],
    app.config['MOTION_DATASET_DIR'],
    app.config['UPLOAD_FOLDER'],
    app.config['TRAINING_UPLOAD_FOLDER'],
    app.config['LEARNING_VIDEO_FOLDER'],
    app.config['MODEL_DIR'],
    str(PROJECT_ROOT_DIR / 'training'),
    str(PROJECT_ROOT_DIR / 'docs'),
]
for directory in PROJECT_DIRS:
    try:
        os.makedirs(directory, exist_ok=True)
    except OSError:
        pass  # read-only filesystem (e.g. Vercel): only needed for local training/uploads

# Initialize database. If it is unreachable (e.g. no internet), still start: the offline features
# (recognition, sentences, text to sign) do not use it. Login, history and admin lists need it.
try:
    init_db(app)
except Exception as exc:
    print(f'[WARN] Database unavailable at startup, accounts and history will not work until it is: {exc}')

# Register teardown handler
app.teardown_appcontext(close_mongo_or_sqlite)

# Initialize processors
gesture_processor = GestureProcessor()
motion_lock = threading.Lock()
translator = Translator()


@app.route('/')
def serve_frontend_index():
    return send_from_directory(FRONTEND_FOLDER, 'index.html')


@app.route('/<path:filename>')
def serve_frontend_file(filename):
    file_path = FRONTEND_FOLDER / filename
    if file_path.is_file():
        return send_from_directory(FRONTEND_FOLDER, filename)
    return jsonify({'error': 'Not found'}), 404


@app.route('/videos/<filename>')
def serve_learning_video(filename):
    return send_from_directory(
        VIDEO_FOLDER,
        filename
    )


def is_password_hashed(password):
    """Check whether a stored password appears to be hashed by Werkzeug."""
    if not password:
        return False
    return password.startswith('pbkdf2:') or password.startswith('scrypt:')


def verify_password(stored_password, raw_password):
    """Verify password while supporting legacy plain-text values for migration."""
    if not stored_password:
        return False
    if is_password_hashed(stored_password):
        return check_password_hash(stored_password, raw_password)
    return stored_password == raw_password


def generate_simple_auth_id(users):
    """Generate the next simple numeric user id for authentication responses."""
    highest_id = 0
    for user in users.find({}):
        for raw_id in (user.get('auth_id'), user.get('_id'), user.get('id')):
            auth_id = str(raw_id or '').strip()
            if auth_id.isdigit():
                highest_id = max(highest_id, int(auth_id))
    return str(highest_id + 1)


def ensure_user_auth_id(user_row):
    """Ensure a user has a public simple auth id, without exposing database ids."""
    if not user_row:
        return None

    auth_id = str(user_row.get('auth_id') or '').strip()
    if auth_id:
        return auth_id

    users = get_users_collection()
    for _ in range(10):
        auth_id = generate_simple_auth_id(users)
        try:
            users.update_one(
                {'_id': user_row['_id']},
                {'$set': {'auth_id': auth_id}}
            )
            user_row['auth_id'] = auth_id
            return auth_id
        except Exception as error:
            error_text = str(error).lower()
            if 'duplicate' not in error_text and 'unique' not in error_text:
                raise

    return str(user_row.get('_id'))


def get_public_user_id(user_row):
    """Return the simple id the frontend should store for a user."""
    if not user_row:
        return None
    return str(user_row.get('auth_id') or user_row.get('_id') or user_row.get('id'))


def make_user_token(user_row):
    """Build the simple non-JWT auth token used by this app."""
    auth_id = ensure_user_auth_id(user_row)
    return sign_token('user', auth_id) if auth_id else None


TOKEN_MAX_AGE_SECONDS = 7 * 24 * 3600


def _token_serializer():
    return URLSafeTimedSerializer(app.config['SECRET_KEY'], salt='auth-token')


def sign_token(kind, subject):
    """Create a signed, expiring token like 'user_<signed payload>'."""
    return f"{kind}_{_token_serializer().dumps({'k': kind, 'id': str(subject)})}"


def _read_token(token, kind):
    """Return the subject id of a valid signed token of this kind, else None."""
    if not token or not token.startswith(f'{kind}_'):
        return None
    try:
        data = _token_serializer().loads(token.split('_', 1)[1], max_age=TOKEN_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    if not isinstance(data, dict) or data.get('k') != kind:
        return None
    return str(data.get('id') or '') or None


def is_valid_admin_token(token):
    """Validate a signed admin token."""
    return _read_token(token, 'admin') is not None


def get_user_id_from_token(token):
    """Extract the user id from a signed user token."""
    return _read_token(token, 'user')


def to_object_id(raw_id):
    """Convert Mongo ObjectId strings when possible while keeping SQLite ids usable."""
    try:
        from bson import ObjectId
        return ObjectId(str(raw_id))
    except Exception:
        return raw_id


def find_by_id(collection, raw_id):
    """Find a row/document by its public id."""
    return collection.find_one({'_id': to_object_id(raw_id)})


def sanitize_label(value):
    """Normalize a gesture or dataset label into a filesystem-safe slug."""
    label = str(value or '').strip().lower().replace(' ', '_')
    safe = ''.join(char for char in label if char.isalnum() or char in {'_', '-'})
    return safe.strip('_-')


def safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def get_free_translation_limit():
    """Return the free translation quota for basic accounts."""
    return int(app.config.get('FREE_TRANSLATION_LIMIT', 10))


def get_guest_translation_limit():
    """Return the free translation quota for guests."""
    return int(app.config.get('GUEST_TRANSLATION_LIMIT', 3))


def build_guest_subscription_payload(translations_used=0):
    """Build a local guest quota snapshot."""
    free_limit = get_guest_translation_limit()
    used = max(safe_int(translations_used), 0)
    return {
        'user_id': None,
        'tier': 'guest',
        'translations_used': used,
        'translation_limit': free_limit,
        'translations_remaining': max(free_limit - used, 0),
        'is_premium': False,
        'can_translate': used < free_limit,
        'requires_upgrade': used >= free_limit
    }


def get_user_row(user_id):
    """Fetch a user row with subscription details."""
    if user_id is None:
        return None

    users = get_users_collection()
    raw_id = str(user_id).strip()
    if not raw_id:
        return None

    user = users.find_one({'auth_id': raw_id})
    if user:
        return user

    return users.find_one({'_id': to_object_id(raw_id)})


def get_user_identity_values(user_id):
    """Return all ids that may identify a user in legacy and current records."""
    values = set()
    if user_id is not None and not isinstance(user_id, dict):
        values.add(str(user_id))

    user_row = user_id if isinstance(user_id, dict) else get_user_row(user_id)
    if user_row:
        if user_row.get('_id') is not None:
            values.add(str(user_row.get('_id')))
        if user_row.get('auth_id'):
            values.add(str(user_row.get('auth_id')))

    return [value for value in values if value]


def user_ids_match(first_user_id, second_user_id):
    """Compare public or legacy user ids for the same account."""
    first_values = set(get_user_identity_values(first_user_id))
    second_values = set(get_user_identity_values(second_user_id))
    return bool(first_values and second_values and first_values.intersection(second_values))


def get_user_translation_count(user_id):
    """Count all successful translation events recorded for a user."""
    translations = get_translations_collection()
    identity_values = get_user_identity_values(user_id)
    if not identity_values:
        return 0
    return int(translations.count_documents({'user_id': {'$in': identity_values}}))


def build_subscription_payload(user_row):
    """Build a subscription snapshot for the frontend."""
    if not user_row:
        return None
    
    tier = (user_row.get('subscription_tier') or 'basic').lower()
    user_id = get_public_user_id(user_row)
    translations_used = get_user_translation_count(user_row)
    free_limit = get_free_translation_limit()
    is_premium = tier == 'premium'
    can_translate = is_premium or translations_used < free_limit
    
    return {
        'user_id': str(user_id),
        'tier': tier,
        'translations_used': translations_used,
        'translation_limit': None if is_premium else free_limit,
        'translations_remaining': None if is_premium else max(free_limit - translations_used, 0),
        'is_premium': is_premium,
        'can_translate': can_translate,
        'requires_upgrade': not is_premium and translations_used >= free_limit
    }


def get_user_subscription_payload(user_id):
    """Fetch the latest subscription snapshot for a user id."""
    user_row = get_user_row(user_id)
    return build_subscription_payload(user_row)


def get_request_subscription(user_id, request_data):
    """Validate the current actor can translate and return a subscription snapshot."""
    if user_id:
        return ensure_user_can_translate(user_id)

    guest_used = safe_int((request_data or {}).get('guest_translations_used'), 0)
    guest_subscription = build_guest_subscription_payload(guest_used)
    if not guest_subscription['can_translate']:
        return None, (
            jsonify({
                'error': 'Your guest translation limit has been reached. Create an account or upgrade to continue.',
                'subscription': guest_subscription
            }),
            403
        )

    return guest_subscription, None


def build_translation_response(detected_gesture, target_language='english', extra=None):
    """Create the standard bilingual translation payload for API responses."""
    translations = translator.translate_all(detected_gesture) or {}
    language = (target_language or 'english').lower()
    payload = {
        'gesture': detected_gesture,
        'english': translations.get('english'),
        'luganda': translations.get('luganda'),
        'translation': translations.get(language) or translations.get('english'),
        'language': language,
    }
    if extra:
        payload.update(extra)
    return payload


def log_translation(
    detected_gesture,
    target_language,
    user_id=None,
    source_language='gesture',
    english_translation=None,
    luganda_translation=None,
    word=None,
):
    """Persist translation event for history and analytics."""
    if not user_id:
        return

    translations = get_translations_collection()
    gestures = get_gestures_collection()
    
    gesture_id = None
    if detected_gesture:
        gesture_doc = gestures.find_one({'gesture_name': detected_gesture})
        if gesture_doc:
            gesture_id = str(gesture_doc['_id'])
    
    user_row = get_user_row(user_id)
    stored_user_id = get_public_user_id(user_row) or str(user_id)

    translations.insert_one({
        'gesture_id': gesture_id,
        'gesture': detected_gesture,
        'user_id': stored_user_id,
        'source_language': source_language,
        'target_language': target_language,
        'english_translation': english_translation,
        'luganda_translation': luganda_translation,
        'word': word,
        'timestamp': get_nairobi_time()
    })


def ensure_user_can_translate(user_id):
    """Validate the account can still use translations."""
    subscription = get_user_subscription_payload(user_id)
    if not subscription:
        return None, (jsonify({'error': 'User not found'}), 404)

    if not subscription['can_translate']:
        return None, (
            jsonify({
                'error': 'Your free 10-translation limit has been reached. Upgrade to Premium or complete payment to continue.',
                'subscription': subscription
            }),
            403
        )

    return subscription, None


def send_welcome_login_email(recipient_email, username):
    """Send a welcome-back email after successful login if SMTP is configured."""
    if not app.config.get('SEND_LOGIN_WELCOME_EMAIL', True):
        return {'sent': False, 'reason': 'disabled'}

    smtp_host = app.config.get('SMTP_HOST')
    smtp_username = app.config.get('SMTP_USERNAME')
    smtp_password = app.config.get('SMTP_PASSWORD')
    smtp_port = app.config.get('SMTP_PORT', 587)
    email_from = app.config.get('EMAIL_FROM')

    # Allow running without mail credentials while keeping login successful.
    if not smtp_host or not smtp_username or not smtp_password or not email_from:
        return {'sent': False, 'reason': 'smtp_not_configured'}

    message = EmailMessage()
    message['Subject'] = 'Welcome to Sign Language Translator'
    message['From'] = email_from
    message['To'] = recipient_email
    message.set_content(
        f"Hello {username},\n\n"
        "Welcome to the Sign Language Translator website. "
        "We are happy to have you back.\n\n"
        "You can continue translating gestures and managing your profile anytime.\n\n"
        "Best regards,\n"
        "Sign Language Translator Team"
    )

    with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as smtp:
        if app.config.get('SMTP_USE_TLS', True):
            smtp.starttls()
        smtp.login(smtp_username, smtp_password)
        smtp.send_message(message)

    return {'sent': True}


def relative_path(path):
    """Return a readable project-relative path."""
    try:
        return str(Path(path).resolve().relative_to(PROJECT_ROOT_DIR)).replace('\\', '/')
    except Exception:
        return str(path).replace('\\', '/')


def active_file(primary_path, fallback_path=None):
    """Return the preferred existing file path for a model/scaler."""
    primary = Path(primary_path)
    fallback = Path(fallback_path) if fallback_path else None
    if primary.exists():
        return primary
    if fallback and fallback.exists():
        return fallback
    return primary


def model_file_info(name, primary_model, fallback_model=None, scaler=None, fallback_scaler=None):
    """Build active model metadata for admin/status screens."""
    model_path = active_file(primary_model, fallback_model)
    scaler_path = active_file(scaler, fallback_scaler) if scaler else None
    exists = model_path.exists()
    return {
        'name': name,
        'model_path': relative_path(model_path),
        'scaler_path': relative_path(scaler_path) if scaler_path else None,
        'exists': exists,
        'last_trained': get_file_timestamp(model_path) if exists else None,
        'version': str(int(model_path.stat().st_mtime)) if exists else None,
        'size_bytes': model_path.stat().st_size if exists else 0,
    }


def get_file_timestamp(path):
    """Format a file's modified time using the app timezone."""
    if not path or not Path(path).exists():
        return None

    from datetime import datetime
    import pytz

    timezone = pytz.timezone('Africa/Nairobi')
    return datetime.fromtimestamp(Path(path).stat().st_mtime, timezone).strftime('%Y-%m-%d %H:%M:%S')


def get_active_models():
    """Return the currently active prediction models."""
    legacy_model_dir = Path(app.config['LEGACY_MODEL_DIR'])
    return [
        model_file_info(
            'gesture',
            app.config['STATIC_GESTURE_MODEL'],
            legacy_model_dir / 'gesture_model.pkl',
            app.config['STATIC_SCALER'],
            legacy_model_dir / 'scaler.pkl',
        ),
        model_file_info(
            'motion',
            app.config['DYNAMICS_GESTURE_MODEL'],
            legacy_model_dir / 'gesture_dynamics_model.pkl',
            app.config['DYNAMICS_SCALER'],
            legacy_model_dir / 'dynamics_scaler.pkl',
        ),
        model_file_info(
            'letter',
            app.config['LETTER_MODEL'],
            legacy_model_dir / 'letter_model.pkl',
            app.config['LETTER_SCALER'],
            legacy_model_dir / 'letter_scaler.pkl',
        ),
    ]


def count_sample_files(folder, extensions):
    """Count files in one sample directory matching the given extensions."""
    if not folder.exists():
        return 0
    return sum(1 for file_path in folder.iterdir() if file_path.is_file() and file_path.suffix.lower() in extensions)


def latest_child_timestamp(folder):
    """Return the newest modified timestamp from files in a folder."""
    if not folder.exists():
        return None
    files = [file_path for file_path in folder.iterdir() if file_path.is_file()]
    if not files:
        return None
    newest = max(files, key=lambda file_path: file_path.stat().st_mtime)
    return get_file_timestamp(newest)


def list_dataset_folders(dataset_path, dataset_type, extensions):
    """Build per-gesture rows for a dataset path."""
    base = Path(dataset_path)
    rows = []
    if not base.exists():
        return rows

    for child in sorted(base.iterdir(), key=lambda item: item.name.lower()):
        if not child.is_dir():
            continue
        rows.append({
            'gesture': child.name,
            'dataset_type': dataset_type,
            'dataset_path': relative_path(child),
            'sample_count': count_sample_files(child, extensions),
            'last_sample_at': latest_child_timestamp(child),
        })
    return rows


def get_training_status_rows():
    """Return status rows covering canonical and legacy datasets."""
    rows = []
    rows.extend(list_dataset_folders(app.config['GESTURE_DATASET_DIR'], 'gesture', {'.jpg', '.jpeg', '.png'}))
    rows.extend(list_dataset_folders(app.config['LETTER_DATASET_DIR'], 'letter', {'.jpg', '.jpeg', '.png'}))
    rows.extend(list_dataset_folders(app.config['MOTION_DATASET_DIR'], 'motion', {'.npy', '.json'}))
    rows.extend(list_dataset_folders(app.config['LEGACY_GESTURE_DATASET_DIR'], 'legacy_gesture', {'.jpg', '.jpeg', '.png'}))
    rows.extend(list_dataset_folders(app.config['LEGACY_MOTION_DATASET_DIR'], 'legacy_motion', {'.npy'}))

    active_models = {model['name']: model for model in get_active_models()}
    for row in rows:
        model_key = 'motion' if 'motion' in row['dataset_type'] else 'letter' if row['dataset_type'] == 'letter' else 'gesture'
        model = active_models.get(model_key, {})
        row['model_used'] = model.get('model_path')
        row['last_trained'] = model.get('last_trained')
        row['model_status'] = 'Trained' if model.get('exists') else 'Not trained'
        row['accuracy'] = None
    return rows


def get_training_map():
    """Describe the end-to-end training path."""
    return [
        {
            'dataset_folder': 'datasets/gestures/<gesture>',
            'training_script': 'backend/train_gesture_model.py',
            'model_file': 'models/gesture_model.pkl',
            'prediction_endpoint': '/api/translate',
            'frontend': 'frontend/translator.html',
        },
        {
            'dataset_folder': 'datasets/gesture_motion/<gesture>',
            'training_script': 'backend/train_gesture_dynamics.py',
            'model_file': 'models/gesture_dynamics_model.pkl',
            'prediction_endpoint': '/api/translate-motion',
            'frontend': 'frontend/translator.html',
        },
        {
            'dataset_folder': 'datasets/letters/<letter>',
            'training_script': 'backend/train_gesture_model.py',
            'model_file': 'models/letter_model.pkl',
            'prediction_endpoint': '/api/recognize-letter',
            'frontend': 'frontend/letters.html',
        },
    ]


def next_sample_index(gesture_folder):
    """Return the next numeric sample index for a gesture folder."""
    existing_indexes = []
    for file_path in gesture_folder.glob('sample_*.*'):
        stem = file_path.stem.replace('sample_', '')
        if stem.isdigit():
            existing_indexes.append(int(stem))
    return max(existing_indexes, default=-1) + 1


def save_training_image(gesture_label, frame_base64):
    """Save a base64 image into the canonical gesture dataset."""
    gesture_folder = Path(app.config['GESTURE_DATASET_DIR']) / gesture_label
    gesture_folder.mkdir(parents=True, exist_ok=True)
    sample_id = next_sample_index(gesture_folder)
    frame_data = frame_base64.split(',', 1)[1] if ',' in frame_base64 else frame_base64
    frame_bytes = base64.b64decode(frame_data)
    image_path = gesture_folder / f'sample_{sample_id}.jpg'
    meta_path = gesture_folder / f'sample_{sample_id}.json'
    image_path.write_bytes(frame_bytes)
    meta_path.write_text(json.dumps({
        'gesture': gesture_label,
        'sample_id': sample_id,
        'filename': image_path.name,
        'captured_at': get_nairobi_time(),
        'source': 'admin_panel',
    }), encoding='utf-8')
    return image_path


def run_training_script(model_type):
    """Run the training script for a model type and reload models when it succeeds."""
    if model_type not in {'gesture', 'motion', 'letter'}:
        return {'success': False, 'error': 'Invalid model type'}

    script = 'train_gesture_dynamics.py' if model_type == 'motion' else 'train_gesture_model.py'
    env = os.environ.copy()
    if model_type == 'letter':
        env['TRAINING_DATA_DIR'] = app.config['LETTER_DATASET_DIR']
        env['TRAINING_MODEL_FILE'] = app.config['LETTER_MODEL']
        env['TRAINING_SCALER_FILE'] = app.config['LETTER_SCALER']
    elif model_type == 'motion':
        env['TRAINING_DATA_DIR'] = app.config['MOTION_DATASET_DIR']
        env['TRAINING_MODEL_FILE'] = app.config['DYNAMICS_GESTURE_MODEL']
        env['TRAINING_SCALER_FILE'] = app.config['DYNAMICS_SCALER']
    else:
        env['TRAINING_DATA_DIR'] = app.config['GESTURE_DATASET_DIR']
        env['TRAINING_MODEL_FILE'] = app.config['STATIC_GESTURE_MODEL']
        env['TRAINING_SCALER_FILE'] = app.config['STATIC_SCALER']

    result = subprocess.run(
        [sys.executable, script],
        cwd=PROJECT_BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )

    if result.returncode == 0:
        gesture_processor.load_models()

    return {
        'success': result.returncode == 0,
        'model_type': model_type,
        'returncode': result.returncode,
        'stdout': result.stdout[-4000:],
        'stderr': result.stderr[-4000:],
    }


def serialize_tutorial(tutorial):
    """Serialize a tutorial video row/document for JSON responses."""
    if not tutorial:
        return None

    filename = tutorial.get('filename')
    return {
        'id': str(tutorial.get('_id')),
        'title': tutorial.get('title'),
        'description': tutorial.get('description') or '',
        'access_level': tutorial.get('access_level') or 'free',
        'order_index': safe_int(tutorial.get('order_index'), 0),
        'filename': filename,
        'url': tutorial.get('url') or (f'/videos/{filename}' if filename else ''),
        'created_at': tutorial.get('created_at'),
        'updated_at': tutorial.get('updated_at'),
    }


@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'message': 'Backend is running'}), 200


@app.route('/api/translate', methods=['POST'])
def translate_gesture():
    """
    Process gesture image and return translation
    Expected: gesture_image (base64 or file)
    """
    try:
        data = request.get_json(silent=True) or {}
        token = request.headers.get('Authorization')
        user_id = get_user_id_from_token(token)
        gesture_data = data.get('gesture_image')
        target_language = data.get('target_language', 'english')

        subscription, error_response = get_request_subscription(user_id, data)
        if error_response:
            return error_response
        
        if not gesture_data:
            return jsonify({'error': 'No gesture image provided'}), 400
        
        # Process gesture
        detected_gesture = gesture_processor.process_gesture(gesture_data)
        
        if not detected_gesture:
            return jsonify({'error': 'Could not detect gesture. Please try again.'}), 400
        
        response_payload = build_translation_response(detected_gesture, target_language)
        log_translation(
            detected_gesture,
            target_language,
            user_id,
            english_translation=response_payload.get('english'),
            luganda_translation=response_payload.get('luganda'),
        )

        response_payload['subscription'] = (
            get_user_subscription_payload(user_id)
            if user_id
            else build_guest_subscription_payload(subscription['translations_used'] + 1)
        )
        return jsonify(response_payload), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/translate-motion', methods=['POST'])
def translate_gesture_motion():
    """
    Process gesture MOTION (multiple frames) and return translation
    Expected: gesture_frames (list of base64 images)
    """
    try:
        data = request.get_json(silent=True) or {}
        token = request.headers.get('Authorization')
        user_id = get_user_id_from_token(token)
        gesture_frames = data.get('gesture_frames', [])
        target_language = data.get('target_language', 'english')

        subscription, error_response = get_request_subscription(user_id, data)
        if error_response:
            return error_response
        
        if not gesture_frames or len(gesture_frames) == 0:
            return jsonify({'error': 'No gesture frames provided'}), 400
        
        # Process each frame to build motion history
        print(f"Processing {len(gesture_frames)} frames for motion analysis...")
        
        detected_gesture = None

        # One request at a time may use the shared frame buffer, and it always starts empty,
        # so different users' frames never mix.
        with motion_lock:
            gesture_processor.frame_buffer.clear()
            for i, frame_data in enumerate(gesture_frames):
                gesture_processor.add_frame(frame_data)
                if gesture_processor.has_enough_frames():
                    detected_gesture = gesture_processor.predict_motion_gesture()
                    if detected_gesture:
                        print(f"Gesture recognized after frame {i+1}: {detected_gesture}")
                        break

        if not detected_gesture:
            if gesture_frames:
                midpoint_index = len(gesture_frames) // 2
                detected_gesture = gesture_processor.predict_static_gesture(gesture_frames[midpoint_index])

        if not detected_gesture:
            return jsonify({'error': 'Could not recognize gesture from motion. Please try again.'}), 400
        
        response_payload = build_translation_response(
            detected_gesture,
            target_language,
            {'frames_processed': len(gesture_frames)}
        )
        log_translation(
            detected_gesture,
            target_language,
            user_id,
            english_translation=response_payload.get('english'),
            luganda_translation=response_payload.get('luganda'),
        )

        response_payload['subscription'] = (
            get_user_subscription_payload(user_id)
            if user_id
            else build_guest_subscription_payload(subscription['translations_used'] + 1)
        )
        return jsonify(response_payload), 200
        
    except Exception as e:
        print(f"Error in translate_gesture_motion: {e}")
        return jsonify({'error': str(e)}), 500


@socketio_event('start_realtime')
def handle_realtime_start(data):
    """Start real-time gesture recognition session."""
    token = data.get('token')
    user_id = get_user_id_from_token(token)
    target_language = data.get('target_language', 'english')
    
    if not user_id:
        emit('realtime_error', {'error': 'Authentication required'})
        return
    
    subscription, error_response = ensure_user_can_translate(user_id)
    if error_response:
        emit('realtime_error', error_response[0].get_json())
        return
    
    emit('realtime_status', {'status': 'ready', 'message': 'Real-time translation ready'})


@socketio_event('realtime_frame')
def handle_realtime_frame(data):
    """Process a single frame for real-time gesture recognition."""
    token = data.get('token')
    user_id = get_user_id_from_token(token)
    frame_data = data.get('frame')

    if not user_id:
        emit('realtime_error', {'error': 'Authentication required'})
        return

    subscription, error_response = ensure_user_can_translate(user_id)
    if error_response:
        emit('realtime_limit', error_response[0].get_json())
        return

    if not frame_data:
        emit('realtime_error', {'error': 'No frame data'})
        return

    import time
    start_time = time.time()

    detected_gesture, confidence = gesture_processor.predict_static_gesture(frame_data, with_confidence=True)

    english_translation = None
    luganda_translation = None

    if detected_gesture:
        english_translation = translator.translate(detected_gesture, 'english')
        luganda_translation = translator.translate(detected_gesture, 'luganda')

    elapsed_ms = (time.time() - start_time) * 1000

    emit('realtime_result', {
        'gesture': detected_gesture,
        'english': english_translation,
        'luganda': luganda_translation,
        'confidence': confidence,
        'speed': round(elapsed_ms, 2)
    })


@socketio_event('stop_realtime')
def handle_realtime_stop():
    """Stop real-time gesture recognition session."""
    emit('realtime_status', {'status': 'stopped', 'message': 'Real-time translation stopped'})


@app.route('/api/gestures', methods=['GET'])
def get_gestures():
    """Get all available gestures"""
    try:
        gestures = get_gestures_collection()
        gesture_list = [
            {
                'id': str(g.get('_id')),
                'gesture_name': g.get('gesture_name'),
                'english_meaning': g.get('english_meaning'),
                'luganda_meaning': g.get('luganda_meaning')
            } for g in gestures.find({})
        ]
        
        return jsonify({'gestures': gesture_list}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/gestures/<gesture_id>', methods=['GET'])
def get_gesture(gesture_id):
    """Get specific gesture details"""
    try:
        gestures = get_gestures_collection()
        gesture = find_by_id(gestures, gesture_id)
        
        if not gesture:
            return jsonify({'error': 'Gesture not found'}), 404
        
        return jsonify({
            'id': str(gesture.get('_id')),
            'gesture_name': gesture.get('gesture_name'),
            'english_meaning': gesture.get('english_meaning'),
            'luganda_meaning': gesture.get('luganda_meaning'),
            'description': gesture.get('description')
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============ ADMIN ENDPOINTS ============

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    """Admin login endpoint"""
    try:
        data = request.get_json(silent=True) or {}
        username = data.get('username')
        password = data.get('password')
        
        admin_users = get_admins_collection()
        
        # Check environment-based admin credentials
        env_admin_user = app.config.get('ADMIN_USERNAME')
        env_admin_pass = app.config.get('ADMIN_PASSWORD')
        if env_admin_user and env_admin_pass and username == env_admin_user and password == env_admin_pass:
            user = admin_users.find_one({'username': username})
            
            if not user:
                # Create admin user from env if doesn't exist
                result = admin_users.insert_one({
                    'username': username,
                    'password': generate_password_hash(password),
                    'created_at': get_nairobi_time(),
                    'last_login_at': get_nairobi_time()
                })
                user_id = result.inserted_id
                user_name = username
            else:
                user_id = user['_id']
                user_name = user['username']
                admin_users.update_one(
                    {'_id': user_id},
                    {'$set': {'last_login_at': get_nairobi_time()}}
                )
            
            return jsonify({
                'success': True,
                'admin_id': str(user_id),
                'username': user_name,
                'token': sign_token('admin', user_id)
            }), 200
        
        user = admin_users.find_one({'username': username})
        
        if not user or not verify_password(user['password'], password):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        admin_users.update_one(
            {'_id': user['_id']},
            {'$set': {'last_login_at': get_nairobi_time()}}
        )
        
        return jsonify({
            'success': True,
            'admin_id': str(user['_id']),
            'username': user['username'],
            'token': sign_token('admin', user['_id'])
        }), 200
    except Exception as e:
        print(f"Admin login error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/gestures', methods=['POST'])
def admin_add_gesture():
    """Add new gesture (Admin only)"""
    try:
        data = request.get_json(silent=True) or {}
        token = request.headers.get('Authorization')
        
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401
        
        gesture_name = data.get('gesture_name')
        english_meaning = data.get('english_meaning')
        luganda_meaning = data.get('luganda_meaning')
        description = data.get('description', '')
        
        gestures = get_gestures_collection()
        result = gestures.insert_one({
            'gesture_name': gesture_name,
            'english_meaning': english_meaning,
            'luganda_meaning': luganda_meaning,
            'description': description,
            'created_at': get_nairobi_time()
        })
        
        return jsonify({'success': True, 'gesture_id': str(result.inserted_id)}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/gestures/<gesture_id>', methods=['PUT'])
def admin_update_gesture(gesture_id):
    """Update gesture (Admin only)"""
    try:
        data = request.get_json(silent=True) or {}
        token = request.headers.get('Authorization')
        
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401
        
        gestures = get_gestures_collection()

        gestures.update_one(
            {'_id': to_object_id(gesture_id)},
            {'$set': {
                'gesture_name': data.get('gesture_name'),
                'english_meaning': data.get('english_meaning'),
                'luganda_meaning': data.get('luganda_meaning'),
                'description': data.get('description', '')
            }}
        )
        
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/gestures/<gesture_id>', methods=['DELETE'])
def admin_delete_gesture(gesture_id):
    """Delete gesture (Admin only)"""
    try:
        token = request.headers.get('Authorization')
        
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401
        
        gestures = get_gestures_collection()

        gestures.delete_one({'_id': to_object_id(gesture_id)})
        
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/stats', methods=['GET'])
def admin_stats():
    """Get admin statistics"""
    try:
        token = request.headers.get('Authorization')
        
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401
        
        users = get_users_collection()
        gestures = get_gestures_collection()
        translations = get_translations_collection()
        
        total_gestures = gestures.count_documents({})
        total_translations = translations.count_documents({})
        total_users = users.count_documents({})
        logged_in_users = users.count_documents({'is_online': 1})
        
        return jsonify({
            'total_gestures': total_gestures,
            'total_translations': total_translations,
            'total_users': total_users,
            'logged_in_users': logged_in_users,
            'active_models': get_active_models()
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/translations', methods=['GET'])
def admin_get_translations():
    """Return recent translation history for admin analytics."""
    try:
        token = request.headers.get('Authorization')
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401

        translations = get_translations_collection()
        rows = []
        user_cache = {}  # one lookup per distinct user instead of one per row
        for item in translations.find({}).sort('timestamp', -1).limit(100):
            uid = item.get('user_id')
            if uid and uid not in user_cache:
                user_cache[uid] = get_user_row(uid)
            user_doc = user_cache.get(uid) if uid else None
            rows.append({
                'id': str(item.get('_id')),
                'user': user_doc.get('username') if user_doc else 'Guest/Unknown',
                'gesture': item.get('gesture') or item.get('word') or 'Spelled Word',
                'english': item.get('english_translation'),
                'luganda': item.get('luganda_translation'),
                'source_language': item.get('source_language'),
                'target_language': item.get('target_language'),
                'timestamp': item.get('timestamp'),
            })
        return jsonify({'translations': rows}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/training/status', methods=['GET'])
def admin_training_status():
    """Return dataset counts, training map, and model status."""
    try:
        token = request.headers.get('Authorization')
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401

        return jsonify({
            'datasets': get_training_status_rows(),
            'models': get_active_models(),
            'training_map': get_training_map(),
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/models/active', methods=['GET'])
def admin_active_models():
    """Return the active model versions used by prediction endpoints."""
    try:
        token = request.headers.get('Authorization')
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401

        return jsonify({'models': get_active_models()}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/train-model', methods=['POST'])
def admin_run_training():
    """Run a model training script from the admin panel."""
    try:
        token = request.headers.get('Authorization')
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401

        data = request.get_json(silent=True) or {}
        result = run_training_script((data.get('model_type') or 'gesture').lower())
        status_code = 200 if result.get('success') else 400
        return jsonify(result), status_code
    except subprocess.TimeoutExpired:
        return jsonify({'success': False, 'error': 'Training timed out after 5 minutes'}), 504
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/admin/training/upload-image', methods=['POST'])
def admin_upload_training_image():
    """Upload one gesture image into the canonical dataset."""
    try:
        token = request.headers.get('Authorization')
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401

        gesture_label = sanitize_label(request.form.get('gesture_label') or request.form.get('gesture_name'))
        file = request.files.get('image')
        if not gesture_label or not file:
            return jsonify({'error': 'Gesture label and image are required'}), 400

        gesture_folder = Path(app.config['GESTURE_DATASET_DIR']) / gesture_label
        gesture_folder.mkdir(parents=True, exist_ok=True)
        sample_id = next_sample_index(gesture_folder)
        image_filename = f'sample_{sample_id}{Path(secure_filename(file.filename)).suffix.lower() or ".jpg"}'
        image_path = gesture_folder / image_filename
        file.save(image_path)
        (gesture_folder / f'sample_{sample_id}.json').write_text(json.dumps({
            'gesture': gesture_label,
            'sample_id': sample_id,
            'filename': image_filename,
            'captured_at': get_nairobi_time(),
            'source': 'admin_upload',
        }), encoding='utf-8')

        return jsonify({
            'success': True,
            'gesture_label': gesture_label,
            'dataset_path': relative_path(gesture_folder),
            'sample_file': image_filename,
            'sample_count': count_sample_files(gesture_folder, {'.jpg', '.jpeg', '.png'}),
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/training/upload-video', methods=['POST'])
def admin_upload_training_video():
    """Upload a gesture video and extract frames into the canonical dataset when OpenCV is available."""
    try:
        token = request.headers.get('Authorization')
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401

        gesture_label = sanitize_label(request.form.get('gesture_label') or request.form.get('gesture_name'))
        file = request.files.get('video')
        if not gesture_label or not file:
            return jsonify({'error': 'Gesture label and video are required'}), 400

        upload_folder = Path(app.config['TRAINING_UPLOAD_FOLDER']) / gesture_label
        upload_folder.mkdir(parents=True, exist_ok=True)
        video_filename = f'{uuid.uuid4().hex[:8]}_{secure_filename(file.filename)}'
        video_path = upload_folder / video_filename
        file.save(video_path)

        extracted_frames = 0
        try:
            import cv2

            capture = cv2.VideoCapture(str(video_path))
            gesture_folder = Path(app.config['GESTURE_DATASET_DIR']) / gesture_label
            gesture_folder.mkdir(parents=True, exist_ok=True)
            frame_index = 0
            while extracted_frames < 30:
                success, frame = capture.read()
                if not success:
                    break
                if frame_index % 5 == 0:
                    sample_id = next_sample_index(gesture_folder)
                    frame_file = gesture_folder / f'sample_{sample_id}.jpg'
                    cv2.imwrite(str(frame_file), frame)
                    (gesture_folder / f'sample_{sample_id}.json').write_text(json.dumps({
                        'gesture': gesture_label,
                        'sample_id': sample_id,
                        'filename': frame_file.name,
                        'captured_at': get_nairobi_time(),
                        'source': 'admin_video_upload',
                        'source_video': relative_path(video_path),
                    }), encoding='utf-8')
                    extracted_frames += 1
                frame_index += 1
            capture.release()
        except Exception as frame_error:
            print(f'Video frame extraction skipped: {frame_error}')

        return jsonify({
            'success': True,
            'gesture_label': gesture_label,
            'video_path': relative_path(video_path),
            'frames_extracted': extracted_frames,
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/training/samples/<gesture_label>/<filename>', methods=['DELETE'])
def admin_delete_training_sample(gesture_label, filename):
    """Delete a bad sample from the canonical gesture dataset."""
    try:
        token = request.headers.get('Authorization')
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401

        safe_gesture = sanitize_label(gesture_label)
        safe_filename = secure_filename(filename)
        gesture_folder = Path(app.config['GESTURE_DATASET_DIR']) / safe_gesture
        sample_path = (gesture_folder / safe_filename).resolve()
        if not str(sample_path).startswith(str(gesture_folder.resolve())):
            return jsonify({'error': 'Invalid sample path'}), 400

        deleted = False
        if sample_path.exists() and sample_path.is_file():
            sample_path.unlink()
            deleted = True
        meta_path = sample_path.with_suffix('.json')
        if meta_path.exists() and meta_path.is_file():
            meta_path.unlink()

        return jsonify({'success': deleted, 'sample_count': count_sample_files(gesture_folder, {'.jpg', '.jpeg', '.png'})}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/tutorials', methods=['GET', 'POST'])
def admin_tutorials():
    """List or create tutorial videos."""
    try:
        token = request.headers.get('Authorization')
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401

        tutorials = get_tutorials_collection()

        if request.method == 'GET':
            rows = [serialize_tutorial(item) for item in tutorials.find({}).sort('order_index', 1)]
            return jsonify({'tutorials': rows}), 200

        title = request.form.get('title', '').strip()
        description = request.form.get('description', '').strip()
        access_level = request.form.get('access_level', 'free').strip().lower()
        order_index = safe_int(request.form.get('order_index'), 0)
        video_file = request.files.get('video')

        if access_level not in {'free', 'premium'}:
            return jsonify({'error': 'Invalid access level'}), 400
        if not title:
            return jsonify({'error': 'Video title is required'}), 400
        if not video_file:
            return jsonify({'error': 'Video file is required'}), 400

        filename = f'{uuid.uuid4().hex[:8]}_{secure_filename(video_file.filename)}'
        file_path = Path(VIDEO_FOLDER) / filename
        video_file.save(file_path)

        now = get_nairobi_time()
        result = tutorials.insert_one({
            'title': title,
            'description': description,
            'access_level': access_level,
            'order_index': order_index,
            'filename': filename,
            'url': f'/videos/{filename}',
            'created_at': now,
            'updated_at': now,
        })

        return jsonify({
            'success': True,
            'tutorial': serialize_tutorial(tutorials.find_one({'_id': result.inserted_id})),
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/tutorials/<tutorial_id>', methods=['PUT', 'DELETE'])
def admin_tutorial_detail(tutorial_id):
    """Update or delete a tutorial video."""
    try:
        token = request.headers.get('Authorization')
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401

        tutorials = get_tutorials_collection()
        tutorial = find_by_id(tutorials, tutorial_id)
        if not tutorial:
            return jsonify({'error': 'Tutorial not found'}), 404

        if request.method == 'DELETE':
            filename = tutorial.get('filename')
            if filename:
                file_path = (Path(VIDEO_FOLDER) / secure_filename(filename)).resolve()
                if str(file_path).startswith(str(Path(VIDEO_FOLDER).resolve())) and file_path.exists():
                    file_path.unlink()
            tutorials.delete_one({'_id': to_object_id(tutorial_id)})
            return jsonify({'success': True}), 200

        data = request.get_json(silent=True) or {}
        updates = {
            'title': data.get('title', tutorial.get('title')),
            'description': data.get('description', tutorial.get('description', '')),
            'access_level': data.get('access_level', tutorial.get('access_level', 'free')),
            'order_index': safe_int(data.get('order_index', tutorial.get('order_index', 0)), 0),
            'updated_at': get_nairobi_time(),
        }
        if updates['access_level'] not in {'free', 'premium'}:
            return jsonify({'error': 'Invalid access level'}), 400

        tutorials.update_one({'_id': to_object_id(tutorial_id)}, {'$set': updates})
        return jsonify({'success': True, 'tutorial': serialize_tutorial(find_by_id(tutorials, tutorial_id))}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/users', methods=['GET'])
def admin_get_users():
    """Get users for admin panel."""
    try:
        token = request.headers.get('Authorization')
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401
        
        users = get_users_collection()
        
        return jsonify({
            'users': [
                {
                    'id': str(user.get('_id')),
                    'username': user.get('username'),
                    'email': user.get('email'),
                    'created_at': user.get('created_at'),
                    'last_login_at': user.get('last_login_at'),
                    'last_logout_at': user.get('last_logout_at'),
                    'is_online': bool(user.get('is_online', 0)),
                    'has_logged_in': user.get('last_login_at') is not None,
                    'subscription_tier': (user.get('subscription_tier') or 'basic').lower(),
                    'auth_id': get_public_user_id(user),
                    'translations_used': get_user_translation_count(user),
                } for user in users.find({}).sort('created_at', -1)
            ]
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/users/<user_id>', methods=['DELETE'])
def admin_delete_user(user_id):
    """Delete a user from admin panel."""
    try:
        token = request.headers.get('Authorization')
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401
        
        users = get_users_collection()
        translations = get_translations_collection()

        user = find_by_id(users, user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        translations.delete_many({'user_id': {'$in': get_user_identity_values(user)}})
        users.delete_one({'_id': user['_id']})
        
        return jsonify({'success': True, 'message': 'User deleted'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/users/<user_id>/password', methods=['PUT'])
def admin_change_user_password(user_id):
    """Change a user's password from admin panel."""
    try:
        token = request.headers.get('Authorization')
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401
        
        data = request.get_json() or {}
        new_password = data.get('new_password', '')
        if len(new_password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        
        users = get_users_collection()

        object_id = to_object_id(user_id)
        
        if not users.find_one({'_id': object_id}):
            return jsonify({'error': 'User not found'}), 404
        
        users.update_one(
            {'_id': object_id},
            {'$set': {'password': generate_password_hash(new_password)}}
        )
        
        return jsonify({'success': True, 'message': 'Password updated'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500




# ============ USER AUTHENTICATION ENDPOINTS ============

@app.route('/api/user/signup', methods=['POST'])
def user_signup():
    """Register new user account"""
    try:
        data = request.get_json(silent=True) or {}
        username = data.get('username')
        email = data.get('email')
        password = data.get('password')
        
        if not username or not email or not password:
            return jsonify({'error': 'Missing required fields'}), 400
        
        if len(username) < 3:
            return jsonify({'error': 'Username must be at least 3 characters'}), 400
        if len(password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        
        users = get_users_collection()
        now = get_nairobi_time()
        
        # Check if user already exists
        if users.find_one({'username': username}) or users.find_one({'email': email}):
            return jsonify({'error': 'Username or email already exists'}), 409
        
        # Create new user with a simple public auth id instead of exposing DB ids.
        user_doc = None
        result = None
        for _ in range(10):
            candidate_doc = {
                'username': username,
                'email': email,
                'password': generate_password_hash(password),
                'auth_id': generate_simple_auth_id(users),
                'created_at': now,
                'last_login_at': now,
                'is_online': 1,
                'subscription_tier': 'basic'
            }
            try:
                result = users.insert_one(candidate_doc)
                user_doc = candidate_doc
                break
            except Exception as error:
                error_text = str(error).lower()
                if (
                    'auth_id' not in error_text
                    or ('duplicate' not in error_text and 'unique' not in error_text)
                ):
                    raise

        if not result or not user_doc:
            return jsonify({'error': 'Could not create a user id. Please try again.'}), 500

        user_doc['_id'] = result.inserted_id
        user_id = get_public_user_id(user_doc)
        subscription = get_user_subscription_payload(user_id)
        
        return jsonify({
            'success': True,
            'user_id': user_id,
            'username': username,
            'email': email,
            'token': make_user_token(user_doc),
            'message': 'Account created successfully',
            'subscription': subscription
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/user/login', methods=['POST'])
def user_login():
    """User login endpoint"""
    try:
        data = request.get_json(silent=True) or {}
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            return jsonify({'error': 'Missing username or password'}), 400
        
        users = get_users_collection()
        user = users.find_one({'username': username})
        
        if not user or not verify_password(user['password'], password):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        users.update_one(
            {'_id': user['_id']},
            {'$set': {'last_login_at': get_nairobi_time(), 'is_online': 1}}
        )
        
        email_info = {'sent': False, 'reason': 'not_attempted'}
        try:
            email_info = send_welcome_login_email(user['email'], user['username'])
        except Exception as email_error:
            email_info = {'sent': False, 'reason': str(email_error)}
        
        ensure_user_auth_id(user)
        user_id = get_public_user_id(user)
        subscription = get_user_subscription_payload(user_id)
        
        return jsonify({
            'success': True,
            'user_id': user_id,
            'username': user['username'],
            'email': user['email'],
            'token': make_user_token(user),
            'welcome_email': email_info,
            'subscription': subscription
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/user/logout', methods=['POST'])
def user_logout():
    """Update user logout state so admin can see current status."""
    try:
        token = request.headers.get('Authorization')
        user_id = get_user_id_from_token(token)
        
        if not user_id:
            return jsonify({'error': 'Unauthorized'}), 401
        
        users = get_users_collection()
        user = get_user_row(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        users.update_one(
            {'_id': user['_id']},
            {'$set': {'is_online': 0, 'last_logout_at': get_nairobi_time()}}
        )
        
        return jsonify({'success': True, 'message': 'Logged out'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/user/subscription', methods=['GET', 'PUT'])
def user_subscription():
    """Get or update the current user's subscription tier."""
    try:
        token = request.headers.get('Authorization')
        current_user_id = get_user_id_from_token(token)

        if not current_user_id:
            return jsonify({'error': 'Unauthorized'}), 401

        if request.method == 'GET':
            subscription = get_user_subscription_payload(current_user_id)
            if not subscription:
                return jsonify({'error': 'User not found'}), 404

            return jsonify({'subscription': subscription}), 200

        data = request.get_json(silent=True) or {}
        requested_tier = str(data.get('tier', '')).strip().lower()
        if requested_tier not in {'basic', 'premium'}:
            return jsonify({'error': 'Invalid subscription tier'}), 400
        
        users = get_users_collection()
        current_user = get_user_row(current_user_id)
        if not current_user:
            return jsonify({'error': 'User not found'}), 404
        
        users.update_one(
            {'_id': current_user['_id']},
            {'$set': {'subscription_tier': requested_tier}}
        )
        
        subscription = get_user_subscription_payload(current_user_id)
        return jsonify({'success': True, 'subscription': subscription}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/user/profile/<user_id>', methods=['GET'])
def get_user_profile(user_id):
    """Get user profile"""
    try:
        token = request.headers.get('Authorization')
        
        token_user_id = get_user_id_from_token(token)
        if not token_user_id:
            return jsonify({'error': 'Unauthorized'}), 401
        
        if not user_ids_match(token_user_id, user_id):
            return jsonify({'error': 'Cannot access other user profiles'}), 403
        
        user = get_user_row(user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404

        ensure_user_auth_id(user)

        return jsonify({
            'user_id': get_public_user_id(user),
            'username': user['username'],
            'email': user['email'],
            'created_at': user.get('created_at')
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/user/profile/<user_id>', methods=['PUT'])
def update_user_profile(user_id):
    """Update user profile"""
    try:
        token = request.headers.get('Authorization')
        data = request.get_json(silent=True) or {}
        
        token_user_id = get_user_id_from_token(token)
        if not token_user_id:
            return jsonify({'error': 'Unauthorized'}), 401
        
        # Verify user is updating their own profile
        if not user_ids_match(token_user_id, user_id):
            return jsonify({'error': 'Cannot update other user profiles'}), 403
        
        users = get_users_collection()
        user = get_user_row(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Only allow updating email
        new_email = data.get('email')
        if new_email:
            users.update_one(
                {'_id': user['_id']},
                {'$set': {'email': new_email}}
            )
        
        return jsonify({'success': True, 'message': 'Profile updated'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/user/translations', methods=['GET'])
def get_user_translations():
    """Get user's translation history"""
    try:
        token = request.headers.get('Authorization')
        
        user_id = get_user_id_from_token(token)
        if not user_id:
            return jsonify({'error': 'Unauthorized'}), 401
        
        translations = get_translations_collection()
        gestures = get_gestures_collection()
        
        translation_list = []
        for t in translations.find({'user_id': {'$in': get_user_identity_values(user_id)}}).sort('timestamp', -1).limit(50):
            gesture_name = t.get('gesture')
            if t.get('gesture_id'):
                gesture_doc = gestures.find_one({'_id': to_object_id(t['gesture_id'])})
                if gesture_doc:
                    gesture_name = gesture_doc.get('gesture_name')
            
            translation_list.append({
                'id': str(t.get('_id', '')),
                'gesture': gesture_name or 'Spelled Word',
                'language': t.get('target_language'),
                'english': t.get('english_translation'),
                'luganda': t.get('luganda_translation'),
                'word': t.get('word'),
                'timestamp': t.get('timestamp'),
                'source_language': t.get('source_language')
            })
        
        return jsonify({'translations': translation_list}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/tutorials', methods=['GET'])
def get_tutorial_videos():
    """Return tutorial videos managed by admin."""
    try:
        tutorials = get_tutorials_collection()
        rows = [serialize_tutorial(item) for item in tutorials.find({}).sort('order_index', 1)]
        return jsonify({'tutorials': rows}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/learning/basic-gestures', methods=['GET'])
def get_basic_learning_gestures():
    """Return beginner-friendly gestures with simple learning tips."""
    try:
        tips = {
            'hello': [
                'Raise your open hand near shoulder level.',
                'Move your hand side-to-side in a gentle wave.',
                'Keep fingers relaxed and visible to the camera.'
            ],
            'thank_you': [
                'Start with fingertips near your chin.',
                'Move hand forward and slightly down.',
                'Use smooth motion and face the camera clearly.'
            ],
            'yes': [
                'Close your hand into a fist.',
                'Nod the fist up and down like a small head nod.',
                'Repeat at a steady pace for clarity.'
            ],
            'no': [
                'Start with index and middle fingers together with thumb.',
                'Open and close the two fingers like a beak motion.',
                'Keep your hand centered in the frame.'
            ]
}
        
        gestures = get_gestures_collection()
        rows = list(gestures.find({'gesture_name': {'$in': ['hello', 'thank_you', 'yes', 'no']}}))
        
        lessons = [
            {
                'gesture_name': row.get('gesture_name'),
                'english_meaning': row.get('english_meaning'),
                'luganda_meaning': row.get('luganda_meaning'),
                'description': row.get('description'),
                'practice_tips': tips.get(row.get('gesture_name'), ['Practice slowly and keep your hand visible.'])
            }
            for row in sorted(rows, key=lambda x: x.get('gesture_name', ''))
        ]
        
        return jsonify({'lessons': lessons}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/user/profile/<user_id>', methods=['DELETE'])
def delete_user_account(user_id):
    """Delete user account"""
    try:
        token = request.headers.get('Authorization')
        
        token_user_id = get_user_id_from_token(token)
        if not token_user_id:
            return jsonify({'error': 'Unauthorized'}), 401
        
        # Verify user is deleting their own account
        if not user_ids_match(token_user_id, user_id):
            return jsonify({'error': 'Cannot delete other user accounts'}), 403
        
        users = get_users_collection()
        translations = get_translations_collection()
        user = get_user_row(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Delete user and associated translations
        translations.delete_many({'user_id': {'$in': get_user_identity_values(user)}})
        users.delete_one({'_id': user['_id']})
        
        return jsonify({'success': True, 'message': 'Account deleted'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============ LETTER SPELLING & FINGER SPELLING ENDPOINTS ============

@app.route('/api/letters', methods=['GET'])
def get_letter_gestures():
    """Get all available letter gestures (A-Z)"""
    try:
        letters = get_letters_collection()
        letter_list = [
            {
                'id': str(l.get('_id')),
                'letter': l.get('letter'),
                'gesture_name': l.get('gesture_name'),
                'description': l.get('description')
            } for l in letters.find({}).sort('letter', 1)
        ]
        
        return jsonify({'letters': letter_list}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/recognize-letter', methods=['POST'])
def recognize_letter():
    """
    Recognize a single letter from a gesture image (finger spelling)
    Expected: gesture_image (base64 encoded)
    
    Returns: recognized letter (A-Z)
    """
    try:
        data = request.get_json(silent=True) or {}
        gesture_data = data.get('gesture_image')
        
        if not gesture_data:
            return jsonify({'error': 'No gesture image provided'}), 400
        
        # Recognize letter from gesture
        recognized_letter = gesture_processor.recognize_letter(gesture_data)
        
        if not recognized_letter:
            return jsonify({'error': 'Could not recognize letter. Please try again.'}), 400
        
        # Validate it's a letter
        if recognized_letter.upper() not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
            return jsonify({'error': 'Invalid letter recognized'}), 400
        
        return jsonify({
            'letter': recognized_letter.upper(),
            'success': True
        }), 200
        
    except Exception as e:
        print(f"Error recognizing letter: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/spell-word', methods=['POST'])
def spell_word():
    """
    Build a word from recognized letters (accumulate letters to form words)
    Expected: letters (array of single letter strings)
    
    Returns: spelled word and translations
    """
    try:
        data = request.get_json(silent=True) or {}
        letters = data.get('letters', [])
        target_language = data.get('target_language', 'english')
        
        if not letters or len(letters) == 0:
            return jsonify({'error': 'No letters provided'}), 400
        
        # Convert to uppercase and validate
        spelled_word = ''.join(str(letter).upper() for letter in letters)
        
        # Validate all characters are letters
        if not all(c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' for c in spelled_word):
            return jsonify({'error': 'Invalid letters in word'}), 400
        
        if len(spelled_word) > 50:
            return jsonify({'error': 'Word is too long (max 50 letters)'}), 400
        
        # Log the spelling action
        token = request.headers.get('Authorization')
        user_id = get_user_id_from_token(token)
        
        return jsonify({
            'word': spelled_word,
            'letter_count': len(letters),
            'letters': letters,
            'success': True
        }), 200
        
    except Exception as e:
        print(f"Error spelling word: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/translate-word', methods=['POST'])
def translate_word():
    """
    Translate a spelled word to English/Luganda
    Expected: word (spelled out word), target_language
    
    Returns: word and translations
    """
    try:
        data = request.get_json(silent=True) or {}
        token = request.headers.get('Authorization')
        user_id = get_user_id_from_token(token)
        word = data.get('word', '').strip()
        target_language = data.get('target_language', 'english').lower()

        if not user_id:
            return jsonify({'error': 'Authentication required to translate'}), 401

        subscription, error_response = ensure_user_can_translate(user_id)
        if error_response:
            return error_response
        
        if not word:
            return jsonify({'error': 'No word provided'}), 400
        
        # Validate word contains only letters
        if not all(c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' for c in word):
            return jsonify({'error': 'Word must contain only letters'}), 400
        
        word_lower = word.lower()
        
        log_translation(
            None,
            target_language,
            user_id,
            'spelled_word',
            english_translation=word,
            luganda_translation=word,
            word=word_lower,
        )
        
        # Return word with indication that it was spelled out
        return jsonify({
            'word': word_lower,
            'word_uppercase': word.upper(),
            'english': word,
            'luganda': word,
            'letter_count': len(word),
            'source': 'finger_spelling',
            'target_language': target_language,
            'success': True,
            'message': f'Word "{word}" spelled using finger spelling',
            'subscription': get_user_subscription_payload(user_id)
        }), 200
        
    except Exception as e:
        print(f"Error translating word: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/train', methods=['POST'])
def admin_train_model():
    """Train ML model with captured gesture frames (Admin only)"""
    try:
        data = request.get_json(silent=True) or {}
        token = request.headers.get('Authorization')
        
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401
        
        gesture_name = data.get('gesture_name')
        gesture_label = data.get('gesture_label')
        frames = data.get('frames', [])
        
        if not gesture_name or not frames:
            return jsonify({'error': 'Missing gesture name or frames'}), 400
        
        if len(frames) < 10:
            return jsonify({'error': 'Need at least 10 frames for training'}), 400
        
        gesture_label = sanitize_label(gesture_label or gesture_name)
        if not gesture_label:
            return jsonify({'error': 'Invalid gesture label'}), 400

        saved_count = 0
        saved_files = []
        for frame_base64 in frames:
            try:
                frame_path = save_training_image(gesture_label, frame_base64)
                saved_count += 1
                saved_files.append(relative_path(frame_path))
            except Exception as e:
                print(f"Error saving training frame: {e}")
        
        # Add gesture to database if not exists
        gestures = get_gestures_collection()
        existing = gestures.find_one({'gesture_name': gesture_label})
        
        if not existing:
            gestures.insert_one({
                'gesture_name': gesture_label,
                'english_meaning': gesture_name,
                'luganda_meaning': gesture_name,
                'description': f'Trained via admin portal',
                'created_at': get_nairobi_time()
            })
        
        return jsonify({
            'success': True,
            'message': f'Training samples saved: {saved_count} frames for gesture "{gesture_name}"',
            'gesture_label': gesture_label,
            'frames_saved': saved_count,
            'dataset_path': relative_path(Path(app.config['GESTURE_DATASET_DIR']) / gesture_label),
            'sample_files': saved_files[:10],
            'training_status': get_training_status_rows(),
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


LANDMARK_DIR = PROJECT_ROOT_DIR / 'datasets' / 'landmarks'
LANDMARK_MODEL_FILE = FRONTEND_FOLDER / 'models' / 'gesture-mlp.json'
LANDMARK_DEVICES = {'phone', 'laptop', 'tablet', 'other'}
LANDMARK_MODEL_ID = 'landmark_mlp'
LANDMARK_EXPORT_MAX = 120


def _remote_store():
    """True when samples and the trained model live in MongoDB (always on Vercel: no writable disk)."""
    from mongodb_client import use_mongodb
    return use_mongodb()


def _landmark_samples():
    from mongodb_client import get_mongo_db
    return get_mongo_db()['landmark_samples']


def _landmark_models():
    from mongodb_client import get_mongo_db
    return get_mongo_db()['landmark_models']


def _validate_model(model):
    """Check an uploaded browser model is a well-formed MLP over 63 inputs. Returns an error string or None."""
    if not isinstance(model, dict):
        return 'Model must be an object.'
    labels, layers = model.get('labels'), model.get('layers')
    if not isinstance(labels, list) or not 2 <= len(labels) <= 300 or not all(isinstance(l, str) and l for l in labels):
        return 'Model needs between 2 and 300 text labels.'
    if not isinstance(layers, list) or not 2 <= len(layers) <= 4:
        return 'Model needs 2 to 4 layers.'
    width = 63
    for i, layer in enumerate(layers):
        if not isinstance(layer, dict):
            return f'Layer {i + 1} has the wrong shape.'
        w, b = layer.get('w'), layer.get('b')
        if not isinstance(w, list) or not isinstance(b, list) or len(w) != width or not b:
            return f'Layer {i + 1} has the wrong shape.'
        if any(not isinstance(row, list) or len(row) != len(b) for row in w):
            return f'Layer {i + 1} weights are not rectangular.'
        last = i == len(layers) - 1
        if layer.get('act') != ('softmax' if last else 'relu'):
            return f'Layer {i + 1} has the wrong activation.'
        for row in w:
            if any(not isinstance(v, (int, float)) or v != v or abs(v) > 1e3 for v in row):
                return f'Layer {i + 1} has invalid numbers.'
        width = len(b)
    if width != len(labels):
        return 'The last layer must have one output per label.'
    return None


@app.route('/api/admin/landmarks', methods=['POST'])
def admin_save_landmark_sequence():
    """Save one recorded landmark sequence (numbers only; no video or images)."""
    token = request.headers.get('Authorization')
    if not is_valid_admin_token(token):
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json(silent=True) or {}
    if data.get('consent') is not True:
        return jsonify({'error': 'The signer must give consent before data is saved.'}), 400

    label = sanitize_label(data.get('label'))
    signer = sanitize_label(data.get('signer_id'))
    device = str(data.get('device') or '').lower()
    frames = data.get('frames')
    if not label or not signer:
        return jsonify({'error': 'Sign label and signer ID are required.'}), 400
    if device not in LANDMARK_DEVICES:
        return jsonify({'error': 'Device type must be phone, laptop, tablet or other.'}), 400
    if not isinstance(frames, list) or not 10 <= len(frames) <= 90:
        return jsonify({'error': 'A recording needs between 10 and 90 frames.'}), 400

    clean = []
    for frame in frames:
        if not isinstance(frame, list) or len(frame) != 63:
            return jsonify({'error': 'Every frame must contain 21 landmarks (63 numbers).'}), 400
        try:
            values = [round(float(v), 5) for v in frame]
        except (TypeError, ValueError):
            return jsonify({'error': 'Landmark values must be numbers.'}), 400
        if any(v != v or abs(v) > 5 for v in values):
            return jsonify({'error': 'Landmark values out of range.'}), 400
        clean.append(values)

    record = {
        'signer_id': signer,
        'device': device,
        'label': label,
        'consent': True,
        'captured_at': get_nairobi_time(),
        'frames': clean,
    }
    if _remote_store():
        inserted = _landmark_samples().insert_one(record)
        return jsonify({'success': True, 'id': str(inserted.inserted_id), 'frames': len(clean)}), 201

    folder = LANDMARK_DIR / label
    folder.mkdir(parents=True, exist_ok=True)
    filename = f"{signer}_{uuid.uuid4().hex[:10]}.json"
    (folder / filename).write_text(json.dumps(record, separators=(',', ':')), encoding='utf-8')
    return jsonify({'success': True, 'file': filename, 'frames': len(clean)}), 201


def _disk_samples():
    """Local fallback store: every recording under datasets/landmarks as a dict."""
    out = []
    if LANDMARK_DIR.exists():
        for path in sorted(LANDMARK_DIR.glob('*/*.json')):
            try:
                out.append(json.loads(path.read_text(encoding='utf-8')))
            except (OSError, ValueError):
                continue
    return out


@app.route('/api/admin/landmarks/summary', methods=['GET'])
def admin_landmark_summary():
    """Recording counts per sign, the list of signers, and the published model (if any)."""
    if not is_valid_admin_token(request.headers.get('Authorization')):
        return jsonify({'error': 'Unauthorized'}), 401
    signs, signers = {}, set()
    model_info = None
    if _remote_store():
        col = _landmark_samples()
        for row in col.aggregate([{'$group': {'_id': '$label', 'n': {'$sum': 1}}}]):
            signs[row['_id']] = row['n']
        signers.update(col.distinct('signer_id'))
        doc = _landmark_models().find_one({'_id': LANDMARK_MODEL_ID}, {'model': 0})
        if doc:
            model_info = {'trained_at': doc.get('trained_at'), 'labels': doc.get('labels'), 'metrics': doc.get('metrics')}
    else:
        for rec in _disk_samples():
            signs[rec['label']] = signs.get(rec['label'], 0) + 1
            signers.add(rec['signer_id'])
        if LANDMARK_MODEL_FILE.exists():
            model_info = {'trained_at': None, 'labels': json.loads(LANDMARK_MODEL_FILE.read_text(encoding='utf-8')).get('labels')}
    return jsonify({'signs': dict(sorted(signs.items())), 'signers': sorted(signers), 'model': model_info}), 200


@app.route('/api/admin/landmarks/export', methods=['GET'])
def admin_export_landmarks():
    """One page of recordings for in-browser training: ?skip=0&limit=80."""
    if not is_valid_admin_token(request.headers.get('Authorization')):
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        skip = max(0, int(request.args.get('skip', 0)))
        limit = min(LANDMARK_EXPORT_MAX, max(1, int(request.args.get('limit', 80))))
    except ValueError:
        return jsonify({'error': 'skip and limit must be numbers.'}), 400
    if _remote_store():
        col = _landmark_samples()
        total = col.count_documents({'consent': True})
        rows = col.find({'consent': True}, {'label': 1, 'signer_id': 1, 'device': 1, 'frames': 1}).sort('_id', 1).skip(skip).limit(limit)
        samples = [{'label': r['label'], 'signer_id': r['signer_id'], 'device': r.get('device'), 'frames': r['frames']} for r in rows]
    else:
        everything = [r for r in _disk_samples() if r.get('consent')]
        total = len(everything)
        samples = [{k: r[k] for k in ('label', 'signer_id', 'device', 'frames') if k in r} for r in everything[skip:skip + limit]]
    return jsonify({'total': total, 'skip': skip, 'samples': samples}), 200


@app.route('/api/admin/landmarks', methods=['DELETE'])
def admin_delete_landmarks():
    """Remove recordings of one sign (?label=WATER), optionally only one signer (&signer_id=s01)."""
    if not is_valid_admin_token(request.headers.get('Authorization')):
        return jsonify({'error': 'Unauthorized'}), 401
    label = sanitize_label(request.args.get('label'))
    signer = sanitize_label(request.args.get('signer_id')) if request.args.get('signer_id') else None
    if not label:
        return jsonify({'error': 'label is required.'}), 400
    if _remote_store():
        query = {'label': label}
        if signer:
            query['signer_id'] = signer
        deleted = _landmark_samples().delete_many(query).deleted_count
    else:
        deleted = 0
        folder = LANDMARK_DIR / label
        if folder.exists():
            for path in folder.glob('*.json'):
                if not signer or path.name.startswith(signer + '_'):
                    path.unlink()
                    deleted += 1
    return jsonify({'success': True, 'deleted': deleted}), 200


@app.route('/api/admin/landmark-model', methods=['PUT'])
def admin_publish_landmark_model():
    """Publish a model trained in the admin page. The translator loads it from /api/landmark-model."""
    if not is_valid_admin_token(request.headers.get('Authorization')):
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    model = data.get('model')
    problem = _validate_model(model)
    if problem:
        return jsonify({'error': problem}), 400
    payload = {
        'version': 1,
        'input': 63,
        'labels': [str(l) for l in model['labels']],
        'layers': model['layers'],
    }
    metrics = data.get('metrics') if isinstance(data.get('metrics'), dict) else {}
    metrics = {k: v for k, v in metrics.items() if isinstance(v, (int, float, str, bool)) or v is None}
    if _remote_store():
        _landmark_models().replace_one(
            {'_id': LANDMARK_MODEL_ID},
            {'_id': LANDMARK_MODEL_ID, 'model': payload, 'labels': payload['labels'],
             'metrics': metrics, 'trained_at': get_nairobi_time()},
            upsert=True,
        )
    else:
        LANDMARK_MODEL_FILE.parent.mkdir(parents=True, exist_ok=True)
        LANDMARK_MODEL_FILE.write_text(json.dumps(payload, separators=(',', ':')), encoding='utf-8')
    return jsonify({'success': True, 'labels': payload['labels']}), 200


@app.route('/api/landmark-model', methods=['GET'])
def get_landmark_model():
    """The published sign model (public: it contains only network weights, no recordings)."""
    payload = None
    if _remote_store():
        doc = _landmark_models().find_one({'_id': LANDMARK_MODEL_ID})
        payload = doc.get('model') if doc else None
    elif LANDMARK_MODEL_FILE.exists():
        payload = json.loads(LANDMARK_MODEL_FILE.read_text(encoding='utf-8'))
    if not payload:
        return jsonify({'error': 'No sign model has been published yet.'}), 404
    response = jsonify(payload)
    response.headers['Cache-Control'] = 'public, max-age=30, stale-while-revalidate=300'
    return response


@app.teardown_appcontext
def close_db(error):
    """Close database connection"""
    close_mongo_or_sqlite(error)


if __name__ == '__main__':
    # Safe defaults: no debugger, localhost only. For phone testing on your Wi-Fi set HOST=0.0.0.0;
    # for auto-reload while developing set FLASK_DEBUG=1.
    run_host = os.getenv('HOST', '127.0.0.1')
    run_debug = os.getenv('FLASK_DEBUG', '0') == '1'
    if app.config.get('ADMIN_PASSWORD') in ('', 'admin123') or len(app.config.get('ADMIN_PASSWORD') or '') < 8:
        print('[SECURITY] ADMIN_PASSWORD is empty, the default, or shorter than 8 characters. '
              'Set a strong ADMIN_PASSWORD in backend/.env.')
    if socketio:
        socketio.run(app, debug=run_debug, host=run_host, port=5000, allow_unsafe_werkzeug=True)
    else:
        app.run(debug=run_debug, host=run_host, port=5000)
