@echo off
REM Sign Language Translator - Startup Script for Windows

echo.
echo ========================================
echo  Sign Language Translator
echo  Starting Application...
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.7+ from https://www.python.org
    pause
    exit /b 1
)

REM Navigate to backend directory
cd backend

REM Check if virtual environment exists
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
call venv\Scripts\activate.bat

REM Install requirements
echo Installing dependencies...
pip install -r requirements.txt

REM Check if database exists
if not exist sign_translator.db (
    echo Initializing database...
)

REM Start backend server
echo.
echo ========================================
echo  Starting Backend Server (Port 5000)...
echo ========================================
echo.
echo Backend running at: http://localhost:5000
echo.

start cmd /k python app.py

REM Wait a moment for backend to start
timeout /t 3 /nobreak

REM Navigate back and open frontend
cd ..

echo.
echo ========================================
echo  Opening Frontend in Browser...
echo ========================================
echo.

REM Open frontend in default browser
start frontend/index.html

echo.
echo Application started!
echo.
echo Frontend: Open frontend/index.html in your browser
echo Admin Panel: http://localhost:8000/frontend/admin.html
echo Gestures: http://localhost:8000/frontend/gestures.html
echo.
echo Default Admin Credentials:
echo Username: admin
echo Password: admin123
echo.
echo Press any key to close this window...
pause
