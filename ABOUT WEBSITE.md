# Project Title -  AI Sign Language Translator for English and Luganda

## Problem & Solution

Despite the official recognition of sign language in Uganda and the efforts made by The Uganda National Association of the Deaf (UNAD) to promote sign language education and interpreter training, communication barriers between deaf and hearing individuals remained a significant challenge. 

Solution
To address these challenges, Group 41 developed an AI Sign Language Translator for English and Luganda. The system was designed to provide an affordable, accessible and technology-driven solution that facilitates real-time communication between deaf and hearing learners thereby promoting inclusion and improving access to education and essential services. 

 Setup Instructions

Follow these steps to install, configure, and run the project locally.

 1. Prerequisites

- Python 3.10 
- A modern browser such as Chrome, Edge, Firefox, or Safari
- A webcam for live gesture capture
- Git, if cloning the project from a repository

 2. Open the project folder

```powershell
cd "C:\Users\edwin\Desktop\SIGN LANGUAGE TRANSLATOR FOR ENGLISH AND LUGANDA"
```

 3. Create or activate the Python virtual environment

On Windows:

```powershell
python -m venv backend\venv
backend\venv\Scripts\activate
```

On macOS or Linux:

```bash
python3 -m venv backend/venv
source backend/venv/bin/activate
```

 4. Install dependencies

From the project root:

```powershell
python -m pip install -r requirements.txt
```

The main dependencies include Flask, Flask-CORS, Flask-SocketIO, OpenCV, MediaPipe, NumPy, scikit-learn, PyMongo, Cloudinary, and Pillow.

 5. Configure optional environment variables

The app can run locally with default settings. For production or cloud features, create `backend\.env` and add the values you need:

```env
SECRET_KEY=change-this-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
MONGODB_URI=
MONGODB_DB_NAME=sign_language_translator
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

If `MONGODB_URI` is empty, the app uses the local SQLite database configured in `backend/config.py`.

 6. Run the web app

From the project root:

```powershell
python app.py
```

If `backend\.env` already contains a MongoDB URI but you want to run locally with SQLite, start the app with MongoDB disabled for that terminal session:

```powershell
$env:MONGODB_URI = ""
$env:SEND_LOGIN_WELCOME_EMAIL = "false"
python app.py
```

Or on Windows, use the startup script:

```powershell
start.bat
```

The Flask server serves both the backend API and frontend pages.

 7. Open the app in your browser

- Main app: `http://localhost:5000/welcome.html`
- Translator: `http://localhost:5000/translator.html`
- Gesture library: `http://localhost:5000/gestures.html`
- Letter learning: `http://localhost:5000/letters.html`
- Admin panel: `http://localhost:5000/admin.html`

Default admin credentials:

```text
Username: admin
Password: admin123
```

 8. Useful checks

Health check:

```powershell
Invoke-WebRequest -Uri "http://localhost:5000/api/health" -UseBasicParsing
```

Compile check:

```powershell
python -m py_compile app.py backend\server.py backend\config.py backend\database.py backend\gesture_processor.py backend\translator.py
```
