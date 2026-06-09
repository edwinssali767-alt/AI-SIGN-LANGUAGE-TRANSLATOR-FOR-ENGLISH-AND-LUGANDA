"""
Gesture Model Training Script
Trains a gesture recognition model using collected gesture images
Extracts hand landmarks from images using MediaPipe
"""

import json
import os
import numpy as np
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
import pickle
import joblib
from PIL import Image
import io

try:
    import mediapipe as mp
    from mediapipe.python.solutions import hands as mp_hands
    HAS_MEDIAPIPE = True
except Exception as e:
    HAS_MEDIAPIPE = False
    print(f"Warning: MediaPipe not properly configured, using image features: {e}")

# Paths
DATA_DIR = "gesture_dataset"
MODEL_DIR = "models"
MODEL_FILE = os.path.join(MODEL_DIR, "gesture_model.pkl")
SCALER_FILE = os.path.join(MODEL_DIR, "scaler.pkl")

Path(MODEL_DIR).mkdir(exist_ok=True)

def extract_landmarks_from_image(image_path):
    """Extract hand landmarks from image using MediaPipe"""
    try:
        # Load image
        image = Image.open(image_path)
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        img_array = np.array(image)
        
        if not HAS_MEDIAPIPE:
            # Fallback: extract improved image features
            return extract_image_features(img_array)
        
        # Try different MediaPipe import paths
        try:
            from mediapipe.python.solutions import hands as mp_hands
        except:
            try:
                from mediapipe.solutions import hands as mp_hands
            except:
                print("Could not import MediaPipe hands, using image features")
                return extract_image_features(img_array)
        
        # Use MediaPipe to detect hand landmarks
        hands = mp_hands.Hands(
            static_image_mode=True,
            max_num_hands=1,
            min_detection_confidence=0.5
        )
        
        results = hands.process(img_array)
        
        if not results.multi_hand_landmarks:
            return None  # No hand detected
        
        # Extract landmarks from first hand
        hand_landmarks = results.multi_hand_landmarks[0]
        landmarks = []
        
        for landmark in hand_landmarks.landmark:
            landmarks.extend([landmark.x, landmark.y, landmark.z])
        
        return np.array(landmarks)
    except Exception as e:
        print(f"    Error extracting landmarks: {e}")
        return None

def extract_image_features(img_array):
    """Fallback: extract robust image features"""
    try:
        # Convert to grayscale for feature extraction
        if len(img_array.shape) == 3:
            gray = np.mean(img_array, axis=2)
        else:
            gray = img_array
        
        # Normalize
        gray = gray / 255.0
        
        # Extract multiple levels of downsampled features
        features = []
        
        # Level 1: 10x10 downsampling
        level1 = gray[::10, ::10].flatten()
        features.extend(level1[:20])
        
        # Level 2: 20x20 downsampling
        level2 = gray[::20, ::20].flatten()
        features.extend(level2[:15])
        
        # Level 3: 30x30 downsampling  
        level3 = gray[::30, ::30].flatten()
        features.extend(level3[:10])
        
        # Add statistical features
        features.extend([
            np.mean(gray),
            np.std(gray),
            np.min(gray),
            np.max(gray),
            np.median(gray)
        ])
        
        # Add edge detection features
        edges_h = np.abs(np.diff(gray, axis=0)).mean()
        edges_v = np.abs(np.diff(gray, axis=1)).mean()
        features.extend([edges_h, edges_v])
        
        # Pad to 63 features
        features = np.array(features[:63])
        if len(features) < 63:
            features = np.pad(features, (0, 63 - len(features)))
        
        return features.astype(np.float32)
    except:
        return np.zeros(63, dtype=np.float32)

def load_training_data():
    """Load gesture samples from dataset by extracting landmarks from images"""
    X = []  # Features (hand landmarks)
    y = []  # Labels (gesture names)
    
    if not os.path.exists(DATA_DIR):
        print(f"Error: {DATA_DIR} not found. Run collect_gesture_data.py first!")
        return None, None
    
    gesture_dirs = [d for d in os.listdir(DATA_DIR) if os.path.isdir(os.path.join(DATA_DIR, d))]
    
    if not gesture_dirs:
        print(f"Error: No gesture directories found in {DATA_DIR}")
        return None, None
    
    print(f"Found gestures: {gesture_dirs}\n")
    
    for gesture in gesture_dirs:
        gesture_path = os.path.join(DATA_DIR, gesture)
        samples = [f for f in os.listdir(gesture_path) if f.endswith('.jpg')]
        
        if not samples:
            print(f"[WARN] Warning: No image samples found for gesture '{gesture}'")
            continue
        
        print(f"Loading {gesture}: {len(samples)} samples", end=" ")
        loaded_count = 0
        
        for sample_file in sorted(samples):
            try:
                image_path = os.path.join(gesture_path, sample_file)
                landmarks = extract_landmarks_from_image(image_path)
                
                if landmarks is not None and len(landmarks) == 63:
                    X.append(landmarks)
                    y.append(gesture)
                    loaded_count += 1
            except Exception as e:
                pass  # Skip errors silently
        
        if loaded_count > 0:
            print(f"[OK] ({loaded_count} loaded)")
        else:
            print(f"[FAIL] (0 loaded - check images)")
    
    return np.array(X) if X else None, np.array(y) if y else None

def train_model():
    """Train gesture recognition model"""
    print("\n" + "="*60)
    print("GESTURE MODEL TRAINING")
    print("="*60)
    
    # Load data
    print("\nLoading training data...")
    X, y = load_training_data()
    
    if X is None or len(X) == 0:
        print("\n[FAIL] No training data found!")
        return False
    
    print(f"\nTraining data loaded:")
    print(f"  - Total samples: {len(X)}")
    print(f"  - Features per sample: {len(X[0])}")
    print(f"  - Unique gestures: {len(np.unique(y))}")
    print(f"  - Gestures: {list(np.unique(y))}")
    
    # Normalize features
    print("\nNormalizing features...")
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # Split for validation
    print("Splitting data for validation...")
    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=0.2, random_state=42, stratify=y
    )
    
    # Train model
    print("Training Random Forest classifier...")
    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=15,
        min_samples_split=2,
        random_state=42,
        n_jobs=-1,
        verbose=1
    )
    
    model.fit(X_train, y_train)
    
    # Evaluate
    train_accuracy = model.score(X_train, y_train)
    test_accuracy = model.score(X_test, y_test)
    
    print(f"\n{'='*60}")
    print(f"[OK] Training accuracy: {train_accuracy:.2%}")
    print(f"[OK] Validation accuracy: {test_accuracy:.2%}")
    print(f"{'='*60}")
    
    if test_accuracy < 0.75:
        print("\n[WARN] WARNING: Low validation accuracy!")
        print("  Recommendations:")
        print("  1. Collect MORE samples (100+ per gesture)")
        print("  2. Vary hand positions and angles")
        print("  3. Use different lighting conditions")
        print("  4. Ensure clear, distinct gesture poses")
        print("  5. Retrain after collecting more data")
    
    # Save model
    print(f"\nSaving model to {MODEL_FILE}...")
    joblib.dump(model, MODEL_FILE)
    
    print(f"Saving scaler to {SCALER_FILE}...")
    joblib.dump(scaler, SCALER_FILE)
    
    print("\n" + "="*60)
    print("[OK] MODEL TRAINING COMPLETE!")
    print("="*60)
    print(f"Model saved: {MODEL_FILE}")
    print(f"Scaler saved: {SCALER_FILE}")
    print("\nYour trained model is ready to use!")
    
    return True

if __name__ == "__main__":
    try:
        train_model()
    except Exception as e:
        print(f"\n[FAIL] Error during training: {e}")
        import traceback
        traceback.print_exc()
