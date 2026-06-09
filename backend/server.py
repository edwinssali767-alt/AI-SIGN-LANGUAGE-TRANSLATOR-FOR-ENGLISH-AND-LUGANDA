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
from config import Config, PROJECT_BACKEND_DIR
from database import init_db, get_db, get_nairobi_time, close_mongo_or_sqlite
from gesture_processor import GestureProcessor
from translator import Translator
import os
import smtplib
import base64
from email.message import EmailMessage
from pathlib import Path
from werkzeug.security import check_password_hash, generate_password_hash

# Load environment variables from .env file
load_dotenv()


app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})
app.config.from_object(Config)

if HAS_SOCKETIO:
    socketio = SocketIO(app, cors_allowed_origins="*")
else:
    socketio = None

FRONTEND_FOLDER = PROJECT_BACKEND_DIR.parent / 'frontend'
VIDEO_FOLDER = app.config['LEARNING_VIDEO_FOLDER']
os.makedirs(VIDEO_FOLDER, exist_ok=True)

# Initialize database
init_db(app)

# Register teardown handler
app.teardown_appcontext(close_mongo_or_sqlite)

# Initialize processors
gesture_processor = GestureProcessor()
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


def is_valid_admin_token(token):
    """Validate simple admin token format."""
    return bool(token and token.startswith('admin_'))


def get_user_id_from_token(token):
    """Extract user id from user token, returning None when invalid."""
    if not token or not token.startswith('user_'):
        return None
    try:
        return token.split('_')[1]  # Return as string for MongoDB ObjectId compatibility
    except (IndexError, ValueError):
        return None


def get_free_translation_limit():
    """Return the free translation quota for basic accounts."""
    return int(app.config.get('FREE_TRANSLATION_LIMIT', 10))


def get_user_row(user_id):
    """Fetch a user row with subscription details."""
    from bson import ObjectId
    users = get_users_collection()
    try:
        object_id = ObjectId(user_id) if isinstance(user_id, str) else user_id
    except:
        object_id = user_id
    return users.find_one({'_id': object_id})


def get_user_translation_count(user_id):
    """Count all successful translation events recorded for a user."""
    from bson import ObjectId
    translations = get_translations_collection()
    try:
        object_id = ObjectId(user_id) if isinstance(user_id, str) else user_id
    except:
        object_id = user_id
    return int(translations.count_documents({'user_id': str(object_id)}))


def build_subscription_payload(user_row):
    """Build a subscription snapshot for the frontend."""
    if not user_row:
        return None
    
    tier = (user_row.get('subscription_tier') or 'basic').lower()
    user_id = user_row.get('_id') or user_row.get('id')
    translations_used = get_user_translation_count(user_id)
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


def log_translation(detected_gesture, target_language, user_id=None, source_language='gesture'):
    """Persist translation event for history and analytics."""
    translations = get_translations_collection()
    gestures = get_gestures_collection()
    
    gesture_id = None
    if detected_gesture:
        gesture_doc = gestures.find_one({'gesture_name': detected_gesture})
        if gesture_doc:
            gesture_id = str(gesture_doc['_id'])
    
    translations.insert_one({
        'gesture_id': gesture_id,
        'user_id': str(user_id) if user_id else None,
        'source_language': source_language,
        'target_language': target_language,
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

        if not user_id:
            return jsonify({'error': 'Authentication required to translate'}), 401

        subscription, error_response = ensure_user_can_translate(user_id)
        if error_response:
            return error_response
        
        if not gesture_data:
            return jsonify({'error': 'No gesture image provided'}), 400
        
        # Process gesture
        detected_gesture = gesture_processor.process_gesture(gesture_data)
        
        if not detected_gesture:
            return jsonify({'error': 'Could not detect gesture. Please try again.'}), 400
        
        # Get translation
        translation = translator.translate(detected_gesture, target_language)
        log_translation(detected_gesture, target_language, user_id)
        
        return jsonify({
            'gesture': detected_gesture,
            'translation': translation,
            'language': target_language,
            'subscription': get_user_subscription_payload(user_id)
        }), 200
        
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

        if not user_id:
            return jsonify({'error': 'Authentication required to translate'}), 401

        subscription, error_response = ensure_user_can_translate(user_id)
        if error_response:
            return error_response
        
        if not gesture_frames or len(gesture_frames) == 0:
            return jsonify({'error': 'No gesture frames provided'}), 400
        
        # Process each frame to build motion history
        print(f"Processing {len(gesture_frames)} frames for motion analysis...")
        
        detected_gesture = None
        
        # Send frames to gesture processor
        for i, frame_data in enumerate(gesture_frames):
            # Add frame to buffer
            frame_count = gesture_processor.add_frame(frame_data)
            
            # Check if we have enough frames for prediction
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
        
        # Get translation
        translation = translator.translate(detected_gesture, target_language)
        log_translation(detected_gesture, target_language, user_id)
        
        return jsonify({
            'gesture': detected_gesture,
            'translation': translation,
            'language': target_language,
            'frames_processed': len(gesture_frames),
            'subscription': get_user_subscription_payload(user_id)
        }), 200
        
    except Exception as e:
        print(f"Error in translate_gesture_motion: {e}")
        return jsonify({'error': str(e)}), 500


@socketio.on('start_realtime')
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


@socketio.on('realtime_frame')
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

    detected_gesture = gesture_processor.process_gesture(frame_data)
    confidence = 0.85

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


@socketio.on('stop_realtime')
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


@app.route('/api/gestures/<int:gesture_id>', methods=['GET'])
def get_gesture(gesture_id):
    """Get specific gesture details"""
    try:
        from bson import ObjectId
        gestures = get_gestures_collection()
        
        try:
            object_id = ObjectId(gesture_id)
        except:
            object_id = gesture_id
        
        gesture = gestures.find_one({'_id': object_id})
        
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
                'token': f"admin_{user_id}"
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
            'token': f"admin_{user['_id']}"
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
        
        db = get_db()
        cursor = db.cursor()
        cursor.execute(
            '''INSERT INTO gestures (gesture_name, english_meaning, luganda_meaning, description, created_at)
               VALUES (?, ?, ?, ?, ?)''',
            (gesture_name, english_meaning, luganda_meaning, description, get_nairobi_time())
        )
        db.commit()
        
        return jsonify({'success': True, 'gesture_id': cursor.lastrowid}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/gestures/<int:gesture_id>', methods=['PUT'])
def admin_update_gesture(gesture_id):
    """Update gesture (Admin only)"""
    try:
        data = request.get_json(silent=True) or {}
        token = request.headers.get('Authorization')
        
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401
        
        db = get_db()
        cursor = db.cursor()
        
        cursor.execute(
            '''UPDATE gestures 
               SET gesture_name = ?, english_meaning = ?, luganda_meaning = ?, description = ?
               WHERE id = ?''',
            (data.get('gesture_name'), data.get('english_meaning'), 
             data.get('luganda_meaning'), data.get('description', ''), gesture_id)
        )
        db.commit()
        
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/gestures/<int:gesture_id>', methods=['DELETE'])
def admin_delete_gesture(gesture_id):
    """Delete gesture (Admin only)"""
    try:
        token = request.headers.get('Authorization')
        
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401
        
        db = get_db()
        cursor = db.cursor()
        cursor.execute('DELETE FROM gestures WHERE id = ?', (gesture_id,))
        db.commit()
        
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
            'logged_in_users': logged_in_users
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/users', methods=['GET'])
def admin_get_users():
    """Get users for admin panel."""
    try:
        token = request.headers.get('Authorization')
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401

        db = get_db()
        cursor = db.cursor()
        cursor.execute(
            '''SELECT id, username, email, created_at, last_login_at, last_logout_at, is_online
               FROM users
               ORDER BY created_at DESC'''
        )
        users = cursor.fetchall()

        return jsonify({
            'users': [
                {
                    'id': user[0],
                    'username': user[1],
                    'email': user[2],
                    'created_at': user[3],
                    'last_login_at': user[4],
                    'last_logout_at': user[5],
                    'is_online': bool(user[6]),
                    'has_logged_in': user[4] is not None
                } for user in users
            ]
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
def admin_delete_user(user_id):
    """Delete a user from admin panel."""
    try:
        token = request.headers.get('Authorization')
        if not is_valid_admin_token(token):
            return jsonify({'error': 'Unauthorized'}), 401
        
        from bson import ObjectId
        users = get_users_collection()
        translations = get_translations_collection()
        
        try:
            object_id = ObjectId(user_id)
        except:
            object_id = user_id
        
        if not users.find_one({'_id': object_id}):
            return jsonify({'error': 'User not found'}), 404
        
        translations.delete_many({'user_id': str(object_id)})
        users.delete_one({'_id': object_id})
        
        return jsonify({'success': True, 'message': 'User deleted'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/users/<int:user_id>/password', methods=['PUT'])
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
        
        from bson import ObjectId
        users = get_users_collection()
        
        try:
            object_id = ObjectId(user_id)
        except:
            object_id = user_id
        
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
        data = request.get_json()
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
        
        # Create new user
        user_doc = {
            'username': username,
            'email': email,
            'password': generate_password_hash(password),
            'created_at': now,
            'last_login_at': now,
            'is_online': 1,
            'subscription_tier': 'basic'
        }
        result = users.insert_one(user_doc)
        user_id = result.inserted_id
        subscription = get_user_subscription_payload(user_id)
        
        return jsonify({
            'success': True,
            'user_id': user_id,
            'username': username,
            'email': email,
            'token': f"user_{user_id}",
            'message': 'Account created successfully',
            'subscription': subscription
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/user/login', methods=['POST'])
def user_login():
    """User login endpoint"""
    try:
        data = request.get_json()
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
        
        subscription = get_user_subscription_payload(user['_id'])
        
        return jsonify({
            'success': True,
            'user_id': str(user['_id']),
            'username': user['username'],
            'email': user['email'],
            'token': f"user_{user['_id']}",
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

        db = get_db()
        cursor = db.cursor()
        cursor.execute(
            'UPDATE users SET is_online = 0, last_logout_at = ? WHERE id = ?',
            (get_nairobi_time(), user_id)
        )
        db.commit()

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
        
        from bson import ObjectId
        users = get_users_collection()
        
        try:
            current_user_oid = ObjectId(current_user_id)
        except:
            current_user_oid = current_user_id
        
        users.update_one(
            {'_id': current_user_oid},
            {'$set': {'subscription_tier': requested_tier}}
        )
        
        subscription = get_user_subscription_payload(current_user_id)
        return jsonify({'success': True, 'subscription': subscription}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/user/profile/<int:user_id>', methods=['GET'])
def get_user_profile(user_id):
    """Get user profile"""
    try:
        token = request.headers.get('Authorization')
        
        token_user_id = get_user_id_from_token(token)
        if not token_user_id:
            return jsonify({'error': 'Unauthorized'}), 401
        
        if token_user_id != user_id:
            return jsonify({'error': 'Cannot access other user profiles'}), 403
        
        from bson import ObjectId
        users = get_users_collection()
        
        try:
            object_id = ObjectId(user_id)
        except:
            object_id = user_id
        
        user = users.find_one({'_id': object_id})
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        return jsonify({
            'user_id': str(user['_id']),
            'username': user['username'],
            'email': user['email'],
            'created_at': user.get('created_at')
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
        return jsonify({'error': str(e)}), 500


@app.route('/api/user/profile/<int:user_id>', methods=['PUT'])
def update_user_profile(user_id):
    """Update user profile"""
    try:
        token = request.headers.get('Authorization')
        data = request.get_json(silent=True) or {}
        
        if not token or not token.startswith('user_'):
            return jsonify({'error': 'Unauthorized'}), 401
        
        # Verify user is updating their own profile
        token_user_id = token.split('_')[1]  # Keep as string for MongoDB
        if token_user_id != str(user_id):
            return jsonify({'error': 'Cannot update other user profiles'}), 403
        
        from bson import ObjectId
        users = get_users_collection()
        
        try:
            object_id = ObjectId(user_id)
        except:
            object_id = user_id
        
        # Only allow updating email
        new_email = data.get('email')
        if new_email:
            users.update_one(
                {'_id': object_id},
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
        
        if not token or not token.startswith('user_'):
            return jsonify({'error': 'Unauthorized'}), 401
        
        user_id = token.split('_')[1]  # Keep as string for MongoDB
        
        translations = get_translations_collection()
        gestures = get_gestures_collection()
        
        translation_list = []
        for t in translations.find({'user_id': user_id}).sort('timestamp', -1).limit(50):
            gesture_name = None
            if t.get('gesture_id'):
                gesture_doc = gestures.find_one({'_id': t['gesture_id']})
                if gesture_doc:
                    gesture_name = gesture_doc.get('gesture_name')
            
            translation_list.append({
                'id': str(t.get('_id', '')),
                'gesture': gesture_name or 'Spelled Word',
                'language': t.get('target_language'),
                'timestamp': t.get('timestamp'),
                'source_language': t.get('source_language')
            })
        
        return jsonify({'translations': translation_list}), 200
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


@app.route('/api/user/profile/<int:user_id>', methods=['DELETE'])
def delete_user_account(user_id):
    """Delete user account"""
    try:
        token = request.headers.get('Authorization')
        
        if not token or not token.startswith('user_'):
            return jsonify({'error': 'Unauthorized'}), 401
        
        # Verify user is deleting their own account
        token_user_id = int(token.split('_')[1])
        if token_user_id != user_id:
            return jsonify({'error': 'Cannot delete other user accounts'}), 403
        
        db = get_db()
        cursor = db.cursor()
        
        # Delete user and associated translations
        cursor.execute('DELETE FROM translations WHERE user_id = ?', (user_id,))
        cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
        db.commit()
        
        return jsonify({'success': True, 'message': 'Account deleted'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============ LETTER SPELLING & FINGER SPELLING ENDPOINTS ============

@app.route('/api/letters', methods=['GET'])
def get_letter_gestures():
    """Get all available letter gestures (A-Z)"""
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute('SELECT id, letter, gesture_name, description FROM letter_gestures ORDER BY letter')
        letters = cursor.fetchall()
        
        letter_list = [
            {
                'id': l[0],
                'letter': l[1],
                'gesture_name': l[2],
                'description': l[3]
            } for l in letters
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
        user_id = None
        token = request.headers.get('Authorization')
        if token and token.startswith('user_'):
            try:
                user_id = int(token.split('_')[1])
            except (IndexError, ValueError):
                pass
        
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
        
        log_translation(None, target_language, user_id, 'spelled_word')
        
        # Return word with indication that it was spelled out
        return jsonify({
            'word': word_lower,
            'word_uppercase': word.upper(),
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
        
        # Create training data directory if not exists
        training_dir = Path(PROJECT_BACKEND_DIR) / 'training_data'
        training_dir.mkdir(exist_ok=True)
        
        # Save frames as training data
        import uuid
        session_id = str(uuid.uuid4())[:8]
        gesture_folder = training_dir / f"{gesture_label}_{session_id}"
        gesture_folder.mkdir(exist_ok=True)
        
        saved_count = 0
        for idx, frame_base64 in enumerate(frames):
            try:
                frame_data = frame_base64.split(',', 1)[1] if ',' in frame_base64 else frame_base64
                frame_bytes = base64.b64decode(frame_data)
                
                frame_path = gesture_folder / f"frame_{idx:03d}.jpg"
                with open(frame_path, 'wb') as f:
                    f.write(frame_bytes)
                saved_count += 1
            except Exception as e:
                print(f"Error saving frame {idx}: {e}")
        
        # Add gesture to database if not exists
        db = get_db()
        cursor = db.cursor()
        cursor.execute('SELECT id FROM gestures WHERE gesture_name = ?', (gesture_label,))
        existing = cursor.fetchone()
        
        if not existing:
            cursor.execute(
                '''INSERT INTO gestures (gesture_name, english_meaning, luganda_meaning, description, created_at)
                   VALUES (?, ?, ?, ?, ?)''',
                (gesture_label, gesture_name, gesture_name, f'Trained via admin portal', get_nairobi_time())
            )
            db.commit()
        
        return jsonify({
            'success': True,
            'message': f'Training data saved: {saved_count} frames for gesture "{gesture_name}"',
            'gesture_label': gesture_label,
            'frames_saved': saved_count
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.teardown_appcontext
def close_db(error):
    """Close database connection"""
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


if __name__ == '__main__':
    if socketio:
        socketio.run(app, debug=True, host='0.0.0.0', port=5000)
    else:
        app.run(debug=True, host='0.0.0.0', port=5000)
