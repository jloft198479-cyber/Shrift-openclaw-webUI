@echo off
:: 虾指挥 — 双击启动
:: 以 Edge PWA 模式打开，关闭窗口自动停止服务

:: 确保 Node.js 在 PATH 中
where node >nul 2>&1 || (
  set "PATH=D:\nodejs;D:\nodejs\npm-global;%PATH%"
)

:: 启动 launcher
node "%~dp0launcher.js"
