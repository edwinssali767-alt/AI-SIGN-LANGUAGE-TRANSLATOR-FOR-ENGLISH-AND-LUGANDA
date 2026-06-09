"""Database initialization and management."""

import sqlite3
from datetime import datetime

import pytz
from flask import current_app, g
from werkzeug.security import generate_password_hash
from mongodb_client import (
    get_users_collection, get_admins_collection, 
    get_gestures_collection, get_translations_collection,
    get_letters_collection
)

TIMEZONE = pytz.timezone('Africa/Nairobi')


def is_password_hashed(password):
    """Check whether a stored password appears to be hashed by Werkzeug."""
    if not password:
        return False
    return password.startswith('pbkdf2:') or password.startswith('scrypt:')


def get_nairobi_time():
    """Get current time in Nairobi timezone as ISO format string"""
    return datetime.now(TIMEZONE).strftime('%Y-%m-%d %H:%M:%S')


def get_db():
    """Get database connection - uses MongoDB if configured, falls back to SQLite."""
    if current_app.config.get('MONGODB_URI'):
        return get_users_collection()
    
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(get_database_path())
        db.row_factory = sqlite3.Row
    return db


def get_database_path():
    """Resolve the configured SQLite database path."""
    return current_app.config['DATABASE']


def init_mongodb(app):
    """Initialize MongoDB with sample data."""
    from mongodb_client import init_mongodb_indexes
    
    users = get_users_collection()
    admin_users = get_admins_collection()
    
    # Create indexes
    init_mongodb_indexes()
    
    # Create default admin if not exists
    if admin_users.count_documents({'username': 'admin'}) == 0:
        admin_users.insert_one({
            'username': 'admin',
            'password': generate_password_hash('admin123'),
            'created_at': get_nairobi_time()
        })
    
    # Insert sample gestures
    gestures = get_gestures_collection()
    sample_gestures = [
        ('hello', 'Hello', 'Wabale', 'Wave hand in greeting motion'),
        ('thank_you', 'Thank you', 'Asante', 'Hand over heart moving outward'),
        ('yes', 'Yes', 'Yee', 'Head nod downward'),
        ('no', 'No', 'Nedda', 'Head shake side to side'),
        ('good', 'Good', 'Nyo', 'Thumbs up gesture'),
        ('bad', 'Bad', 'Bibi', 'Thumbs down gesture'),
    ]
    
    for gesture_name, english, luganda, description in sample_gestures:
        if gestures.count_documents({'gesture_name': gesture_name}) == 0:
            gestures.insert_one({
                'gesture_name': gesture_name,
                'english_meaning': english,
                'luganda_meaning': luganda,
                'description': description,
                'created_at': get_nairobi_time()
            })
    
    # Insert letter gestures for finger spelling (A-Z)
    letters = get_letters_collection()
    alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    for letter in alphabet:
        if letters.count_documents({'letter': letter}) == 0:
            letters.insert_one({
                'letter': letter,
                'gesture_name': f'letter_{letter.lower()}',
                'description': f'Sign for letter {letter}',
                'created_at': get_nairobi_time()
            })


def init_sqlite(app):
    """Initialize SQLite database with required tables."""
    with app.app_context():
        db = sqlite3.connect(get_database_path())
        cursor = db.cursor()
        
        # Create gestures table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS gestures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                gesture_name TEXT NOT NULL UNIQUE,
                english_meaning TEXT NOT NULL,
                luganda_meaning TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create translations table (for logging)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS translations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                gesture_id INTEGER,
                user_id INTEGER,
                source_language TEXT,
                target_language TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (gesture_id) REFERENCES gestures(id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
            )
        ''')
        
        # Create regular users table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                subscription_tier TEXT DEFAULT 'basic',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create admin users table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS admin_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create letter gestures table for finger spelling
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS letter_gestures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                letter TEXT NOT NULL UNIQUE,
                gesture_name TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Add last_login_at columns on existing databases
        cursor.execute("PRAGMA table_info(users)")
        user_columns = [column[1] for column in cursor.fetchall()]
        if 'last_login_at' not in user_columns:
            cursor.execute('ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP')
        if 'last_logout_at' not in user_columns:
            cursor.execute('ALTER TABLE users ADD COLUMN last_logout_at TIMESTAMP')
        if 'is_online' not in user_columns:
            cursor.execute('ALTER TABLE users ADD COLUMN is_online INTEGER DEFAULT 0')
        if 'subscription_tier' not in user_columns:
            cursor.execute("ALTER TABLE users ADD COLUMN subscription_tier TEXT DEFAULT 'basic'")

        cursor.execute("PRAGMA table_info(admin_users)")
        admin_columns = [column[1] for column in cursor.fetchall()]
        if 'last_login_at' not in admin_columns:
            cursor.execute('ALTER TABLE admin_users ADD COLUMN last_login_at TIMESTAMP')
        
        # Insert default admin user if not exists
        cursor.execute('SELECT COUNT(*) FROM admin_users WHERE username = ?', ('admin',))
        if cursor.fetchone()[0] == 0:
            cursor.execute(
                'INSERT INTO admin_users (username, password) VALUES (?, ?)',
                ('admin', generate_password_hash('admin123'))  # Change this in production!
            )
        
        # Migrate any plain-text user passwords to hashed values
        cursor.execute('SELECT id, password FROM users')
        for user_id, password in cursor.fetchall():
            if not is_password_hashed(password):
                cursor.execute(
                    'UPDATE users SET password = ? WHERE id = ?',
                    (generate_password_hash(password), user_id)
                )
        
        # Migrate any plain-text admin passwords to hashed values
        cursor.execute('SELECT id, password FROM admin_users')
        for admin_id, password in cursor.fetchall():
            if not is_password_hashed(password):
                cursor.execute(
                    'UPDATE admin_users SET password = ? WHERE id = ?',
                    (generate_password_hash(password), admin_id)
                )

        # Backfill subscription tier for existing users that predate the field.
        cursor.execute("UPDATE users SET subscription_tier = COALESCE(NULLIF(subscription_tier, ''), 'basic')")

        # Insert sample gestures
        sample_gestures = [
            ('hello', 'Hello', 'Wabale', 'Wave hand in greeting motion'),
            ('thank_you', 'Thank you', 'Asante', 'Hand over heart moving outward'),
            ('yes', 'Yes', 'Yee', 'Head nod downward'),
            ('no', 'No', 'Nedda', 'Head shake side to side'),
            ('good', 'Good', 'Nyo', 'Thumbs up gesture'),
            ('bad', 'Bad', 'Bibi', 'Thumbs down gesture'),
        ]
        
        for gesture_name, english, luganda, description in sample_gestures:
            cursor.execute(
                'SELECT COUNT(*) FROM gestures WHERE gesture_name = ?',
                (gesture_name,)
            )
            if cursor.fetchone()[0] == 0:
                cursor.execute(
                    '''INSERT INTO gestures (gesture_name, english_meaning, luganda_meaning, description)
                       VALUES (?, ?, ?, ?)''',
                    (gesture_name, english, luganda, description)
                )
        
        # Insert letter gestures for finger spelling (A-Z)
        letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        for letter in letters:
            cursor.execute(
                'SELECT COUNT(*) FROM letter_gestures WHERE letter = ?',
                (letter,)
            )
            if cursor.fetchone()[0] == 0:
                gesture_name = f'letter_{letter.lower()}'
                description = f'Sign for letter {letter}'
                cursor.execute(
                    '''INSERT INTO letter_gestures (letter, gesture_name, description)
                       VALUES (?, ?, ?)''',
                    (letter, gesture_name, description)
                )
        
        db.commit()
        db.close()


def init_db(app):
    """Initialize database with required tables/collections."""
    with app.app_context():
        if app.config.get('MONGODB_URI'):
            init_mongodb(app)
        else:
            init_sqlite(app)


def close_mongo_or_sqlite(error):
    """Close database connection."""
    try:
        from flask import current_app
        if current_app and current_app.config.get('MONGODB_URI'):
            from mongodb_client import close_mongo_client
            close_mongo_client(error)
        else:
            db = getattr(g, '_database', None)
            if db is not None:
                db.close()
                g._database = None
    except:
        pass
