@echo off
setlocal
cd /d "%~dp0"
node host\manage-tokens.js
if errorlevel 1 pause
