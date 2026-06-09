"""
Gesture Dynamics Model Training Script
Trains on hand MOVEMENTS across multiple frames
Extracts motion features that distinguish between different gesture types
"""

import numpy as np
import os
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
import joblib

# Paths
DATA_DIR = "gesture_dynamics_dataset"
MODEL_DIR = "models"
DYNAMICS_MODEL_FILE = os.path.join(MODEL_DIR, "gesture_dynamics_model.pkl")
DYNAMICS_SCALER_FILE = os.path.join(MODEL_DIR, "dynamics_scaler.pkl")

Path(MODEL_DIR).mkdir(exist_ok=True)

def extract_motion_features(frames_array):
    """
    Extract motion features from sequence of frames
    Captures hand movement patterns across time
    
    frames_array: numpy array of shape (15, 480, 640) - grayscale video frames
    Returns: 1D feature vector representing hand dynamics
    """
    
    features = []
    
    # 1. Optical flow approximation (frame differences)
    frame_diffs = []
    for i in range(len(frames_array) - 1):
        diff = np.abs(frames_array[i+1] - frames_array[i])
        frame_diffs.append(diff)
    
    frame_diffs = np.array(frame_diffs)  # Shape: (14, 480, 640)
    
    # 2. Motion magnitude statistics
    motion_magnitudes = np.sum(frame_diffs, axis=(1, 2))  # Total motion per frame
    features.extend([
        np.mean(motion_magnitudes),      # Average motion
        np.std(motion_magnitudes),       # Motion consistency
        np.max(motion_magnitudes),       # Peak motion
        np.min(motion_magnitudes)        # Min motion
    ])
    
    # 3. Motion direction analysis
    for i in range(0, len(frame_diffs) - 1, 2):
        # Compare consecutive frame differences
        motion_direction = np.sum((frame_diffs[i] - frame_diffs[i+1]) ** 2)
        features.append(motion_direction)
    
    # 4. Temporal centroid (where gesture is concentrated in time)
    temporal_centroid = np.average(range(len(motion_magnitudes)), 
                                   weights=motion_magnitudes / np.sum(motion_magnitudes))
    features.append(temporal_centroid)
    
    # 5. Spatial motion distribution (where motion occurs in image)
    for frame_diff in frame_diffs[::3]:  # Every 3rd frame
        # Divide image into quadrants and sum motion in each
        h, w = frame_diff.shape
        q1 = np.sum(frame_diff[:h//2, :w//2])
        q2 = np.sum(frame_diff[:h//2, w//2:])
        q3 = np.sum(frame_diff[h//2:, :w//2])
        q4 = np.sum(frame_diff[h//2:, w//2:])
        features.extend([q1, q2, q3, q4])
    
    # 6. Motion acceleration (change in motion magnitude)
    motion_accel = np.diff(motion_magnitudes)
    features.extend([
        np.mean(motion_accel),
        np.std(motion_accel),
        np.max(motion_accel)
    ])
    
    # 7. Downsample first and last frames for static position
    first_frame_ds = frames_array[0][::20, ::20].flatten()[:8]
    last_frame_ds = frames_array[-1][::20, ::20].flatten()[:8]
    features.extend(first_frame_ds)
    features.extend(last_frame_ds)
    
    return np.array(features)

def load_training_data():
    """Load gesture dynamics samples"""
    X = []  # Features (motion patterns)
    y = []  # Labels (gesture names)
    
    if not os.path.exists(DATA_DIR):
        print(f"Error: {DATA_DIR} not found!")
        return None, None
    
    gesture_dirs = [d for d in os.listdir(DATA_DIR) 
                   if os.path.isdir(os.path.join(DATA_DIR, d))]
    
    if not gesture_dirs:
        print(f"Error: No gesture directories found in {DATA_DIR}")
        return None, None
    
    print(f"Found gestures: {gesture_dirs}\n")
    
    for gesture in gesture_dirs:
        gesture_path = os.path.join(DATA_DIR, gesture)
        samples = [f for f in os.listdir(gesture_path) if f.endswith('.npy')]
        
        if not samples:
            print(f"Warning: No samples found for gesture '{gesture}'")
            continue
        
        print(f"Loading {gesture}: {len(samples)} samples", end=" ")
        loaded_count = 0
        
        for sample_file in sorted(samples):
            try:
                # Load frame sequence
                frames_path = os.path.join(gesture_path, sample_file)
                frames = np.load(frames_path)
                
                # Extract motion features
                features = extract_motion_features(frames)
                
                if features is not None and len(features) > 0:
                    X.append(features)
                    y.append(gesture)
                    loaded_count += 1
            except Exception as e:
                print(f"\nError loading {sample_file}: {e}")
        
        if loaded_count > 0:
            print(f"[OK] ({loaded_count} loaded)")
        else:
            print(f"[FAIL] (0 loaded - check samples)")
    
    return np.array(X) if X else None, np.array(y) if y else None

def train_dynamics_model():
    """Train gesture dynamics model"""
    print("\n" + "="*60)
    print("GESTURE DYNAMICS MODEL TRAINING")
    print("="*60)
    
    # Load data
    print("\nLoading gesture dynamics data...")
    X, y = load_training_data()
    
    if X is None or len(X) == 0:
        print("\n[FAIL] No training data found!")
        print("First run: python collect_gesture_dynamics.py")
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
    print("Splitting data for validation (80/20)...")
    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=0.2, random_state=42, stratify=y
    )
    
    # Train model
    print("Training Random Forest on gesture dynamics...")
    model = RandomForestClassifier(
        n_estimators=300,  # More trees for better accuracy
        max_depth=20,
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
        print("\nRecommendations for improvement:")
        print("  - Collect more samples (100+ per gesture)")
        print("  - Vary gesture speed and smoothness")
        print("  - Perform gestures from different angles")
        print("  - Ensure consistent lighting")
    
    # Save model
    print(f"\nSaving dynamics model to {DYNAMICS_MODEL_FILE}...")
    joblib.dump(model, DYNAMICS_MODEL_FILE)
    
    print(f"Saving scaler to {DYNAMICS_SCALER_FILE}...")
    joblib.dump(scaler, DYNAMICS_SCALER_FILE)
    
    print("\n" + "="*60)
    print("[OK] DYNAMICS MODEL TRAINING COMPLETE!")
    print("="*60)
    print(f"Model saved: {DYNAMICS_MODEL_FILE}")
    print(f"Scaler saved: {DYNAMICS_SCALER_FILE}")
    print("\nThe model is ready to recognize hand gesture MOVEMENTS!")
    
    return True

if __name__ == "__main__":
    try:
        train_dynamics_model()
    except Exception as e:
        print(f"\nError during training: {e}")
        import traceback
        traceback.print_exc()
