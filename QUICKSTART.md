# Quick Start Guide

## 🚀 Running the Application

### Option 1: Automatic (Recommended for Beginners)

#### Windows
1. Double-click `start.bat` in the project folder
2. The backend server will start and the frontend will open automatically

#### Linux/Mac
1. Open Terminal in the project folder
2. Run: `chmod +x start.sh && ./start.sh`
3. Frontend will be ready to use

### Option 2: Manual Setup

#### Step 1: Start Backend Server

**Windows (Command Prompt):**
```bash
cd backend
python -m venv venv
venv\Scripts\activate.bat
pip install -r requirements.txt
python app.py
```

**Linux/Mac (Terminal):**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

You should see:
```
 * Running on http://127.0.0.1:5000
```

#### Step 2: Start Frontend Server

**Open New Terminal/Command Prompt in project root:**

**Windows:**
```bash
cd frontend
python -m http.server 8000
```

**Linux/Mac:**
```bash
cd frontend
python3 -m http.server 8000
```

You should see:
```
Serving HTTP on 0.0.0.0 port 8000 ...
```

#### Step 3: Access the Application

Open your browser and go to:
- **Translator**: http://localhost:8000/index.html
- **Gestures**: http://localhost:8000/gestures.html
- **Admin Panel**: http://localhost:8000/admin.html

## 📋 Initial Admin Credentials

```
Username: admin
Password: admin123
```

⚠️ **Important**: Change these credentials in production!

## ✅ Verification Checklist

- [ ] Backend running on http://localhost:5000
- [ ] Frontend accessible on http://localhost:8000
- [ ] Can open index.html in browser
- [ ] Admin login works with default credentials
- [ ] Database (sign_translator.db) created in backend folder

## 🔧 Common Issues

### "Connection refused" error
- ✓ Make sure backend is running on port 5000
- ✓ Check if Python is properly installed
- ✓ Try restarting the backend server

### "Cannot find module" error
- ✓ Ensure virtual environment is activated
- ✓ Run: `pip install -r requirements.txt`

### Camera not accessing
- ✓ Check browser permissions (click camera icon in address bar)
- ✓ Ensure only one tab is accessing camera
- ✓ Try different browser

### "Port already in use"
- ✓ Backend: Change port 5000 in app.py and translator.js/admin.js
- ✓ Frontend: Use different port: `python -m http.server 8001`

## 📱 Using on Your Network

To access from another computer on your network:

1. Find your computer's IP address:
   - Windows: `ipconfig` (look for IPv4 Address)
   - Mac/Linux: `ifconfig` (look for inet address)

2. Access from other computer:
   - Replace `localhost` with your IP address
   - Example: `http://192.168.1.100:8000/index.html`

## 🎬 First Steps

1. **Test the Translator**
   - Click "Start Camera"
   - Show a hand gesture
   - Click "Capture Gesture"
   - See the translation

2. **Browse Gestures**
   - View all available gestures
   - Search for specific ones

3. **Admin Panel**
   - Login with admin/admin123
   - Add new gesture
   - View statistics

## 📚 File Structure Reminder

```
project/
├── backend/          ← Server (Python)
│   ├── app.py
│   └── requirements.txt
├── frontend/         ← Website (HTML/CSS/JS)
│   ├── index.html
│   ├── admin.html
│   └── ...
├── start.bat         ← Windows startup
├── start.sh          ← Mac/Linux startup
└── README.md         ← Full documentation
```

## 🔐 Security Notes

- Default admin credentials are for development only
- Change password before deployment
- Use HTTPS in production
- Don't expose .db files publicly

## 📞 Need Help?

1. Read the main README.md
2. Check troubleshooting section
3. Verify all files are present
4. Ensure ports 5000 and 8000 are free

---

**Ready? Click 'start.bat' (Windows) or run './start.sh' (Mac/Linux) to begin!**
