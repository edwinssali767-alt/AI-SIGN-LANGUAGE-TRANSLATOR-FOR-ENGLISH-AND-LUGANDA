"""Configuration file for the Sign Language Translator Backend."""

import os
from pathlib import Path


PROJECT_BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT_DIR = PROJECT_BACKEND_DIR.parent


class Config:
    """Application configuration."""

    # Flask
    DEBUG = True
    TESTING = False
    SECRET_KEY = os.getenv('SECRET_KEY', 'change-me-in-production')

    # Admin credentials (optional - for initial setup)
    ADMIN_USERNAME = os.getenv('ADMIN_USERNAME', 'admin')
    ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'admin123')

    # MongoDB Atlas
    MONGODB_URI = os.getenv('MONGODB_URI', '')
    MONGODB_DB_NAME = os.getenv('MONGODB_DB_NAME', 'sign_language_translator')
    MONGODB_USERS_COLLECTION = os.getenv('MONGODB_USERS_COLLECTION', 'users')
    MONGODB_ADMINS_COLLECTION = os.getenv('MONGODB_ADMINS_COLLECTION', 'admin_users')
    MONGODB_GESTURES_COLLECTION = os.getenv('MONGODB_GESTURES_COLLECTION', 'gestures')
    MONGODB_TRANSLATIONS_COLLECTION = os.getenv('MONGODB_TRANSLATIONS_COLLECTION', 'translations')
    MONGODB_LETTERS_COLLECTION = os.getenv('MONGODB_LETTERS_COLLECTION', 'letter_gestures')
    MONGODB_TUTORIALS_COLLECTION = os.getenv('MONGODB_TUTORIALS_COLLECTION', 'tutorial_videos')

    # Cloudinary
    CLOUDINARY_CLOUD_NAME = os.getenv('CLOUDINARY_CLOUD_NAME', '')
    CLOUDINARY_API_KEY = os.getenv('CLOUDINARY_API_KEY', '')
    CLOUDINARY_API_SECRET = os.getenv('CLOUDINARY_API_SECRET', '')
    CLOUDINARY_PROFILE_IMAGES_FOLDER = os.getenv('CLOUDINARY_PROFILE_IMAGES_FOLDER', 'profile_images')
    CLOUDINARY_LEARNING_VIDEOS_FOLDER = os.getenv('CLOUDINARY_LEARNING_VIDEOS_FOLDER', 'learning_videos')
    CLOUDINARY_GESTURE_IMAGES_FOLDER = os.getenv('CLOUDINARY_GESTURE_IMAGES_FOLDER', 'gesture_images')
    CLOUDINARY_CAPTURED_GESTURES_FOLDER = os.getenv('CLOUDINARY_CAPTURED_GESTURES_FOLDER', 'captured_gestures')

    # Paths
    BASE_DIR = str(PROJECT_BACKEND_DIR)
    DATABASE = str(PROJECT_BACKEND_DIR / 'sign_translator.db')
    DATASETS_DIR = str(PROJECT_ROOT_DIR / 'datasets')
    GESTURE_DATASET_DIR = str(PROJECT_ROOT_DIR / 'datasets' / 'gestures')
    LETTER_DATASET_DIR = str(PROJECT_ROOT_DIR / 'datasets' / 'letters')
    MOTION_DATASET_DIR = str(PROJECT_ROOT_DIR / 'datasets' / 'gesture_motion')
    LEGACY_GESTURE_DATASET_DIR = str(PROJECT_BACKEND_DIR / 'gesture_dataset')
    LEGACY_MOTION_DATASET_DIR = str(PROJECT_BACKEND_DIR / 'gesture_dynamics_dataset')
    UPLOAD_FOLDER = str(PROJECT_ROOT_DIR / 'uploads')
    TRAINING_UPLOAD_FOLDER = str(PROJECT_ROOT_DIR / 'uploads' / 'training')
    LEARNING_VIDEO_FOLDER = str(PROJECT_ROOT_DIR / 'uploads' / 'learning_videos')
    MODEL_DIR = str(PROJECT_ROOT_DIR / 'models')
    LEGACY_MODEL_DIR = str(PROJECT_BACKEND_DIR / 'models')
    STATIC_GESTURE_MODEL = str(PROJECT_ROOT_DIR / 'models' / 'gesture_model.pkl')
    STATIC_SCALER = str(PROJECT_ROOT_DIR / 'models' / 'scaler.pkl')
    DYNAMICS_GESTURE_MODEL = str(PROJECT_ROOT_DIR / 'models' / 'gesture_dynamics_model.pkl')
    DYNAMICS_SCALER = str(PROJECT_ROOT_DIR / 'models' / 'dynamics_scaler.pkl')
    LETTER_MODEL = str(PROJECT_ROOT_DIR / 'models' / 'letter_model.pkl')
    LETTER_SCALER = str(PROJECT_ROOT_DIR / 'models' / 'letter_scaler.pkl')

    # CORS
    CORS_HEADERS = 'Content-Type'
    CORS_ORIGINS = '*'

    # Upload constraints
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max file size

    # Gesture detection
    CONFIDENCE_THRESHOLD = float(os.getenv('CONFIDENCE_THRESHOLD', '0.5'))
    FREE_TRANSLATION_LIMIT = int(os.getenv('FREE_TRANSLATION_LIMIT', '10'))
    GUEST_TRANSLATION_LIMIT = int(os.getenv('GUEST_TRANSLATION_LIMIT', '3'))

    # Email (used for welcome email after successful login)
    SMTP_HOST = os.getenv('SMTP_HOST', '')
    SMTP_PORT = int(os.getenv('SMTP_PORT', '587'))
    SMTP_USERNAME = os.getenv('SMTP_USERNAME', '')
    SMTP_PASSWORD = os.getenv('SMTP_PASSWORD', '')
    SMTP_USE_TLS = os.getenv('SMTP_USE_TLS', 'true').lower() == 'true'
    EMAIL_FROM = os.getenv('EMAIL_FROM', SMTP_USERNAME)
    SEND_LOGIN_WELCOME_EMAIL = os.getenv('SEND_LOGIN_WELCOME_EMAIL', 'true').lower() == 'true'
