param([switch]$NoBrowser)

$ErrorActionPreference = 'Continue'

$WEB_PORT = 3001
$SERVER_JS = "$PSScriptRoot\server.js"
$CONFIG_JSON = "$PSScriptRoot\config.json"

# 鈹€鈹€ 妫€娴?Node.js 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
$NODE = (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
if (-not $NODE) {
    Write-Host "[FAIL] 鏈壘鍒?Node.js锛岃鍏堝畨瑁?Node.js锛坔ttps://nodejs.org锛? -ForegroundColor Red
    exit 1
}

# 鈹€鈹€ 妫€娴嬪苟鑷姩瀹夎椤圭洰渚濊禆 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
$NODE_MODULES = "$PSScriptRoot\node_modules"
if (-not (Test-Path "$NODE_MODULES\ws\package.json")) {
    Write-Host "[..] 妫€娴嬪埌缂哄皯渚濊禆锛屾鍦ㄨ嚜鍔ㄥ畨瑁?npm install..." -ForegroundColor Yellow
    Push-Location $PSScriptRoot
    & $NODE -e "const c=require('child_process'); c.execSync('npm install',{cwd:'$PSScriptRoot'.replace(/\\/g,'/'),stdio:'inherit',shell:true})" 2>&1
    Pop-Location
    if (-not (Test-Path "$NODE_MODULES\ws\package.json")) {
        Write-Host "[FAIL] 鑷姩瀹夎澶辫触锛岃鎵嬪姩杩愯: cd /d `"$PSScriptRoot`" && npm install" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] 渚濊禆瀹夎瀹屾垚" -ForegroundColor Green
}

# 鈹€鈹€ 璇诲彇 config.json锛堝鏋滃瓨鍦級 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
$GATEWAY_PORT = 18789
$WEB_PORT = 3001
$GATEWAY_TOKEN = 'hermes-local-dev'
if (Test-Path $CONFIG_JSON) {
    try {
        $cfg = Get-Content $CONFIG_JSON -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.port) { $WEB_PORT = $cfg.port }
        if ($cfg.gatewayUrl) {
            $uri = [uri]$cfg.gatewayUrl
            if ($uri.Port -gt 0) { $GATEWAY_PORT = $uri.Port }
        }
        if ($cfg.gatewayToken) { $GATEWAY_TOKEN = $cfg.gatewayToken }
        if ($cfg.openclawConfigPath) {
            $OPENCLAW_CONFIG_PATH_FROM_CFG = $cfg.openclawConfigPath
        } else {
            $OPENCLAW_CONFIG_PATH_FROM_CFG = ''
        }
    } catch {}
} else {
    $OPENCLAW_CONFIG_PATH_FROM_CFG = ''
}

# 鈹€鈹€ 灏濊瘯浠?openclaw.json 璇诲彇 Token/绔彛 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function _readOpenclawConfig {
    param($path)
    if (-not (Test-Path $path)) { return $null }
    try {
        $data = Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
        return $data
    } catch { return $null }
}

$openclawData = $null
if ($env:OPENCLAW_CONFIG_PATH -and (Test-Path $env:OPENCLAW_CONFIG_PATH)) {
    $openclawData = _readOpenclawConfig $env:OPENCLAW_CONFIG_PATH
}
if (-not $openclawData) {
    $candidates = @()
    if ($env:APPDATA) { $candidates += "$env:APPDATA\openclaw\openclaw.json" }
    if ($env:LOCALAPPDATA) { $candidates += "$env:LOCALAPPDATA\openclaw\openclaw.json" }
    if ($env:USERPROFILE) { $candidates += "$env:USERPROFILE\.openclaw\openclaw.json" }
    if ($env:HOME) { $candidates += "$env:HOME\.openclaw\openclaw.json" }
    foreach ($c in $candidates) {
        $d = _readOpenclawConfig $c
        if ($d) { $openclawData = $d; break }
    }
}
if ($openclawData -and $openclawData.gateway) {
    if ($openclawData.gateway.port) { $GATEWAY_PORT = $openclawData.gateway.port }
    if ($openclawData.gateway.auth -and $openclawData.gateway.auth.token) {
        $GATEWAY_TOKEN = $openclawData.gateway.auth.token
    }
}

# 鈹€鈹€ 妫€娴?OpenClaw CLI 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
$NPM_GLOBAL = & $NODE -e "console.log(require('child_process').execSync('npm prefix -g').toString().trim())" 2>$null
$OPENCLAW_MJS = if ($NPM_GLOBAL) { Join-Path $NPM_GLOBAL 'node_modules\openclaw\openclaw.mjs' } else { '' }
if (-not $OPENCLAW_MJS -or -not (Test-Path $OPENCLAW_MJS)) {
    $OPENCLAW_MJS = & $NODE -e "try{console.log(require.resolve('openclaw/openclaw.mjs'))}catch{console.log('')}" 2>$null
}
if (-not $OPENCLAW_MJS -or -not (Test-Path $OPENCLAW_MJS)) {
    Write-Host "[FAIL] 鏈壘鍒?OpenClaw锛岃杩愯: npm install -g openclaw" -ForegroundColor Red
    exit 1
}

# 鈹€鈹€ 纭畾 OpenClaw 鏁版嵁鐩綍 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
if ($OPENCLAW_CONFIG_PATH_FROM_CFG -and $OPENCLAW_CONFIG_PATH_FROM_CFG.Length -gt 0 -and (Test-Path $OPENCLAW_CONFIG_PATH_FROM_CFG)) {
    $OPENCLAW_STATE_DIR = Split-Path $OPENCLAW_CONFIG_PATH_FROM_CFG -Parent
    $OPENCLAW_CONFIG_PATH = $OPENCLAW_CONFIG_PATH_FROM_CFG
} elseif ($env:OPENCLAW_STATE_DIR) {
    $OPENCLAW_STATE_DIR = $env:OPENCLAW_STATE_DIR
    $OPENCLAW_CONFIG_PATH = Join-Path $OPENCLAW_STATE_DIR 'openclaw.json'
} else {
    $OPENCLAW_STATE_DIR = if ($env:OS -eq 'Windows_NT') {
        Join-Path $env:APPDATA 'openclaw'
    } elseif ($env:XDG_DATA_HOME) {
        Join-Path $env:XDG_DATA_HOME 'openclaw'
    } else {
        Join-Path $env:HOME '.openclaw'
    }
    $OPENCLAW_CONFIG_PATH = Join-Path $OPENCLAW_STATE_DIR 'openclaw.json'
}

Write-Host "[INFO] Node: $NODE" -ForegroundColor Gray
Write-Host "[INFO] OpenClaw: $OPENCLAW_MJS" -ForegroundColor Gray
Write-Host "[INFO] State dir: $OPENCLAW_STATE_DIR" -ForegroundColor Gray

# 鈹€鈹€ 鍋ュ悍妫€鏌ュ嚱鏁?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function Test-Gateway {
    try {
        $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$GATEWAY_PORT/v1/models")
        $req.Headers.Add('Authorization', "Bearer $GATEWAY_TOKEN")
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

# 鈹€鈹€ 鍚姩 Gateway 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
$gwRunning = Test-Gateway
if ($gwRunning) {
    Write-Host "[OK] Gateway 宸插湪绔彛 $GATEWAY_PORT 杩愯" -ForegroundColor Green
} else {
    Write-Host "[..] 鍚姩 Gateway锛堢鍙?$GATEWAY_PORT锛?.." -ForegroundColor Yellow
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
            Write-Host "[OK] Gateway 灏辩华锛?{waited}s锛? -ForegroundColor Green
            break
        }
        Write-Host "." -NoNewline
    }
    if ($waited -ge $maxWait) {
        Write-Host "`n[FAIL] Gateway 鏈兘鍦?${maxWait}s 鍐呭惎鍔? -ForegroundColor Red
        if (Test-Path $gwLog) { Get-Content $gwLog -Tail 20 | Write-Host -ForegroundColor Red }
        exit 1
    }
}

# 鈹€鈹€ 鍚姩 Web UI 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
$webRunning = Test-WebUI
if ($webRunning) {
    Write-Host "[OK] Web UI 宸插湪绔彛 $WEB_PORT 杩愯" -ForegroundColor Green
} else {
    Write-Host "[..] 鍚姩 Web UI锛堢鍙?$WEB_PORT锛?.." -ForegroundColor Yellow
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
            Write-Host "[OK] Web UI 灏辩华锛?{waited}s锛? -ForegroundColor Green
            break
        }
    }
    if ($waited -ge $maxWait) {
        Write-Host "[FAIL] Web UI 鏈兘鍦?${maxWait}s 鍐呭惎鍔? -ForegroundColor Red
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
