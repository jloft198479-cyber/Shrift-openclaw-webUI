@echo off
cd /d "%~dp0"
echo [..] Starting Shrift Web UI...
powershell.exe -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
