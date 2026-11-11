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

set "ROOT_DIR=%~dp0..\"

REM Navigate to backend directory for the local virtual environment
cd /d "%ROOT_DIR%backend"

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

cd /d "%ROOT_DIR%"
start "Sign Language Backend" /D "%ROOT_DIR%" cmd /k "call backend\venv\Scripts\activate.bat && python backendun.py"

REM Wait until the backend is ready to accept sign-in requests
echo Waiting for backend to be ready...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(30); while((Get-Date) -lt $deadline){ try { $response=Invoke-WebRequest -Uri 'http://localhost:5000/api/health' -UseBasicParsing -TimeoutSec 2; if($response.StatusCode -eq 200){ exit 0 } } catch {}; Start-Sleep -Seconds 1 }; exit 1"
if errorlevel 1 (
    echo WARNING: Backend did not respond yet. Keep the backend window open and refresh the browser in a moment.
) else (
    echo Backend is ready.
)

echo.
echo ========================================
echo  Opening Frontend in Browser...
echo ========================================
echo.

REM Open the frontend through Flask so auth and API use the same server
start "" "http://localhost:5000/welcome.html"

echo.
echo Application started!
echo.
echo Frontend: http://localhost:5000/welcome.html
echo Sign In: http://localhost:5000/auth.html?mode=signin
echo Admin Panel: http://localhost:5000/admin.html
echo Gestures: http://localhost:5000/gestures.html
echo.
echo Default Admin Credentials:
echo Username: admin
echo Password: admin123
echo.
echo Press any key to close this window...
pause
