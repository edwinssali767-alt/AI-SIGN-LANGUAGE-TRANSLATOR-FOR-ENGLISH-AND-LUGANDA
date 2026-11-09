"""Gesture processing module with static and motion-model support."""

import base64
import io
import threading
from collections import deque
from pathlib import Path

import joblib
import numpy as np
from PIL import Image


BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT_DIR = BASE_DIR.parent


class GestureProcessor:
    """Processes static and motion gestures using trained models when present."""

    def __init__(self):
        self.static_model = None
        self.static_scaler = None
        self.motion_model = None
        self.motion_scaler = None
        self.frame_buffer = deque(maxlen=15)
        self.supported_gestures = {
            'hello': 'hello',
            'thank_you': 'thank_you',
            'yes': 'yes',
            'no': 'no',
            'good': 'good',
            'bad': 'bad',
            'water': 'water',
            'mother': 'mother',
            'father': 'father',
        }
        self.load_models()

    HAND_MODEL_PATH = PROJECT_ROOT_DIR / 'frontend' / 'models' / 'hand_landmarker.task'

    def _hand_detector(self):
        """Lazily create a MediaPipe hand detector (offline, same model the browser uses)."""
        if getattr(self, '_detector_failed', False):
            return None
        if getattr(self, '_detector', None) is None:
            try:
                import mediapipe as mp
                from mediapipe.tasks import python as mp_tasks
                from mediapipe.tasks.python import vision
                options = vision.HandLandmarkerOptions(
                    base_options=mp_tasks.BaseOptions(model_asset_path=str(self.HAND_MODEL_PATH)),
                    num_hands=1,
                    running_mode=vision.RunningMode.IMAGE,
                )
                self._mp = mp
                self._detector = vision.HandLandmarker.create_from_options(options)
                self._detector_lock = threading.Lock()
            except Exception as exc:
                print(f'[WARN] Hand detector unavailable, legacy recognition is disabled: {exc}')
                self._detector_failed = True
                return None
        return self._detector

    def hand_present(self, image):
        """True only if a real hand is found. The old pixel model reacts to brightness and edges, so it
        must never be trusted on a picture that has no hand in it (it said 'hello' for a blank wall)."""
        detector = self._hand_detector()
        if detector is None:
            return False
        try:
            if hasattr(image, 'convert'):
                rgb = np.array(image.convert('RGB'))
            else:
                gray = (np.asarray(image) * 255).astype(np.uint8)
                rgb = np.stack([gray] * 3, axis=-1)
            with self._detector_lock:
                result = detector.detect(self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb))
            return bool(result.hand_landmarks)
        except Exception as exc:
            print(f'Hand check error: {exc}')
            return False

    def load_models(self):
        """Load trained gesture models and scalers from the backend models directory."""
        static_model_path = self._first_existing(
            PROJECT_ROOT_DIR / 'models' / 'gesture_model.pkl',
            BASE_DIR / 'models' / 'gesture_model.pkl',
        )
        static_scaler_path = self._first_existing(
            PROJECT_ROOT_DIR / 'models' / 'scaler.pkl',
            BASE_DIR / 'models' / 'scaler.pkl',
        )
        motion_model_path = self._first_existing(
            PROJECT_ROOT_DIR / 'models' / 'gesture_dynamics_model.pkl',
            BASE_DIR / 'models' / 'gesture_dynamics_model.pkl',
        )
        motion_scaler_path = self._first_existing(
            PROJECT_ROOT_DIR / 'models' / 'dynamics_scaler.pkl',
            BASE_DIR / 'models' / 'dynamics_scaler.pkl',
        )

        try:
            if static_model_path.exists() and static_scaler_path.exists():
                self.static_model = joblib.load(static_model_path)
                self.static_scaler = joblib.load(static_scaler_path)
                print('[OK] Static gesture model loaded successfully')
        except Exception as exc:
            print(f'[WARN] Error loading static gesture model: {exc}')
            self.static_model = None
            self.static_scaler = None

        try:
            if motion_model_path.exists() and motion_scaler_path.exists():
                self.motion_model = joblib.load(motion_model_path)
                self.motion_scaler = joblib.load(motion_scaler_path)
                print('[OK] Gesture dynamics model loaded successfully')
        except Exception as exc:
            print(f'[WARN] Error loading dynamics model: {exc}')
            self.motion_model = None
            self.motion_scaler = None

        if self.static_model is None and self.motion_model is None:
            print('[WARN] No trained gesture models were loaded. Falling back to heuristics.')

    def _first_existing(self, *paths):
        """Return the first existing path, or the first candidate for status messages."""
        for path in paths:
            if path.exists():
                return path
        return paths[0]

    def _decode_image(self, gesture_data):
        """Decode a base64 image payload into a PIL image."""
        if isinstance(gesture_data, str):
            image_data = gesture_data.split(',', 1)[1] if gesture_data.startswith('data:image') else gesture_data
            frame_bytes = base64.b64decode(image_data)
            return Image.open(io.BytesIO(frame_bytes))
        return gesture_data

    def _to_grayscale_array(self, gesture_data):
        """Convert image-like input to a normalized grayscale numpy array."""
        image = self._decode_image(gesture_data)
        if hasattr(image, 'convert'):
            image = image.convert('L')
        return np.array(image).astype(np.float32) / 255.0

    def extract_static_features(self, frame_array):
        """Match the 63-feature static-image extractor used during training."""
        features = []

        level1 = frame_array[::10, ::10].flatten()
        features.extend(level1[:20])

        level2 = frame_array[::20, ::20].flatten()
        features.extend(level2[:15])

        level3 = frame_array[::30, ::30].flatten()
        features.extend(level3[:10])

        features.extend([
            np.mean(frame_array),
            np.std(frame_array),
            np.min(frame_array),
            np.max(frame_array),
            np.median(frame_array),
        ])

        edges_h = np.abs(np.diff(frame_array, axis=0)).mean() if frame_array.shape[0] > 1 else 0.0
        edges_v = np.abs(np.diff(frame_array, axis=1)).mean() if frame_array.shape[1] > 1 else 0.0
        features.extend([edges_h, edges_v])

        features = np.array(features[:63], dtype=np.float32)
        if len(features) < 63:
            features = np.pad(features, (0, 63 - len(features)))
        return features

    def add_frame(self, frame_data):
        """Add a frame to the buffer for motion analysis."""
        try:
            frame_array = self._to_grayscale_array(frame_data)
            self.frame_buffer.append(frame_array)
            return len(self.frame_buffer)
        except Exception as exc:
            print(f'Error adding frame: {exc}')
            return 0

    def has_enough_frames(self):
        """Check if buffer has enough frames for motion prediction."""
        return len(self.frame_buffer) >= 15

    def extract_motion_features(self, frames_array):
        """Extract motion features from a frame sequence."""
        try:
            features = []
            frame_diffs = []

            for index in range(len(frames_array) - 1):
                diff = np.abs(frames_array[index + 1] - frames_array[index])
                frame_diffs.append(diff)

            frame_diffs = np.array(frame_diffs)
            motion_magnitudes = np.sum(frame_diffs, axis=(1, 2))
            features.extend([
                np.mean(motion_magnitudes),
                np.std(motion_magnitudes),
                np.max(motion_magnitudes),
                np.min(motion_magnitudes),
            ])

            for index in range(0, len(frame_diffs) - 1, 2):
                features.append(np.sum((frame_diffs[index] - frame_diffs[index + 1]) ** 2))

            total_motion = float(np.sum(motion_magnitudes))
            if total_motion <= 1e-8:
                temporal_centroid = len(motion_magnitudes) / 2
            else:
                temporal_centroid = np.average(
                    range(len(motion_magnitudes)),
                    weights=motion_magnitudes / total_motion,
                )
            features.append(temporal_centroid)

            for frame_diff in frame_diffs[::3]:
                height, width = frame_diff.shape
                quadrants = [
                    np.sum(frame_diff[:height // 2, :width // 2]),
                    np.sum(frame_diff[:height // 2, width // 2:]),
                    np.sum(frame_diff[height // 2:, :width // 2]),
                    np.sum(frame_diff[height // 2:, width // 2:]),
                ]
                features.extend(quadrants)

            motion_accel = np.diff(motion_magnitudes)
            features.extend([
                np.mean(motion_accel),
                np.std(motion_accel),
                np.max(motion_accel),
            ])

            first_frame_ds = frames_array[0][::20, ::20].flatten()[:8]
            last_frame_ds = frames_array[-1][::20, ::20].flatten()[:8]
            features.extend(first_frame_ds)
            features.extend(last_frame_ds)

            return np.array(features)
        except Exception as exc:
            print(f'Feature extraction error: {exc}')
            return None

    def predict_motion_gesture(self):
        """Predict a gesture from the buffered motion frames."""
        if not self.has_enough_frames() or self.motion_model is None or self.motion_scaler is None:
            return None
        if not self.hand_present(self.frame_buffer[-1]):
            return None

        try:
            frames_array = np.array(list(self.frame_buffer))
            features = self.extract_motion_features(frames_array)
            if features is None:
                return None

            features_scaled = self.motion_scaler.transform([features])
            prediction = self.motion_model.predict(features_scaled)[0]
            probabilities = self.motion_model.predict_proba(features_scaled)[0]
            max_confidence = float(np.max(probabilities))

            print(f'DEBUG: Motion prediction: {prediction} (confidence: {max_confidence:.2%})')
            if max_confidence >= self.MIN_CONFIDENCE:
                self.frame_buffer.clear()
                return prediction
            return None
        except Exception as exc:
            print(f'Prediction error: {exc}')
            return None

    MIN_CONFIDENCE = 0.8

    def predict_static_gesture(self, gesture_data, with_confidence=False):
        """Predict a gesture from a single image.

        Returns None when the model is missing or not confident enough (>= MIN_CONFIDENCE);
        it never guesses. With with_confidence=True returns (label, confidence).
        """
        label, confidence = None, 0.0
        try:
            if self.static_model is not None and self.static_scaler is not None                     and self.hand_present(self._decode_image(gesture_data)):
                frame_array = self._to_grayscale_array(gesture_data)
                features = self.extract_static_features(frame_array)
                features_scaled = self.static_scaler.transform([features])
                prediction = self.static_model.predict(features_scaled)[0]
                confidence = float(np.max(self.static_model.predict_proba(features_scaled)[0]))
                if confidence >= self.MIN_CONFIDENCE:
                    label = prediction
        except Exception as exc:
            print(f'Error processing static gesture: {exc}')
        return (label, confidence) if with_confidence else label

    def process_gesture(self, gesture_data):
        """Process a single image for translation."""
        return self.predict_static_gesture(gesture_data)

    def recognize_letter(self, gesture_data):
        """Recognize a single letter from a gesture image (only when a hand is actually visible)."""
        try:
            if not self.hand_present(self._decode_image(gesture_data)):
                return None
            frame_array = self._to_grayscale_array(gesture_data)

            if self.static_model is not None and self.static_scaler is not None:
                try:
                    features = []
                    height, width = frame_array.shape
                    center_mass = (
                        np.argwhere(frame_array > 0.3).mean(axis=0)
                        if np.any(frame_array > 0.3)
                        else np.array([height / 2, width / 2])
                    )
                    features.extend(center_mass / np.array([height, width]))

                    edges_y = np.diff(frame_array, axis=0)
                    edges_x = np.diff(frame_array, axis=1)
                    features.append(np.sum(np.abs(edges_y)))
                    features.append(np.sum(np.abs(edges_x)))

                    q1 = np.mean(frame_array[:height // 2, :width // 2])
                    q2 = np.mean(frame_array[:height // 2, width // 2:])
                    q3 = np.mean(frame_array[height // 2:, :width // 2])
                    q4 = np.mean(frame_array[height // 2:, width // 2:])
                    features.extend([q1, q2, q3, q4])

                    features = np.array(features).reshape(1, -1)
                    if features.shape[1] == getattr(self.static_scaler, 'n_features_in_', 0):
                        features_scaled = self.static_scaler.transform(features)
                        prediction = self.static_model.predict(features_scaled)[0]
                        if isinstance(prediction, str):
                            letter = prediction.replace('letter_', '').upper()
                            if letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
                                return letter
                except Exception as exc:
                    print(f'Model prediction error for letter: {exc}')

            return self._detect_letter_by_shape(frame_array)
        except Exception as exc:
            print(f'Error recognizing letter: {exc}')
            return None

    def _detect_letter_by_shape(self, frame_array):
        """Fallback letter recognition by basic shape analysis."""
        try:
            hand_region = frame_array > 0.3
            if not np.any(hand_region):
                return None

            y_coords, x_coords = np.argwhere(hand_region).T
            width = np.max(x_coords) - np.min(x_coords) + 1
            height = np.max(y_coords) - np.min(y_coords) + 1
            aspect_ratio = width / height if height > 0 else 0
            filled_ratio = np.sum(hand_region) / (width * height) if width * height > 0 else 0

            if aspect_ratio > 1.5:
                return 'Y'
            if aspect_ratio < 0.5:
                return 'I'
            if filled_ratio > 0.7:
                return 'A'
            return 'O'
        except Exception as exc:
            print(f'Shape detection error: {exc}')
            return None
