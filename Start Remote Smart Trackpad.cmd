@echo off
setlocal
cd /d "%~dp0"
rem If the scheduled host is already running, this launcher only opens pairing.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0host\open-pairing.ps1"
if not errorlevel 1 exit /b 0
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required: https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\multicast-dns\package.json" (
  echo Installing Remote Smart Trackpad dependencies...
  call npm ci --omit=dev
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)
echo Keep this window open while using Remote Smart Trackpad.
set "REMOTE_SMART_TRACKPAD_OPEN_SETUP=1"
node host\server.js
echo.
echo The server stopped.
pause
