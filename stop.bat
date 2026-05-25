@echo off
cd /d "%~dp0"
echo [..] Stopping Shrift Web UI...
powershell.exe -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
pause
