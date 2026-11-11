@echo off
setlocal
title Car Theme Studio

:: ---- Relaunch as Administrator if needed (Java install and some setup need admin) ----
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting Administrator permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
echo Starting Car Theme Studio on http://localhost:8765/ ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ThemeStudio.ps1"
echo.
echo Car Theme Studio stopped.
pause
