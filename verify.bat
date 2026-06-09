@echo off
REM Windows File Verification Script

echo.
echo ========================================
echo  Sign Language Translator
echo  Installation Verification
echo ========================================
echo.

setlocal enabledelayedexpansion
set "missing=0"

REM Check root files
echo Checking root files...
for %%F in (README.md QUICKSTART.md STRUCTURE.md start.bat start.sh) do (
    if exist "%%F" (
        echo   ✓ %%F
    ) else (
        echo   ✗ %%F MISSING
        set /a missing=!missing!+1
    )
)

echo.
echo Checking backend files...
for %%F in (backend\app.py backend\config.py backend\database.py backend\gesture_processor.py backend\translator.py backend\requirements.txt) do (
    if exist "%%F" (
        echo   ✓ %%F
    ) else (
        echo   ✗ %%F MISSING
        set /a missing=!missing!+1
    )
)

echo.
echo Checking frontend files...
for %%F in (frontend\index.html frontend\gestures.html frontend\admin.html frontend\styles.css frontend\gestures.css frontend\admin.css frontend\translator.js frontend\gestures.js frontend\admin.js) do (
    if exist "%%F" (
        echo   ✓ %%F
    ) else (
        echo   ✗ %%F MISSING
        set /a missing=!missing!+1
    )
)

echo.
echo ========================================
if "%missing%"=="0" (
    echo  ✓ All files present!
    echo.
    echo  Package is ready to deploy.
    echo.
    echo  Next steps:
    echo  1. Run 'start.bat' to launch the application
    echo  OR
    echo  2. Follow manual setup in QUICKSTART.md
) else (
    echo  ✗ Missing %missing% file(s)
    echo.
    echo  Please ensure all files are present.
)
echo ========================================
echo.
pause
