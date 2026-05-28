$files = @(
    'state.js',
    'api.js',
    'app.js',
    'controllers\session-manager.js',
    'controllers\ws-bridge.js',
    'controllers\event-router.js',
    'components\chat-view.js',
    'components\message-renderer.js',
    'components\stream-renderer.js',
    'components\message-builder.js',
    'components\session-interaction.js',
    'components\agent-list.js',
    'components\agent-modal.js',
    'components\welcome-view.js',
    'ui\mention-completer.js',
    'ui\menu-system.js',
    'ui\interaction-bindings.js',
    'utils\render.js',
    'views\app-view.js'
)

$failCount = 0
foreach ($f in $files) {
    $p = Join-Path 'F:\fzz-Project\openclaw-web-ui\web\js' $f
    $output = & D:\nodejs\node.exe -c $p 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAIL: $f"
        Write-Host $output
        $failCount++
    } else {
        Write-Host "OK: $f"
    }
}
Write-Host ""
if ($failCount -eq 0) { Write-Host "All $(${files}.Count) files passed syntax check" } else { Write-Host "$failCount files FAILED" }
