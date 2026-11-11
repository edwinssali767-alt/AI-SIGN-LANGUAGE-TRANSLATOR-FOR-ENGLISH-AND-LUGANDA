@echo off
REM Sign Language Gesture Training - Quick Start Menu
cd /d "%~dp0.."
REM This script makes it easy to collect data and train your AI model

:menu
cls
echo.
echo ================================================
echo   SIGN LANGUAGE GESTURE AI TRAINING
echo ================================================
echo.
echo 1. Collect Gesture Training Data
echo 2. Train AI Model
echo 3. View Training Guide
echo 4. Exit
echo.
set /p choice="Enter your choice (1-4): "

if "%choice%"=="1" goto collect
if "%choice%"=="2" goto train
if "%choice%"=="3" goto guide
if "%choice%"=="4" goto exit
echo Invalid choice. Please try again.
timeout /t 2 > nul
goto menu

:collect
echo.
echo Starting gesture data collection...
echo Collecting data requires:
echo - Webcam
echo - Good lighting
echo - About 15-30 minutes per gesture
echo.
pause
cd backend
python collect_gesture_data.py
echo.
echo Data collection complete! 
pause
goto menu

:train
echo.
echo Training gesture recognition model...
echo This will analyze your collected samples and train the AI.
echo.
pause
cd backend
python train_gesture_model.py
echo.
echo Training complete! Your model is ready.
echo.
pause
goto menu

:guide
cls
echo.
echo ================================================
echo   TRAINING GUIDE - QUICK REFERENCE
echo ================================================
echo.
echo STEP 1: Collect Training Data
echo Run: python collect_gesture_data.py
echo - Make 30+ samples of each gesture
echo - Position hand clearly in frame
echo - Good lighting is important
echo.
echo STEP 2: Train Model
echo Run: python train_gesture_model.py
echo - Analyzes all samples
echo - Creates gesture_model.pkl
echo - Shows accuracy
echo.
echo STEP 3: Test in Web App
echo - Go to http://localhost:8000
echo - Make gestures in front of camera
echo - Model should recognize them!
echo.
echo TIPS FOR BETTER ACCURACY:
echo - Collect 50-100 samples per gesture (not just 30)
echo - Vary hand angles and positions
echo - Ensure consistent lighting
echo - Train after each data collection session
echo.
pause
goto menu

:exit
echo.
echo Goodbye!
exit /b
