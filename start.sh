#!/bin/bash

# Sign Language Translator - Startup Script for Linux/Mac

echo ""
echo "========================================"
echo "  Sign Language Translator"
echo "  Starting Application..."
echo "========================================"
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is not installed"
    echo "Please install Python 3.7+ from https://www.python.org"
    exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Navigate to backend directory for the local virtual environment
cd "$ROOT_DIR/backend"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install requirements
echo "Installing dependencies..."
pip install -r requirements.txt

echo ""
echo "========================================"
echo "  Starting Backend Server (Port 5000)..."
echo "========================================"
echo ""
echo "Backend running at: http://localhost:5000"
echo ""

# Start backend server in background
cd "$ROOT_DIR"
python app.py &
BACKEND_PID=$!

# Wait until the backend is ready to accept sign-in requests
echo "Waiting for backend to be ready..."
BACKEND_READY=0
for _ in $(seq 1 30); do
    if python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/api/health', timeout=2)" >/dev/null 2>&1; then
        BACKEND_READY=1
        break
    fi
    sleep 1
done

if [ "$BACKEND_READY" -eq 1 ]; then
    echo "Backend is ready."
else
    echo "WARNING: Backend did not respond yet. Keep the backend process running and refresh the browser in a moment."
fi

echo ""
echo "========================================"
echo "  Frontend Ready"
echo "========================================"
echo ""
echo "Frontend: http://localhost:5000/welcome.html"
echo "Sign In: http://localhost:5000/auth.html?mode=signin"
echo "Admin Panel: http://localhost:5000/admin.html"
echo "Gestures: http://localhost:5000/gestures.html"
echo ""
echo "Default Admin Credentials:"
echo "Username: admin"
echo "Password: admin123"
echo ""
echo "Backend PID: $BACKEND_PID"
echo "To stop the backend, run: kill $BACKEND_PID"
echo ""
