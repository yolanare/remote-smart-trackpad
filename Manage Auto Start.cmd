@echo off
setlocal
cd /d "%~dp0"
if /i "%~1"=="enable" goto enable
if /i "%~1"=="disable" goto disable
if /i "%~1"=="status" goto status
if not "%~1"=="" (
  echo Usage: "%~nx0" [enable^|disable^|status]
  exit /b 2
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0host\tray\manage-auto-start.ps1"
set "result=%errorlevel%"
if not "%result%"=="0" echo Auto-start configuration could not be changed.
echo.
pause
exit /b %result%
:enable
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0host\tray\manage-auto-start.ps1" -Mode Enable
exit /b %errorlevel%
:disable
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0host\tray\manage-auto-start.ps1" -Mode Disable
exit /b %errorlevel%
:status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0host\tray\manage-auto-start.ps1" -Mode Status
exit /b %errorlevel%
