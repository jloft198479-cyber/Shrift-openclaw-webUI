$ErrorActionPreference = 'Continue'

$PID_FILE = "$PSScriptRoot\.shrift-pid"
$CONFIG_JSON = "$PSScriptRoot\config.json"
$GATEWAY_PORT = 18789
$WEB_PORT = 3001

if (Test-Path $CONFIG_JSON) {
    try {
        $cfg = Get-Content $CONFIG_JSON -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.port) { $WEB_PORT = [int]$cfg.port }
        if ($cfg.gatewayUrl) {
            $uri = [uri]$cfg.gatewayUrl
            if ($uri.Port -gt 0) { $GATEWAY_PORT = [int]$uri.Port }
        }
    } catch {}
}

function Stop-ByPid {
    param([string]$Label, [int]$ProcId)
    if ($ProcId -le 0) { return $false }
    try {
        $proc = Get-Process -Id $ProcId -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "[..] Stopping $Label (PID $ProcId)..." -ForegroundColor Yellow
            Stop-Process -Id $ProcId -Force -ErrorAction SilentlyContinue
            return $true
        }
    } catch {}
    return $false
}

function Stop-ByPort {
    param([int]$Port)
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($procId in $conns) {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}

$gwStopped = $false
$webStopped = $false

if (Test-Path $PID_FILE) {
    try {
        $pids = Get-Content $PID_FILE -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($pids.gateway) { $gwStopped = Stop-ByPid 'Gateway' $pids.gateway }
        if ($pids.webui) { $webStopped = Stop-ByPid 'Web UI' $pids.webui }
    } catch {}
    Remove-Item $PID_FILE -Force -ErrorAction SilentlyContinue
}

if (-not $gwStopped) {
    Write-Host "[..] Stopping Gateway by port $GATEWAY_PORT..." -ForegroundColor Yellow
    Stop-ByPort $GATEWAY_PORT
}
if (-not $webStopped) {
    Write-Host "[..] Stopping Web UI by port $WEB_PORT..." -ForegroundColor Yellow
    Stop-ByPort $WEB_PORT
}

Start-Sleep -Seconds 2

$gw = try { [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$GATEWAY_PORT/v1/models").GetResponse(); $true } catch { $false }
$web = try { [System.Net.HttpWebRequest]::Create("http://localhost:$WEB_PORT/api/health").GetResponse(); $true } catch { $false }

if ($gw) { Write-Host "[WARN] Gateway still running" -ForegroundColor Red }
else { Write-Host "[OK] Gateway stopped" -ForegroundColor Green }

if ($web) { Write-Host "[WARN] Web UI still running" -ForegroundColor Red }
else { Write-Host "[OK] Web UI stopped" -ForegroundColor Green }
