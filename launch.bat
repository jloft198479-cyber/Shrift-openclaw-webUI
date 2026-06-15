@echo off
:: XiaZhiHui - Launch with Edge PWA mode
:: Closing the window automatically stops the service

where node >nul 2>&1 || (
  set "PATH=D:\nodejs;D:\nodejs\npm-global;%PATH%"
)

node "%~dp0launcher.js"
