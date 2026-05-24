$ErrorActionPreference = 'Continue'

$GATEWAY_PORT = 18789
$WEB_PORT = 3001

function Stop-ByPort {
    param([int]$Port)
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($pid in $conns) {
            Write-Host "[..] Killing PID $pid on port $Port" -ForegroundColor Yellow
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}

Write-Host "[..] Stopping Web UI (port $WEB_PORT)..." -ForegroundColor Yellow
Stop-ByPort $WEB_PORT

Write-Host "[..] Stopping Gateway (port $GATEWAY_PORT)..." -ForegroundColor Yellow
Stop-ByPort $GATEWAY_PORT

Start-Sleep -Seconds 2

$gw = try { [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$GATEWAY_PORT/v1/models").GetResponse(); $true } catch { $false }
$web = try { [System.Net.HttpWebRequest]::Create("http://localhost:$WEB_PORT/api/health").GetResponse(); $true } catch { $false }

if ($gw) { Write-Host "[WARN] Gateway still running" -ForegroundColor Red }
else { Write-Host "[OK] Gateway stopped" -ForegroundColor Green }

if ($web) { Write-Host "[WARN] Web UI still running" -ForegroundColor Red }
else { Write-Host "[OK] Web UI stopped" -ForegroundColor Green }
