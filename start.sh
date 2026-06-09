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

# Navigate to backend directory
cd backend

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
python app.py &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 3

# Navigate back
cd ..

echo ""
echo "========================================"
echo "  Frontend Ready"
echo "========================================"
echo ""
echo "Frontend: Open frontend/index.html in your browser"
echo "Admin Panel: frontend/admin.html"
echo "Gestures: frontend/gestures.html"
echo ""
echo "Default Admin Credentials:"
echo "Username: admin"
echo "Password: admin123"
echo ""
echo "Backend PID: $BACKEND_PID"
echo "To stop the backend, run: kill $BACKEND_PID"
echo ""
