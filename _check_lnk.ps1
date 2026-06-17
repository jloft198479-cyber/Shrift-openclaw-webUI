$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut('F:\fzz-Project\openclaw-web-ui\XiaZhiHui.lnk')
Write-Host 'Target:' $shortcut.TargetPath
Write-Host 'WorkDir:' $shortcut.WorkingDirectory
Write-Host 'Icon:' $shortcut.IconLocation
Write-Host 'Exists:' (Test-Path $shortcut.TargetPath)
