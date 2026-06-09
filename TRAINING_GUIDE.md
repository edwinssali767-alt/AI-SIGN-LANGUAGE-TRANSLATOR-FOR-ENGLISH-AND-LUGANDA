# 🤖 Gesture AI Training Guide

## Complete Step-by-Step Instructions

Your sign language translator now has a **complete AI training system**. Follow these steps to train custom gesture recognition.

---

## **STEP 1: Collect Gesture Training Data**

### What You Need:
- Webcam
- Good lighting
- Room to move your hands
- 15-30 minutes per gesture set

### Run Data Collection Script:

```bash
cd backend
python collect_gesture_data.py
```

### What Happens:
1. Script asks: "Enter gestures to collect (comma-separated)"
2. Example input: `hello, thank_you, yes, no, good, bad, water, mother, father`
3. For each gesture:
   - Webcam opens
   - Position your hand in frame (green border = hand detected)
   - Press **C** to capture a sample (you need 30 samples per gesture)
   - Press **Q** to move to next gesture

### Tips for Better Results:
- ✅ Good lighting - face a window or lamp
- ✅ Clear hand visibility - fill half the frame with your hand
- ✅ Varied angles - capture hand at different angles and positions
- ✅ Consistent distance - keep hand ~50-100cm from camera
- ✅ Relaxed hand - capture natural gesture poses

### Output:
Training data saved in: `backend/gesture_dataset/`
```
gesture_dataset/
├── hello/
│   ├── sample_0.json
│   ├── sample_1.json
│   └── ... (30 samples)
├── thank_you/
├── yes/
└── ... (all your gestures)
```

---

## **STEP 2: Train the AI Model**

### Run Training Script:

```bash
cd backend
python train_gesture_model.py
```

### What Happens:
1. Loads all gesture samples from `gesture_dataset/`
2. Extracts hand landmarks using MediaPipe (21 points per hand)
3. Trains Random Forest ML model on all samples
4. Shows training accuracy
5. Saves trained model

### Expected Output:
```
Found gestures: ['hello', 'thank_you', 'yes', 'no', 'good', 'bad']

Loading hello: 30 samples ✓
Loading thank_you: 30 samples ✓
...

Training accuracy: 95.2%

==============================================
✓ MODEL TRAINING COMPLETE!
==============================================
Model saved: models/gesture_model.pkl
Scaler saved: models/scaler.pkl
```

### Files Created:
- `backend/models/gesture_model.pkl` - Your trained AI model
- `backend/models/scaler.pkl` - Data normalizer

---

## **STEP 3: Test Your Model**

Your backend will automatically load the trained model!

### Restart Backend:
```bash
# Kill current Flask server (Ctrl+C in terminal)
cd backend
python app.py
```

### Test in Web App:
1. Go to `http://localhost:8000`
2. Click **"Translator"** tab
3. **Allow camera access** when prompted
4. Make gestures in front of camera
5. App should recognize and translate! 🎉

---

## **STEP 4: Improve Your Model**

If accuracy is low, collect more data:

### Add More Samples:
```bash
python collect_gesture_data.py
# Select same gestures - samples will be added to existing folders
```

### Retrain:
```bash
python train_gesture_model.py
# Model will retrain with all samples (old + new)
```

### Expected Accuracy Improvements:
- **30 samples/gesture** → 60-70% accuracy
- **50 samples/gesture** → 75-85% accuracy
- **100 samples/gesture** → 90%+ accuracy

---

## **Gesture Suggestion List**

For English + Luganda Sign Language:

### Basic Gestures:
- `hello` - Waving hand
- `thank_you` - Gratitude gesture
- `yes` - Nodding/thumbs up
- `no` - Head shake/palm out
- `good` - Thumbs up
- `bad` - Thumbs down

### Enhanced Gestures:
- `water` - Drinking gesture
- `mother` - Hands together/chest
- `father` - Hands apart/shoulders
- `help` - Hands clasped
- `sorry` - Hand on chest
- `love` - Heart shape with hands
- `eat` - Hand to mouth
- `sleep` - Head on hands
- `work` - Hands working motion

---

## **How It Works (Technical)**

### Data Collection:
1. MediaPipe detects 21 hand landmark points
2. Landmarks saved as JSON (x, y, z coordinates for each point)
3. Creates dataset for training

### ML Model:
1. **Algorithm**: Random Forest Classifier (100 trees)
2. **Features**: 63 normalized landmarks (21 points × 3 axes)
3. **Output**: Gesture name + confidence score

### Real-Time Detection:
1. Camera captures frame
2. MediaPipe extracts hand landmarks
3. Model predicts gesture with confidence score
4. If confidence > 50%, returns gesture
5. App translates to English/Luganda

---

## **Troubleshooting**

### ❌ "ModuleNotFoundError: No module named 'scikit-learn'"
```bash
cd backend
pip install scikit-learn
```

### ❌ Low accuracy on camera
- Collect more samples (50-100 per gesture)
- Ensure good lighting
- Keep hand angle consistent with training data

### ❌ Model not loading
- Check `models/gesture_model.pkl` exists
- Backend terminal should show: `✓ Trained gesture model loaded successfully`

### ❌ Camera not working
- Allow browser camera permissions
- Check Settings → Privacy → Camera
- Try different browser (Chrome recommended)

---

## **Next Steps**

### Deployment:
1. Collect 200+ samples per gesture
2. Train final model (95%+ accuracy)
3. Save model file safely
4. Deploy backend to server

### Advanced Features:
- Add confidence scoring to UI
- Save recognized gestures to user history
- Batch gesture recognition
- Multi-hand gestures

---

## **Quick Reference**

```bash
# Collect training data
python collect_gesture_data.py

# Train model
python train_gesture_model.py

# Test in web app
# Go to: http://localhost:8000
```

---

**Your AI gesture recognizer is ready! 🎉**

Train with 30+ samples per gesture for best results.
