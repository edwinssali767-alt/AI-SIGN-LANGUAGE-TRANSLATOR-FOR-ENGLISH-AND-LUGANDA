# Project Directory Structure

## Complete Layout

```
SIGN LANGUAGE TRANSLATOR FOR ENGLISH AND LUGANDA/
│
├── 📄 README.md                    # Full documentation & features
├── 📄 QUICKSTART.md               # Quick setup guide
├── 🔵 start.bat                   # Windows automatic startup
├── 🔵 start.sh                    # Linux/Mac startup script
│
├── 📁 backend/                    # Python Flask API Server
│   ├── 📄 app.py                  # Main Flask application
│   │   └── Endpoints:
│   │       ├── GET  /api/health                    # Health check
│   │       ├── POST /api/translate                 # Translate gesture
│   │       ├── GET  /api/gestures                  # Get all gestures
│   │       ├── GET  /api/gestures/<id>             # Get gesture details
│   │       ├── POST /api/admin/login               # Admin login
│   │       ├── POST /api/admin/gestures            # Add gesture
│   │       ├── PUT  /api/admin/gestures/<id>       # Update gesture
│   │       ├── DELETE /api/admin/gestures/<id>     # Delete gesture
│   │       └── GET  /api/admin/stats               # Get statistics
│   │
│   ├── 📄 config.py               # Configuration settings
│   │   ├── DEBUG mode
│   │   ├── DATABASE path
│   │   ├── UPLOAD_FOLDER
│   │   └── CORS settings
│   │
│   ├── 📄 database.py             # SQLite database management
│   │   ├── get_db()               # Get database connection
│   │   └── init_db()              # Initialize tables
│   │   Tables:
│   │   ├── gestures               # Gesture definitions
│   │   ├── translations           # Translation logs
│   │   └── admin_users            # Admin accounts
│   │
│   ├── 📄 gesture_processor.py    # Gesture recognition logic
│   │   └── GestureProcessor class
│   │       ├── process_gesture()  # Process image input
│   │       └── _recognize_gesture()  # Detect gesture
│   │
│   ├── 📄 translator.py           # Translation logic
│   │   └── Translator class
│   │       ├── translate()        # Translate gesture
│   │       └── translate_text()   # Text translation
│   │
│   ├── 📄 requirements.txt        # Python dependencies
│   │   ├── Flask==2.3.3
│   │   ├── Flask-CORS==4.0.0
│   │   ├── Pillow==10.0.0
│   │   ├── numpy==1.24.3
│   │   └── ... (more packages)
│   │
│   ├── 📁 venv/                   # Virtual environment (created on first run)
│   │   └── (Python packages)
│   │
│   └── 📄 sign_translator.db      # SQLite database (created at runtime)
│       ├── Stores gestures
│       ├── Stores translations
│       └── Stores admin users
│
└── 📁 frontend/                   # Web Interface (HTML/CSS/JS)
    │
    ├── 📄 index.html              # Main translator page
    │   ├── Camera input
    │   ├── File upload
    │   ├── Language selector
    │   └── Result display
    │
    ├── 📄 gestures.html           # Gesture library page
    │   ├── Gesture grid
    │   ├── Search & filter
    │   └── Detail modal
    │
    ├── 📄 admin.html              # Admin panel page
    │   ├── Login view
    │   ├── Dashboard
    │   ├── Statistics
    │   ├── Add gesture form
    │   ├── Edit/delete buttons
    │   └── Gesture table
    │
    ├── 📄 styles.css              # Global styles
    │   ├── Navigation bar
    │   ├── Theme colors (black, white, grey)
    │   ├── Typography
    │   ├── Responsive design
    │   └── Animations
    │
    ├── 📄 admin.css               # Admin panel specific styles
    │   ├── Login container
    │   ├── Dashboard layout
    │   ├── Form styles
    │   ├── Table styles
    │   └── Modal dialogs
    │
    ├── 📄 gestures.css            # Gestures page specific styles
    │   ├── Gesture cards
    │   ├── Grid layout
    │   ├── Search bar
    │   └── Modal styles
    │
    ├── 📄 translator.js           # Translator page logic
    │   ├── startCamera()          # Access webcam
    │   ├── captureGesture()       # Capture frame
    │   ├── processGesture()       # Send to backend
    │   ├── displayResult()        # Show translation
    │   └── handleFileUpload()     # Process image upload
    │
    ├── 📄 gestures.js            # Gestures page logic
    │   ├── loadGestures()         # Fetch all gestures
    │   ├── filterGestures()       # Search & filter
    │   ├── renderGestures()       # Display in grid
    │   └── openModal()            # Show details
    │
    └── 📄 admin.js               # Admin panel logic
        ├── handleLogin()          # Authenticate admin
        ├── handleAddGesture()     # Add new gesture
        ├── handleEditGesture()    # Update gesture
        ├── deleteGesture()        # Remove gesture
        ├── loadStats()            # Fetch statistics
        └── loadGesturesTable()    # Display all gestures
```

## Color Scheme

```
PRIMARY:      #1a1a1a (Black)
SECONDARY:    #b3b3b3 (Grey)
ACCENT:       #ffffff (White)
BACKGROUND:   #f5f5f5 (Light Grey)
BACKGROUND2:  #f9f9f9 (Lighter Grey)
```

## Port Configuration

```
Backend API:    http://localhost:5000
Frontend:       http://localhost:8000
```

## Technology Stack

```
Frontend:
  ├── HTML5
  ├── CSS3
  └── JavaScript (Fetch API)

Backend:
  ├── Python 3.7+
  ├── Flask
  ├── Flask-CORS
  ├── SQLite3
  ├── Pillow (Image processing)
  └── NumPy (Array operations)

Future ML:
  ├── MediaPipe
  ├── TensorFlow
  └── OpenCV
```

## Key Features by Category

```
🎥 Gesture Capture
├── Webcam streaming
├── Image capture
└── File upload

📚 Gesture Library
├── Browse all gestures
├── Search functionality
├── Language filtering
└── Detailed information

🔐 Admin Functions
├── Secure login
├── Add gestures
├── Edit gestures
├── Delete gestures
└── View statistics

🌐 Frontend
├── Responsive design
├── Modern UI
├── Real-time feedback
└── Error handling

⚙️ Backend
├── RESTful API
├── Database management
├── Gesture recognition
└── Translation logic
```

## Data Flow

```
1. User Input
   ↓
2. Camera Stream / File Upload
   ↓
3. Frontend JavaScript (translator.js)
   ↓
4. POST /api/translate (HTTP Request)
   ↓
5. Backend Flask (app.py)
   ↓
6. Gesture Processor (gesture_processor.py)
   ↓
7. Translator (translator.py)
   ↓
8. JSON Response
   ↓
9. Display Result (frontend)
```

## Admin Workflow

```
Admin Login
   ↓
Authentication (app.py)
   ↓
Dashboard Loading (stats, gestures)
   ↓
Admin Panel (admin.html/admin.js)
   ↓
   ├─→ Add Gesture → Database
   ├─→ Edit Gesture → Database
   ├─→ Delete Gesture → Database
   └─→ View Stats → Show metrics
```

## Database Schema

```
gestures
├── id          (Integer, Primary Key)
├── gesture_name    (Text, Unique)
├── english_meaning (Text)
├── luganda_meaning (Text)
├── description     (Text)
└── created_at  (Timestamp)

translations
├── id          (Integer, Primary Key)
├── gesture_id  (Foreign Key)
├── source_language (Text)
├── target_language (Text)
└── timestamp   (Timestamp)

admin_users
├── id          (Integer, Primary Key)
├── username    (Text, Unique)
├── password    (Text)
└── created_at  (Timestamp)
```

---

**All files are organized for clarity and scalability.**
**Theme: Professional, Minimalist, Accessible**
