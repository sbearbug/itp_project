@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3 is not installed. Please install Python 3 and try again.
  echo You can download it from https://www.python.org/downloads/
  pause
  exit /b 1
)
python server.py
if errorlevel 1 pause
