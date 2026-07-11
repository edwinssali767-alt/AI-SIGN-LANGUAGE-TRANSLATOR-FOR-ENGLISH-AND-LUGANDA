# Sign Language Translator for English and Luganda

A comprehensive web application that translates hand gestures into English and Luganda using computer vision and machine learning. Built with a clean frontend-backend architecture.

## 📋 Features

### Main Translator
- **Real-time Gesture Recognition**: Capture hand gestures via webcam
- **Image Upload**: Upload gesture images for translation
- **Dual Language Support**: Translate to English and Luganda
- **Instant Feedback**: Get immediate translation results

### Gesture Library
- Browse all available sign language gestures
- Search and filter gestures
- View detailed gesture information
- Language-specific filtering

### Admin Panel
- Secure login system (credentials: admin/admin123)
- Add new gestures to the database
- Edit existing gesture meanings
- Delete outdated gestures
- View system statistics
- Database management

## 🏗️ Architecture

### Frontend (HTML, CSS, JavaScript)
```
frontend/
├── index.html           # Main translator page
├── gestures.html        # Gesture library
├── admin.html          # Admin panel
├── styles.css          # Global styles
├── translator.js       # Translator logic
├── gestures.js         # Gesture library logic
├── admin.js            # Admin functionality
├── admin.css           # Admin styles
└── gestures.css        # Gestures page styles
```

### Backend (Python Flask)
```
backend/
├── app.py              # Main Flask application
├── config.py           # Configuration settings
├── database.py         # Database initialization
├── gesture_processor.py # Gesture recognition
├── translator.py       # Translation logic
└── requirements.txt    # Python dependencies
```

## 🎨 Theme Colors
- **Primary**: Black (#1a1a1a)
- **Secondary**: Grey (#b3b3b3)
- **Accent**: White (#ffffff)
- **Background**: Light Grey (#f5f5f5 and #f9f9f9)

## 🚀 Quick Start

### Prerequisites
- Python 3.7+
- Modern web browser (Chrome, Firefox, Safari, Edge)

### Installation & Running

#### Windows
1. Open Command Prompt
2. Navigate to the project directory
3. Run: `start.bat`

#### Linux/Mac
1. Open Terminal
2. Navigate to the project directory
3. Run: `chmod +x start.sh && ./start.sh`

### Manual Setup

#### Backend
```bash
cd backend
python -m venv venv
# On Windows: venv\Scripts\activate
# On Unix/Mac: source venv/bin/activate
pip install -r requirements.txt
python app.py
```
Backend will run on: `http://localhost:5000`

#### Frontend
1. Open `frontend/index.html` in your web browser
   - Or use any local server: `python -m http.server 8000`
   - Then visit: `http://localhost:8000/frontend/index.html`

## 📱 Usage

### Using the Translator
1. Click "Start Camera" to begin gesture capture
2. Show your hand gesture to the camera
3. Click "Capture Gesture" when ready
4. Select target language (English or Luganda)
5. View instant translation

### Viewing Gestures
1. Navigate to "All Gestures" page
2. Browse available sign language gestures
3. Use search to find specific gestures
4. Filter by language
5. Click on a gesture to see details

### Admin Functions
1. Go to the Admin panel
2. Login with credentials:
   - Username: `admin`
   - Password: `admin123`
3. Add new gestures with English and Luganda meanings
4. Edit or delete existing gestures
5. View system statistics

## 📊 Database

The system uses SQLite with the following tables:

- **gestures**: Stores gesture definitions
- **translations**: Logs translation history
- **admin_users**: Admin account management

Database file: `sign_translator.db` (auto-created on first run)

## 🔌 API Endpoints

### Public Endpoints
- `GET /api/health` - Health check
- `POST /api/translate` - Translate gesture
- `GET /api/gestures` - Get all gestures
- `GET /api/gestures/<id>` - Get gesture details

### Admin Endpoints
- `POST /api/admin/login` - Admin login
- `POST /api/admin/gestures` - Add gesture
- `PUT /api/admin/gestures/<id>` - Update gesture
- `DELETE /api/admin/gestures/<id>` - Delete gesture
- `GET /api/admin/stats` - Get statistics

## 🔄 Project Structure

```
SIGN LANGUAGE TRANSLATOR FOR ENGLISH AND LUGANDA/
├── backend/                 # Python Flask API
│   ├── app.py
│   ├── config.py
│   ├── database.py
│   ├── gesture_processor.py
│   ├── translator.py
│   ├── requirements.txt
│   └── sign_translator.db  (created at runtime)
├── frontend/               # Web interface
│   ├── index.html
│   ├── admin.html
│   ├── gestures.html
│   ├── styles.css
│   ├── admin.css
│   ├── gestures.css
│   ├── translator.js
│   ├── admin.js
│   └── gestures.js
├── start.bat              # Windows startup script
├── start.sh               # Unix startup script
└── README.md              # This file
```

## 🛠️ Configuration

Edit `backend/config.py` to customize:
- Flask debug mode
- Database location
- Upload folder
- Gesture model path
- Confidence thresholds

## 📝 Initial Gestures

The system comes with 6 pre-loaded gestures:
1. **Hello** (Wabale)
2. **Thank you** (Asante)
3. **Yes** (Yee)
4. **No** (Nedda)
5. **Good** (Nyo)
6. **Bad** (Bibi)

Use the admin panel to add more!

## 🚀 Future Enhancements

- [ ] Integrate MediaPipe for advanced gesture recognition
- [ ] Train custom ML model for better accuracy
- [ ] Add more languages
- [ ] Video tutorial support
- [ ] User authentication
- [ ] Gesture learning mode
- [ ] Export/Import gesture databases
- [ ] Mobile app support
- [ ] Real-time multi-gesture recognition
- [ ] Sound/audio output for translations

## 🐛 Troubleshooting

### Backend won't start
- Ensure Python 3.7+ is installed
- Check if port 5000 is available
- Run: `pip install -r requirements.txt`

### Camera not working
- Check browser camera permissions
- Ensure camera is connected and not in use
- Try a different browser

### Admin login fails
- Ensure backend is running
- Try resetting credentials: edit `database.py` and re-initialize
- Clear browser localStorage: Press F12 → Application → Clear

### Database errors
- Delete `sign_translator.db` to reset
- Backend will recreate it on next run

## 📄 License

This project is open source and available for educational and personal use.

## ✨ Notes

- Always run the backend before accessing the frontend
- Use modern browsers for best compatibility
- Camera access requires HTTPS in production
- Database is stored locally (not in cloud)

## 🤝 Support

For issues or questions:
1. Check the README thoroughly
2. Verify all files are in correct directories
3. Ensure backend is running on port 5000
4. Check browser console for errors (F12)

---

**Version**: 1.0
**Last Updated**: 2026
**Theme**: Black, White, Grey (Minimalist Professional)
