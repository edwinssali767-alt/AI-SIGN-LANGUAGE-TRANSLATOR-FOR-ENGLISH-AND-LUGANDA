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
    from pymongo import ASCENDING
    from mongodb_client import init_mongodb_indexes, get_users_collection, get_admins_collection, get_gestures_collection, get_letters_collection
    
    # Create indexes
    init_mongodb_indexes()
    
    users = get_users_collection()
    admin_users = get_admins_collection()
    gestures = get_gestures_collection()
    letters = get_letters_collection()
    
    # Create default admin if not exists
    if admin_users.count_documents({'username': 'admin'}) == 0:
        admin_users.insert_one({
            'username': 'admin',
            'password': generate_password_hash('admin123'),
            'created_at': get_nairobi_time()
        })
    
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
        if gestures.count_documents({'gesture_name': gesture_name}) == 0:
            gestures.insert_one({
                'gesture_name': gesture_name,
                'english_meaning': english,
                'luganda_meaning': luganda,
                'description': description,
                'created_at': get_nairobi_time()
            })
    
    # Insert letter gestures for finger spelling (A-Z)
    alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    for letter in alphabet:
        if letters.count_documents({'letter': letter}) == 0:
            letters.insert_one({
                'letter': letter,
                'gesture_name': f'letter_{letter.lower()}',
                'description': f'Sign for letter {letter}',
                'created_at': get_nairobi_time()
            })


def init_db(app):
    """Initialize database with required tables/collections."""
    with app.app_context():
        init_mongodb(app)


def close_mongo_or_sqlite(error):
    """Close database connection."""
    try:
        from mongodb_client import close_mongo_client
        close_mongo_client(error)
    except:
        pass
