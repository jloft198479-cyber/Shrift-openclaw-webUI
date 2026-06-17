# Create shortcut for XiaZhiHui with logo icon
$ws = New-Object -ComObject WScript.Shell
$lnkPath = Join-Path $PSScriptRoot 'XiaZhiHui.lnk'
$sc = $ws.CreateShortcut($lnkPath)
$sc.TargetPath = Join-Path $PSScriptRoot 'launch.bat'
$sc.WorkingDirectory = $PSScriptRoot
$sc.IconLocation = Join-Path $PSScriptRoot 'web\logo.ico'
$sc.Description = 'XiaZhiHui - OpenClaw Web UI'
$sc.Save()
Write-Host "[OK] Shortcut created: XiaZhiHui.lnk" -ForegroundColor Green
