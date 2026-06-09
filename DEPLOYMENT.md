# Sign Language Translator - Installation & Deployment Guide

## 📦 System Requirements

- **Operating System**: Windows 10+, macOS 10.12+, Linux (Ubuntu 18.04+)
- **Python**: 3.7 or higher
- **Browser**: Chrome, Firefox, Safari, or Edge (latest version)
- **RAM**: 2GB minimum (4GB recommended)
- **Disk Space**: 500MB

## 🔍 Pre-Installation Checklist

```
☐ Python 3.7+ installed
☐ Internet connection
☐ Administrator/sudo access
☐ Ports 5000 and 8000 are free
☐ Webcam available (for gesture capture)
☐ All project files downloaded
```

## 🚀 Installation Steps

### Step 1: Verify Installation Package

Run the verification script:

**Windows:**
```bash
double-click verify.bat
```

**Linux/Mac:**
```bash
chmod +x verify.sh
./verify.sh
```

All files should show ✓ (checkmark)

### Step 2: Install Python Dependencies

**Windows:**
```bash
cd backend
python -m venv venv
venv\Scripts\activate.bat
pip install --upgrade pip
pip install -r requirements.txt
```

**Linux/Mac:**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### Step 3: Initialize Database

The database is automatically created on first backend run. If you need to reset:

**Windows:**
```bash
cd backend
del sign_translator.db
cd ..
python app.py
```

**Linux/Mac:**
```bash
cd backend
rm sign_translator.db
cd ..
python3 app.py
```

## 🏃 Running the Application

### Automatic Startup (Recommended)

**Windows:**
```bash
double-click start.bat
```

**Linux/Mac:**
```bash
chmod +x start.sh
./start.sh
```

### Manual Startup

#### Terminal 1 - Backend:
```bash
cd backend
# Activate venv first
cd ..
python app.py
# For deployment/hosting: gunicorn -w 1 -b 0.0.0.0:$PORT wsgi:app
# or python3 app.py on Mac/Linux
```

Wait for: `Running on http://127.0.0.1:5000`

#### Terminal 2 - Frontend:
```bash
cd frontend
python -m http.server 8000
# or python3 -m http.server 8000 on Mac/Linux
```

Wait for: `Serving HTTP on 0.0.0.0 port 8000`

#### Browser:
Open: `http://localhost:8000/index.html`

## 📋 First Time Setup

1. **Backend starts and creates database**
   - Initial gestures are populated
   - Admin user created (admin/admin123)

2. **Enter admin panel**
   - Go to: `http://localhost:8000/admin.html`
   - Login: admin / admin123

3. **Add test data (optional)**
   - This step is automatic
   - Sample gestures are pre-loaded

4. **Test translator**
   - Go to: `http://localhost:8000/index.html`
   - Start camera or upload image
   - Verify translation works

## 🔐 Security Configuration

### Change Default Admin Password

1. Go to Admin Panel
2. Login with admin/admin123
3. Admin credentials stored in database

### For Production Deployment

1. **Change SECRET_KEY in backend/config.py:**
   ```python
   SECRET_KEY = 'your-new-secret-key-change-this'
   ```

2. **Set DEBUG to False:**
   ```python
   DEBUG = False
   ```

3. **Use HTTPS:**
   - Obtain SSL certificate
   - Configure web server (Nginx/Apache)

4. **Set up reverse proxy:**
   - Example Nginx config for backend
   - Example Apache config for frontend

## 📊 Database Management

### Access Database

**Using Python:**
```python
import sqlite3
conn = sqlite3.connect('backend/sign_translator.db')
cursor = conn.cursor()
cursor.execute('SELECT * FROM gestures')
print(cursor.fetchall())
```

**Using DB Browser:**
- Download: https://sqlitebrowser.org
- Open: `sign_translator.db`
- Browse tables and data

### Backup Database

```bash
# Windows
copy backend\sign_translator.db backup\sign_translator_backup.db

# Linux/Mac
cp backend/sign_translator.db backup/sign_translator_backup.db
```

### Reset Database

```bash
# Windows
del backend\sign_translator.db

# Linux/Mac
rm backend/sign_translator.db
```

Backend will recreate on next run.

## 🌐 Network Access

### Local Area Network (LAN)

1. Find your IP:
   - Windows: `ipconfig` → IPv4 Address
   - Mac/Linux: `ifconfig` → inet address

2. Share URL with others:
   ```
   http://YOUR_IP:8000/index.html
   ```

3. Everyone on same WiFi can access

### Internet Access (Not Recommended Without Security)

Would require:
- Public IP address
- Port forwarding
- SSL certificate
- Firewall configuration
- User authentication

## 🛠️ Troubleshooting

### Python Not Found
```bash
# Check Python installation
python --version
# or
python3 --version

# Add to PATH if needed
# Windows: Search "Environment Variables" → Add Python path
# Mac/Linux: Add to .bash_profile or .bashrc
```

### Virtual Environment Issues
```bash
# Recreate virtual environment
rm -rf backend/venv
python -m venv backend/venv
# Activate and install
```

### Port Already in Use
```bash
# Windows - Find process using port
netstat -ano | findstr :5000

# Mac/Linux - Find process
lsof -i :5000

# Kill process (Windows)
taskkill /PID [PID] /F

# Kill process (Mac/Linux)
kill -9 [PID]
```

### Database Corruption
```bash
# Delete and recreate
rm backend/sign_translator.db
python app.py
# For deployment/hosting: gunicorn -w 1 -b 0.0.0.0:$PORT wsgi:app
```

### CORS Issues
- CORS is enabled in app.py
- Check browser console for error messages
- Verify backend is running

## 📱 Mobile Access

### On Same Network

1. Find computer IP address
2. On mobile device, visit:
   ```
   http://[COMPUTER_IP]:8000/index.html
   ```

3. Note: Camera access may not work on all mobile browsers

### Production Mobile

- Deploy to cloud server
- Use responsive design (already implemented)
- Configure HTTPS
- Set up user authentication

## 🔄 Updates & Maintenance

### Update Python Packages
```bash
pip install --upgrade -r backend/requirements.txt
```

### Backup Gestures
```bash
# Export to CSV
sqlite3 backend/sign_translator.db \
  "SELECT * FROM gestures" > gestures_backup.csv
```

### Monitor Performance
- Check browser console (F12)
- Check backend terminal for errors
- Monitor database size

## 📝 Configuration Files

### backend/config.py
```python
DEBUG = True                           # False in production
DATABASE = 'sign_translator.db'        # Database path
UPLOAD_FOLDER = 'uploads'             # Upload directory
MAX_CONTENT_LENGTH = 16 * 1024 * 1024 # Max file size
CONFIDENCE_THRESHOLD = 0.7            # Detection threshold
```

### Modify Ports

**Change Backend Port (backend/app.py):**
```python
app.run(debug=True, host='0.0.0.0', port=5001)  # Change 5000 to 5001
```

Then update frontend config (frontend/*.js):
```javascript
const API_BASE = 'http://localhost:5001/api';  // Update to 5001
```

**Change Frontend Port (terminal):**
```bash
python -m http.server 8001  # Change 8000 to 8001
```

## 🚨 Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `ModuleNotFoundError: No module named 'flask'` | Flask not installed | `pip install flask` |
| `Address already in use` | Port taken | Stop process using port |
| `CORS error` | Backend not running | Start backend on 5000 |
| `OSError: [Errno 48] Address already in use` | Port conflict | Use different port |
| `No module named 'PIL'` | Pillow not installed | `pip install Pillow` |

## 📞 Support Resources

- Python Documentation: https://docs.python.org
- Flask Documentation: https://flask.palletsprojects.com
- Database Browser: https://sqlitebrowser.org
- Browser Developer Tools: Press F12

## ✅ Deployment Checklist

```
Pre-Deployment:
☐ All files present and verified
☐ Python 3.7+ installed
☐ All dependencies installed
☐ Database initialized
☐ Admin credentials changed

Testing:
☐ Backend runs without errors
☐ Frontend accessible
☐ Admin login works
☐ Can capture/upload gestures
☐ Translations working
☐ Add/edit/delete gestures working

Production:
☐ DEBUG set to False
☐ SECRET_KEY changed
☐ HTTPS enabled
☐ Firewall configured
☐ Backups created
☐ Monitoring set up
```

## 📚 Additional Resources

- README.md - Full documentation
- QUICKSTART.md - Quick setup guide
- STRUCTURE.md - Project structure details
- This file - Deployment guide

---

**Version**: 1.0
**Last Updated**: 2026
**Maintained By**: Your Team

For additional help, refer to the respective documentation or check the code comments.
