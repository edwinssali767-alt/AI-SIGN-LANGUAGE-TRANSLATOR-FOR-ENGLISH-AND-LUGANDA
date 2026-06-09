"""MongoDB Atlas client for Sign Language Translator."""

from pymongo import MongoClient
from flask import current_app, g
import logging

logger = logging.getLogger(__name__)


def get_mongo_client():
    """Get or create MongoDB client instance."""
    client = getattr(g, '_mongo_client', None)
    if client is None:
        mongo_uri = current_app.config.get('MONGODB_URI')
        if not mongo_uri:
            raise ValueError("MONGODB_URI not configured")
        client = g._mongo_client = MongoClient(mongo_uri)
    return client


def get_mongo_db():
    """Get MongoDB database instance."""
    client = get_mongo_client()
    db_name = current_app.config.get('MONGODB_DB_NAME', 'sign_language_translator')
    return client[db_name]


def get_users_collection():
    """Get users collection."""
    db = get_mongo_db()
    collection_name = current_app.config.get('MONGODB_USERS_COLLECTION', 'users')
    return db[collection_name]


def get_admins_collection():
    """Get admin users collection."""
    db = get_mongo_db()
    collection_name = current_app.config.get('MONGODB_ADMINS_COLLECTION', 'admin_users')
    return db[collection_name]


def get_gestures_collection():
    """Get gestures collection."""
    db = get_mongo_db()
    collection_name = current_app.config.get('MONGODB_GESTURES_COLLECTION', 'gestures')
    return db[collection_name]


def get_translations_collection():
    """Get translations collection."""
    db = get_mongo_db()
    collection_name = current_app.config.get('MONGODB_TRANSLATIONS_COLLECTION', 'translations')
    return db[collection_name]


def get_letters_collection():
    """Get letter gestures collection."""
    db = get_mongo_db()
    collection_name = current_app.config.get('MONGODB_LETTERS_COLLECTION', 'letter_gestures')
    return db[collection_name]


def close_mongo_client(error):
    """Close MongoDB connection."""
    client = getattr(g, '_mongo_client', None)
    if client is not None:
        client.close()
        g._mongo_client = None


def init_mongodb_indexes():
    """Create indexes for MongoDB collections."""
    db = get_mongo_db()
    
    # Users indexes
    users = get_users_collection()
    users.create_index('username', unique=True)
    users.create_index('email', unique=True)
    
    # Admin users indexes
    admin_users = get_admins_collection()
    admin_users.create_index('username', unique=True)
    
    # Gestures indexes
    gestures = get_gestures_collection()
    gestures.create_index('gesture_name', unique=True)
    
    # Translations indexes
    translations = get_translations_collection()
    translations.create_index([('user_id', 1), ('timestamp', -1)])
    
    # Letter gestures indexes
    letters = get_letters_collection()
    letters.create_index('letter', unique=True)