@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required: https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\esbuild\package.json" (
  call npm ci
  if errorlevel 1 goto failed
)
call npm run build
if errorlevel 1 goto failed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0host\start-tray.ps1"
if errorlevel 1 goto failed
exit /b 0
:failed
echo Remote Smart Trackpad could not start.
pause
exit /b 1
