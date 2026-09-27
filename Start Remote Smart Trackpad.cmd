@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required: https://nodejs.org/
  pause
  exit /b 1
)
echo Keep this window open while using Remote Smart Trackpad.
set "REMOTE_SMART_TRACKPAD_OPEN_SETUP=1"
node host\server.js
echo.
echo The server stopped.
pause
