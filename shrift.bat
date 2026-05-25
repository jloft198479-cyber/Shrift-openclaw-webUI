@echo off
cd /d "%~dp0"
title Shrift - OpenClaw Web UI

echo [..] Starting services...
powershell.exe -ExecutionPolicy Bypass -Command "& { .\start.ps1 -NoBrowser }"
if %errorlevel% neq 0 (
    echo [FAIL] Failed to start services
    pause
    exit /b 1
)

:: Find Edge browser
set EDGE=
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe
if "%EDGE%"=="" set EDGE=msedge.exe

echo [OK] Opening Shrift...
echo [..] Close the app window to stop services.
echo.

:: Open as PWA-style app window, WAIT until user closes it
start /WAIT "" "%EDGE%" --app=http://localhost:3001

:: User closed the app, stop services
echo [..] Stopping services...
powershell.exe -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
echo [OK] Services stopped.
timeout /t 2 >nul
