@echo off
cd /d "%~dp0"
python -m nanikiru_factory.server
if errorlevel 1 (
  echo Failed to start the admin app.
  pause
)

