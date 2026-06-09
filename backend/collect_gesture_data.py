"""
Gesture Data Collection Script
Captures hand gesture samples for training
Run this to collect training data for each gesture
"""

import cv2
import os
import json
from pathlib import Path
import numpy as np

# Configuration
DATA_DIR = "gesture_dataset"
SAMPLES_PER_GESTURE = 100  # Number of samples to collect per gesture (increased for better accuracy)

# Create dataset directory
Path(DATA_DIR).mkdir(exist_ok=True)

def collect_gesture_samples():
    """Collect hand gesture samples from webcam"""
    
    print("\n" + "="*60)
    print("GESTURE DATA COLLECTION SYSTEM")
    print("="*60)
    
    # Get list of gestures to collect
    print("\nEnter the gestures you want to collect (comma-separated):")
    print("Example: hello, thank_you, yes, no, good, bad, water, mother, father")
    gestures_input = input("Gestures: ").strip()
    gestures = [g.strip().lower() for g in gestures_input.split(",")]
    
    for gesture in gestures:
        gesture_dir = os.path.join(DATA_DIR, gesture)
        Path(gesture_dir).mkdir(exist_ok=True)
        
        # Count existing samples
        existing_samples = len([f for f in os.listdir(gesture_dir) if f.endswith('.json')])
        
        print(f"\n{'='*60}")
        print(f"Collecting samples for gesture: {gesture.upper()}")
        print(f"Existing samples: {existing_samples}")
        print(f"Samples to collect: {SAMPLES_PER_GESTURE}")
        print(f"{'='*60}")
        
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            print("Error: Could not open camera!")
            return
        
        sample_count = existing_samples
        frame_count = 0
        
        while sample_count < existing_samples + SAMPLES_PER_GESTURE:
            ret, frame = cap.read()
            if not ret:
                break
            
            # Flip for selfie view
            frame = cv2.flip(frame, 1)
            h, w, c = frame.shape
            
            # Draw status
            status_text = f"Gesture: {gesture.upper()} | Sample: {sample_count - existing_samples + 1}/{SAMPLES_PER_GESTURE}"
            cv2.putText(frame, status_text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 
                       1, (0, 255, 0), 2)
            
            # Draw center rectangle to guide hand placement
            cv2.rectangle(frame, (w//4, h//4), (3*w//4, 3*h//4), (100, 100, 100), 2)
            cv2.putText(frame, "Position hand in box", (10, h-60),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (100, 100, 100), 2)
            
            cv2.putText(frame, "Press 'C' to capture | 'Q' to skip", (10, h-20),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            
            cv2.imshow(f"Collecting: {gesture}", frame)
            
            key = cv2.waitKey(1) & 0xFF
            if key == ord('c'):  # Capture
                # Save frame as image
                sample_file = os.path.join(gesture_dir, f"sample_{sample_count}.jpg")
                cv2.imwrite(sample_file, frame)
                
                # Also save metadata as JSON
                metadata = {
                    'gesture': gesture,
                    'sample_id': sample_count,
                    'filename': f"sample_{sample_count}.jpg"
                }
                meta_file = os.path.join(gesture_dir, f"sample_{sample_count}.json")
                with open(meta_file, 'w') as f:
                    json.dump(metadata, f)
                
                print(f"[OK] Sample {sample_count - existing_samples + 1} captured!")
                sample_count += 1
            
            elif key == ord('q'):  # Skip to next gesture
                break
        
        cap.release()
        cv2.destroyAllWindows()
        
        print(f"\n[OK] Completed {gesture.upper()} - Total samples: {sample_count}")
    
    print("\n" + "="*60)
    print("[OK] DATA COLLECTION COMPLETE!")
    print(f"Dataset saved to: {DATA_DIR}")
    print("="*60)

if __name__ == "__main__":
    try:
        collect_gesture_samples()
    except KeyboardInterrupt:
        print("\n\nData collection cancelled.")
    except Exception as e:
        print(f"\nError: {e}")
