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

:: Read port from config.json (default 3001)
set WEB_PORT=3001
if exist "%~dp0config.json" (
    for /f "tokens=2 delims=:," %%a in ('findstr /i "\"port\"" "%~dp0config.json"') do (
        for /f "tokens=0 delims= " %%b in ("%%a") do set WEB_PORT=%%b
    )
)
:: Remove quotes from port
set WEB_PORT=%WEB_PORT:"=%
set WEB_PORT=%WEB_PORT: =%

:: Find Edge browser
set EDGE=
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe
if "%EDGE%"=="" set EDGE=msedge.exe

echo [OK] Opening Shrift on port %WEB_PORT%...
echo [..] Close the app window to stop services.
echo.

:: Open as PWA-style app window, WAIT until user closes it
start /WAIT "" "%EDGE%" --app=http://localhost:%WEB_PORT%

:: User closed the app, stop services
echo [..] Stopping services...
powershell.exe -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
echo [OK] Services stopped.
timeout /t 2 >nul
