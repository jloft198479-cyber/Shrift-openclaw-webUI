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
set WEB_PORT=%WEB_PORT:"=%
set WEB_PORT=%WEB_PORT: =%

:: Find Edge browser
set EDGE=
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe
if "%EDGE%"=="" set EDGE=msedge.exe

echo [OK] Opening Shrift on port %WEB_PORT%...
start "" "%EDGE%" --app=http://localhost:%WEB_PORT%

echo.
echo =====================================
echo   Shrift is running.
echo   Close THIS window to stop services.
echo =====================================
echo.

:: Keep the window open; when user closes it, stop services
pause

echo [..] Stopping services...
powershell.exe -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
echo [OK] Services stopped.
timeout /t 2 >nul
