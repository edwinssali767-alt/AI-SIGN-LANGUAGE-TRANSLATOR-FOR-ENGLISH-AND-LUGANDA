"""
Gesture Dynamics Collection Script
Captures hand gesture MOVEMENTS (not just static poses)
Records hand motion across multiple frames for more accurate recognition
"""

import cv2
import os
import json
from pathlib import Path
import numpy as np
import threading
import time

# Configuration
DATA_DIR = "gesture_dynamics_dataset"
FRAMES_PER_GESTURE = 15  # Capture 15 frames per gesture sample
SAMPLES_PER_GESTURE = 50  # Number of video samples per gesture
FPS = 30

# Create dataset directory
Path(DATA_DIR).mkdir(exist_ok=True)

def collect_gesture_dynamics():
    """Collect hand gesture DYNAMICS (motion sequences)"""
    
    print("\n" + "="*60)
    print("GESTURE DYNAMICS COLLECTION SYSTEM")
    print("Capture hand MOVEMENTS, not just static poses!")
    print("="*60)
    
    # Get list of gestures to collect
    print("\nEnter the gestures you want to collect (comma-separated):")
    print("Example: hello, thank_you, yes, no, good, bad")
    gestures_input = input("Gestures: ").strip()
    gestures = [g.strip().lower() for g in gestures_input.split(",")]
    
    for gesture in gestures:
        gesture_dir = os.path.join(DATA_DIR, gesture)
        Path(gesture_dir).mkdir(exist_ok=True)
        
        # Count existing samples
        existing_samples = len([f for f in os.listdir(gesture_dir) if f.endswith('.npy')])
        
        print(f"\n{'='*60}")
        print(f"Collecting MOTION SAMPLES for gesture: {gesture.upper()}")
        print(f"Existing samples: {existing_samples}")
        print(f"Samples to collect: {SAMPLES_PER_GESTURE}")
        print(f"Frames per sample: {FRAMES_PER_GESTURE}")
        print(f"{'='*60}")
        
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            print("Error: Could not open camera!")
            return
        
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        cap.set(cv2.CAP_PROP_FPS, FPS)
        
        sample_count = existing_samples
        frames_buffer = []
        recording = False
        frame_count = 0
        
        print(f"\nPress 'SPACE' to start recording a gesture sample")
        print(f"Press 'R' to reset current recording")
        print(f"Press 'Q' to finish and move to next gesture\n")
        
        while sample_count < SAMPLES_PER_GESTURE:
            ret, frame = cap.read()
            if not ret:
                break
            
            # Flip for selfie view
            frame = cv2.flip(frame, 1)
            
            # Draw UI
            h, w = frame.shape[:2]
            
            # Draw guide zones
            cv2.rectangle(frame, (100, 50), (w-100, h-100), (100, 255, 100), 2)
            cv2.putText(frame, "Gesture Area", (120, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (100, 255, 100), 2)
            
            # Status display
            status_text = f"Sample {sample_count + 1}/{SAMPLES_PER_GESTURE}"
            if recording:
                status_text += f" | Recording: {frame_count}/{FRAMES_PER_GESTURE}"
                cv2.rectangle(frame, (10, 10), (300, 50), (0, 0, 255), -1)
                cv2.putText(frame, "REC", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
            
            cv2.putText(frame, status_text, (10, h-20), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            
            # Display frame
            cv2.imshow(f"Gesture Collection - {gesture.upper()}", frame)
            
            # Key handling
            key = cv2.waitKey(1) & 0xFF
            
            if key == ord(' '):  # Space - start recording
                if not recording:
                    recording = True
                    frames_buffer = []
                    frame_count = 0
                    print(f"Recording started for sample {sample_count + 1}...")
            
            elif key == ord('r'):  # R - reset
                if recording:
                    recording = False
                    frames_buffer = []
                    frame_count = 0
                    print("Recording reset.")
            
            elif key == ord('q'):  # Q - quit gesture collection
                break
            
            # Capture frame if recording
            if recording:
                # Convert to grayscale and normalize
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                gray_norm = gray.astype(np.float32) / 255.0
                frames_buffer.append(gray_norm)
                frame_count += 1
                
                if frame_count >= FRAMES_PER_GESTURE:
                    # Save sample
                    save_gesture_dynamics(gesture_dir, sample_count, frames_buffer)
                    sample_count += 1
                    frame_count = 0
                    frames_buffer = []
                    recording = False
                    print(f"[OK] Sample {sample_count} saved!")
        
        cap.release()
        cv2.destroyAllWindows()
        
        print(f"\n[OK] Completed collecting {sample_count} samples for '{gesture}'")
    
    print("\n" + "="*60)
    print("[OK] DATA COLLECTION COMPLETE!")
    print("="*60)
    print(f"Dataset saved to: {DATA_DIR}")
    print("Run 'python train_gesture_dynamics.py' to train the model!")

def save_gesture_dynamics(gesture_dir, sample_id, frames):
    """Save gesture dynamics (motion sequence) as numpy array"""
    try:
        # Convert frames list to numpy array (15 frames, each 480x640)
        dynamics_array = np.array(frames)  # Shape: (15, 480, 640)
        
        # Save as numpy file
        filename = os.path.join(gesture_dir, f"sample_{sample_id}.npy")
        np.save(filename, dynamics_array)
        
        # Also save metadata JSON
        metadata = {
            "gesture": os.path.basename(gesture_dir),
            "sample_id": sample_id,
            "frames": len(frames),
            "resolution": (640, 480),
            "fps": FPS
        }
        
        json_filename = os.path.join(gesture_dir, f"sample_{sample_id}.json")
        with open(json_filename, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        return True
    except Exception as e:
        print(f"Error saving sample: {e}")
        return False

if __name__ == "__main__":
    try:
        collect_gesture_dynamics()
    except KeyboardInterrupt:
        print("\n\nCollection interrupted by user.")
    except Exception as e:
        print(f"Error: {e}")
