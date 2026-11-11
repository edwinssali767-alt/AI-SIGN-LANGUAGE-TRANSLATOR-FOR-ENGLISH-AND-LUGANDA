# Letter Capture Feature (Finger Spelling)

## Overview

The letter capture feature enables users to spell out complete words by capturing individual sign language letters (finger spelling). This allows for translating any word, not just predefined gestures.

## Features

### 1. **Real-Time Letter Recognition**
- Capture individual letter gestures from a webcam
- System recognizes letters A-Z in real-time
- Visual feedback showing the currently recognized letter
- Letters are accumulated in real-time display

### 2. **Word Building**
- Letters accumulate as you capture them
- See your spelled word building in real-time
- View letter count and word length statistics
- Option to undo the last letter or clear all

### 3. **Word Translation**
- Translate spelled-out words to English and Luganda
- Maintains translation history for logged-in users
- No need for pre-defined gesture entries

### 4. **Interactive Features**
- Camera access with real-time video feed
- Letter gallery for quick reference or manual input
- Copy spelled word to clipboard
- Language selection (English/Luganda)

## How to Use

### Step 1: Access Letter Capture
1. Navigate to the "Letters (Finger Spelling)" page from any navigation menu
2. Or go directly to: `http://localhost:5000/frontend/letters.html`

### Step 2: Start Camera
1. Click "Start Camera" button
2. Allow browser permissions to access your webcam
3. Position your hand in the camera view

### Step 3: Capture Letters
1. Show each letter gesture to the camera
2. Click "Capture Letter" when ready
3. System recognizes and displays the letter
4. Repeat for each letter in your word

### Step 4: Build Your Word
- Watch your word build in real-time
- Letters display in the "Recognized Letters" section
- The "Spelled Word" field shows the complete word

### Step 5: Manage Your Word
- **Undo**: Remove the last letter
- **Clear All**: Start over with a new word
- **Copy Word**: Copy spelled word to clipboard

### Step 6: Translate
1. Select your target language (English or Luganda)
2. Click "Translate" button
3. View translation result
4. Result is saved to your translation history

## Database Changes

### New Table: `letter_gestures`
Stores all 26 letter gestures (A-Z)

```sql
CREATE TABLE letter_gestures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    letter TEXT NOT NULL UNIQUE,
    gesture_name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### Sample Data
- 26 records created automatically for letters A-Z
- Each letter has a corresponding gesture name (e.g., "letter_a", "letter_b")

## API Endpoints

### 1. Get All Letter Gestures
```
GET /api/letters
Response: List of all 26 letter gestures with descriptions
```

### 2. Recognize Letter from Image
```
POST /api/recognize-letter
Request: {
    gesture_image: "base64_encoded_image"
}
Response: {
    letter: "A",
    success: true
}
```

### 3. Spell Word (Accumulate Letters)
```
POST /api/spell-word
Request: {
    letters: ["H", "E", "L", "L", "O"],
    target_language: "english"
}
Response: {
    word: "HELLO",
    letter_count: 5,
    success: true
}
```

### 4. Translate Spelled Word
```
POST /api/translate-word
Request: {
    word: "hello",
    target_language: "english"
}
Response: {
    word: "hello",
    word_uppercase: "HELLO",
    letter_count: 5,
    source: "finger_spelling",
    target_language: "english",
    success: true
}
```

## Technical Implementation

### Frontend Components

#### Files
- **letters.html**: Main UI page
- **letters.css**: Styling for letter capture interface
- **letters.js**: JavaScript logic for camera, recognition, and display

#### Key Classes
- `LetterCapture`: Main controller class handling all letter capture operations

#### Features in letters.js
- Camera initialization and stream management
- Frame capture and canvas processing
- Real-time letter recognition API calls
- Word building and display logic
- Translation functionality
- Letter gallery rendering

### Backend Components

#### Files Modified
- **database.py**: Added `letter_gestures` table and initialization
- **gesture_processor.py**: Added `recognize_letter()` and `_detect_letter_by_shape()` methods
- **app.py**: Added 4 new API endpoints for letter operations

#### Letter Recognition Algorithm
1. Decode gesture image (base64 to image)
2. Convert to grayscale and normalize
3. Extract shape features:
   - Center of mass
   - Edge detection (Sobel-like)
   - Quadrant intensity analysis
   - Aspect ratio and fill ratio
4. Use trained model if available
5. Fallback to shape-based classification

## Training Letter Models (Optional)

For better accuracy, you can train a custom letter gesture model:

```bash
cd backend
python train_gesture_model.py --mode letters
```

This will:
1. Use gesture data from the dataset
2. Train a model specifically for letter gestures
3. Save the model to `models/gesture_dynamics_model.pkl`

## Usage Statistics

The system tracks letter capture usage:
- Total letters captured (per session)
- Word length statistics
- Translation history (for logged-in users)
- Recognition status

## Limitations & Future Improvements

### Current Limitations
- Requires single letter per capture (not continuous motion)
- Model accuracy depends on training data
- Maximum word length: 50 characters

### Planned Improvements
- [ ] Continuous motion detection for letter sequences
- [ ] Custom dictionary for common words
- [ ] Multi-language support
- [ ] Confidence scores for each letter
- [ ] Audio feedback during capture
- [ ] Gesture variations for different hand positions
- [ ] Letter video tutorials
- [ ] Practice mode with challenges

## Troubleshooting

### Camera Not Detected
- Check browser permissions
- Try a different browser
- Restart the application

### Letters Not Recognized
- Ensure good lighting
- Position hand clearly in camera view
- Make distinct letter gestures
- Check that camera resolution is adequate

### Translation Not Working
- Verify internet connection
- Check backend server status
- Ensure letters are valid A-Z
- Check language selection

## Security Notes

- Letter recognition uses webcam (no data stored)
- Gesture images processed server-side, not persisted
- Translation history logged only for authenticated users
- All user data encrypted in transit (HTTPS)

## Performance Considerations

- Camera stream: ~30 FPS
- Recognition latency: ~500ms
- Word build display: Real-time
- Translation API: ~1 second

## References

- [Letter Gesture Database Format](./STRUCTURE.md)
- [API Documentation](./API_ENDPOINTS.md)
- [Training Guide](./TRAINING_GUIDE.md)
- [Authentication](./AUTHENTICATION.md)
