$ErrorActionPreference = 'Stop'

Write-Host '=== Test 1: Dispatch mode (no agent, goes to main) ==='
try {
    $body = '{"model":"openclaw/main","messages":[{"role":"user","content":"ping"}],"stream":true}'
    $headers = @{
        'Content-Type' = 'application/json'
        'Authorization' = 'Bearer hermes-local-dev'
        'x-openclaw-agent-id' = 'main'
        'x-openclaw-session-key' = 'agent:main:webui'
    }
    $response = Invoke-WebRequest -Uri 'http://localhost:3001/v1/chat/completions' -Method POST -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 60
    $lines = $response.Content -split "`n"
    $deltaLines = @($lines | Where-Object { $_ -match 'delta.*content' })
    $doneLines = @($lines | Where-Object { $_ -match '\[DONE\]' })
    Write-Host 'Delta:' $deltaLines.Count 'DONE:' $doneLines.Count
    if ($doneLines.Count -eq 1) { Write-Host '[PASS]' } else { Write-Host '[FAIL]' }
} catch { Write-Host 'Error:' $_.Exception.Message }

Write-Host ''
Write-Host '=== Test 2: Direct mode (agent-mpm470b4rlng = 小李子) ==='
try {
    $body2 = '{"model":"openclaw/agent-mpm470b4rlng","messages":[{"role":"user","content":"ping"}],"stream":true}'
    $headers2 = @{
        'Content-Type' = 'application/json'
        'Authorization' = 'Bearer hermes-local-dev'
        'x-openclaw-agent-id' = 'agent-mpm470b4rlng'
        'x-openclaw-session-key' = 'agent:agent-mpm470b4rlng:webui'
    }
    $response2 = Invoke-WebRequest -Uri 'http://localhost:3001/v1/chat/completions' -Method POST -Headers $headers2 -Body $body2 -UseBasicParsing -TimeoutSec 60
    $lines2 = $response2.Content -split "`n"
    $deltaLines2 = @($lines2 | Where-Object { $_ -match 'delta.*content' })
    $doneLines2 = @($lines2 | Where-Object { $_ -match '\[DONE\]' })
    Write-Host 'Delta:' $deltaLines2.Count 'DONE:' $doneLines2.Count
    
    $fullText = ''
    foreach ($line in $deltaLines2) {
        if ($line -match '"content"\s*:\s*"([^"]*)"') {
            $fullText += $Matches[1]
        }
    }
    Write-Host 'Response:' $fullText.Substring(0, [Math]::Min($fullText.Length, 200))
    
    if ($doneLines2.Count -eq 1) { Write-Host '[PASS]' } else { Write-Host '[FAIL]' }
} catch { Write-Host 'Error:' $_.Exception.Message }

Write-Host ''
Write-Host '=== Test 3: Health check ==='
try {
    $wc = New-Object System.Net.WebClient
    $result = $wc.DownloadString('http://localhost:3001/api/health')
    Write-Host 'Health:' $result
} catch { Write-Host 'Error:' $_.Exception.Message }
