@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0host\manage-auto-start.ps1"
if errorlevel 1 echo Auto-start configuration could not be changed.
echo.
pause
