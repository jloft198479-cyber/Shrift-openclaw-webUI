param([switch]$NoBrowser)

$ErrorActionPreference = 'Continue'

$GATEWAY_PORT = 18789
$WEB_PORT = 3001
$SERVER_JS = "$PSScriptRoot\server.js"

$NODE = (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
if (-not $NODE) {
    $NODE = ''
}
if (-not $NODE -and (Test-Path 'D:\nodejs\node.exe')) {
    $NODE = 'D:\nodejs\node.exe'
    $env:PATH = 'D:\nodejs;D:\nodejs\npm-global;' + $env:PATH
}
if (-not $NODE) {
    Write-Host "[FAIL] node not found in PATH. Please install Node.js first." -ForegroundColor Red
    exit 1
}

$NPM_GLOBAL = & $NODE -e "console.log(require('child_process').execSync('npm prefix -g').toString().trim())" 2>$null
$OPENCLAW_MJS = if ($NPM_GLOBAL) { Join-Path $NPM_GLOBAL 'node_modules\openclaw\openclaw.mjs' } else { '' }
if (-not $OPENCLAW_MJS -or -not (Test-Path $OPENCLAW_MJS)) {
    $OPENCLAW_MJS = & $NODE -e "try{console.log(require.resolve('openclaw/openclaw.mjs'))}catch{console.log('')}" 2>$null
}
if (-not $OPENCLAW_MJS -or -not (Test-Path $OPENCLAW_MJS)) {
    Write-Host "[FAIL] openclaw not found. Please run: npm install -g openclaw" -ForegroundColor Red
    exit 1
}

if ($env:OPENCLAW_STATE_DIR) {
    $OPENCLAW_STATE_DIR = $env:OPENCLAW_STATE_DIR
} else {
    $OPENCLAW_STATE_DIR = if ($env:OS -eq 'Windows_NT') {
        Join-Path $env:APPDATA 'openclaw'
    } elseif ($env:XDG_DATA_HOME) {
        Join-Path $env:XDG_DATA_HOME 'openclaw'
    } else {
        Join-Path $env:HOME '.openclaw'
    }
}

$OPENCLAW_CONFIG_PATH = Join-Path $OPENCLAW_STATE_DIR 'openclaw.json'

Write-Host "[INFO] Node: $NODE" -ForegroundColor Gray
Write-Host "[INFO] OpenClaw: $OPENCLAW_MJS" -ForegroundColor Gray
Write-Host "[INFO] State dir: $OPENCLAW_STATE_DIR" -ForegroundColor Gray

function Test-Gateway {
    try {
        $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$GATEWAY_PORT/v1/models")
        $req.Headers.Add('Authorization', 'Bearer hermes-local-dev')
        $req.Timeout = 3000
        $req.Method = 'GET'
        $resp = $req.GetResponse()
        $resp.Close()
        return $true
    } catch {
        return $false
    }
}

function Test-WebUI {
    try {
        $req = [System.Net.HttpWebRequest]::Create("http://localhost:$WEB_PORT/api/health")
        $req.Timeout = 3000
        $req.Method = 'GET'
        $resp = $req.GetResponse()
        $resp.Close()
        return $true
    } catch {
        return $false
    }
}

$gwRunning = Test-Gateway
if ($gwRunning) {
    Write-Host "[OK] Gateway already running on port $GATEWAY_PORT" -ForegroundColor Green
} else {
    Write-Host "[..] Starting Gateway on port $GATEWAY_PORT..." -ForegroundColor Yellow
    $env:OPENCLAW_STATE_DIR = $OPENCLAW_STATE_DIR
    $env:OPENCLAW_CONFIG_PATH = $OPENCLAW_CONFIG_PATH
    $gwLog = "$env:TEMP\openclaw-gateway.log"
    Start-Process -FilePath $NODE -ArgumentList "`"$OPENCLAW_MJS`"","gateway","--port",$GATEWAY_PORT,"--verbose" -WindowStyle Hidden -RedirectStandardOutput $gwLog -RedirectStandardError "$env:TEMP\openclaw-gateway-err.log"

    $waited = 0
    $maxWait = 60
    while ($waited -lt $maxWait) {
        Start-Sleep -Seconds 2
        $waited += 2
        if (Test-Gateway) {
            Write-Host "[OK] Gateway ready (${waited}s)" -ForegroundColor Green
            break
        }
        Write-Host "." -NoNewline
    }
    if ($waited -ge $maxWait) {
        Write-Host "`n[FAIL] Gateway did not start within ${maxWait}s" -ForegroundColor Red
        if (Test-Path $gwLog) { Get-Content $gwLog -Tail 20 | Write-Host -ForegroundColor Red }
        exit 1
    }
}

$webRunning = Test-WebUI
if ($webRunning) {
    Write-Host "[OK] Web UI already running on port $WEB_PORT" -ForegroundColor Green
} else {
    Write-Host "[..] Starting Web UI on port $WEB_PORT..." -ForegroundColor Yellow
    $env:OPENCLAW_STATE_DIR = $OPENCLAW_STATE_DIR
    $env:OPENCLAW_CONFIG_PATH = $OPENCLAW_CONFIG_PATH
    $webLog = "$env:TEMP\openclaw-webui.log"
    Start-Process -FilePath $NODE -ArgumentList "`"$SERVER_JS`"" -WindowStyle Hidden -RedirectStandardOutput $webLog -RedirectStandardError "$env:TEMP\openclaw-webui-err.log"

    $waited = 0
    $maxWait = 15
    while ($waited -lt $maxWait) {
        Start-Sleep -Seconds 1
        $waited += 1
        if (Test-WebUI) {
            Write-Host "[OK] Web UI ready (${waited}s)" -ForegroundColor Green
            break
        }
    }
    if ($waited -ge $maxWait) {
        Write-Host "[FAIL] Web UI did not start within ${maxWait}s" -ForegroundColor Red
        if (Test-Path $webLog) { Get-Content $webLog -Tail 20 | Write-Host -ForegroundColor Red }
        exit 1
    }
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  Gateway:  http://127.0.0.1:$GATEWAY_PORT" -ForegroundColor Cyan
Write-Host "  Web UI:   http://localhost:$WEB_PORT" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

if (-not $NoBrowser) {
    Start-Process "http://localhost:$WEB_PORT"
}
