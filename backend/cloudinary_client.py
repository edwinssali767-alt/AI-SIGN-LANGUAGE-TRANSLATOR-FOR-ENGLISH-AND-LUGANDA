"""Cloudinary client for Sign Language Translator."""

import cloudinary
import cloudinary.uploader
from flask import current_app
import logging

logger = logging.getLogger(__name__)


def configure_cloudinary():
    """Configure Cloudinary with app settings."""
    cloud_name = current_app.config.get('CLOUDINARY_CLOUD_NAME')
    api_key = current_app.config.get('CLOUDINARY_API_KEY')
    api_secret = current_app.config.get('CLOUDINARY_API_SECRET')
    
    if cloud_name and api_key and api_secret:
        cloudinary.config(
            cloud_name=cloud_name,
            api_key=api_key,
            api_secret=api_secret
        )
        return True
    return False


def upload_profile_image(file_path, user_id):
    """Upload user profile image to Cloudinary."""
    if not configure_cloudinary():
        raise ValueError("Cloudinary not configured")
    
    folder = current_app.config.get('CLOUDINARY_PROFILE_IMAGES_FOLDER', 'profile_images')
    result = cloudinary.uploader.upload(
        file_path,
        folder=folder,
        public_id=f"profile_{user_id}",
        overwrite=True,
        resource_type="image"
    )
    return result.get('secure_url')


def upload_learning_video(file_path, gesture_name):
    """Upload learning video to Cloudinary."""
    if not configure_cloudinary():
        raise ValueError("Cloudinary not configured")
    
    folder = current_app.config.get('CLOUDINARY_LEARNING_VIDEOS_FOLDER', 'learning_videos')
    result = cloudinary.uploader.upload(
        file_path,
        folder=folder,
        resource_type="video"
    )
    return result.get('secure_url')


def upload_gesture_image(file_path, gesture_name):
    """Upload gesture image to Cloudinary."""
    if not configure_cloudinary():
        raise ValueError("Cloudinary not configured")
    
    folder = current_app.config.get('CLOUDINARY_GESTURE_IMAGES_FOLDER', 'gesture_images')
    result = cloudinary.uploader.upload(
        file_path,
        folder=folder,
        public_id=gesture_name,
        overwrite=True,
        resource_type="image"
    )
    return result.get('secure_url')


def upload_captured_gesture(file_path, user_id, timestamp):
    """Upload captured gesture image to Cloudinary."""
    if not configure_cloudinary():
        raise ValueError("Cloudinary not configured")
    
    folder = current_app.config.get('CLOUDINARY_CAPTURED_GESTURES_FOLDER', 'captured_gestures')
    result = cloudinary.uploader.upload(
        file_path,
        folder=folder,
        public_id=f"gesture_{user_id}_{timestamp}",
        resource_type="image"
    )
    return result.get('secure_url')


def upload_base64_image(base64_data, user_id, timestamp):
    """Upload base64 encoded image to Cloudinary."""
    if not configure_cloudinary():
        raise ValueError("Cloudinary not configured")
    
    folder = current_app.config.get('CLOUDINARY_CAPTURED_GESTURES_FOLDER', 'captured_gestures')
    result = cloudinary.uploader.upload(
        f"data:image/jpeg;base64,{base64_data}",
        folder=folder,
        public_id=f"gesture_{user_id}_{timestamp}",
        resource_type="image"
    )
    return result.get('secure_url')