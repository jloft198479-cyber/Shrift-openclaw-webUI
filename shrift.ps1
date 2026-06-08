$ErrorActionPreference = 'Continue'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "[..] Starting services..." -ForegroundColor Yellow
& "$ScriptDir\start.ps1" -NoBrowser
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Failed to start services" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

$WEB_PORT = 3001
$cfgPath = Join-Path $ScriptDir 'config.json'
if (Test-Path $cfgPath) {
    try {
        $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.port) { $WEB_PORT = [int]$cfg.port }
    } catch {}
}

$EDGE = $null
$c1 = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
$c2 = Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'
if (Test-Path $c1) { $EDGE = $c1 }
elseif (Test-Path $c2) { $EDGE = $c2 }
else { $EDGE = 'msedge.exe' }

# 统一使用 openclaw 数据目录下的 browser-pwa，与 launcher.js 保持一致
# 探测 openclaw 数据目录（与 start.ps1 / launcher.js 逻辑一致）
if ($env:OPENCLAW_STATE_DIR -and (Test-Path (Join-Path $env:OPENCLAW_STATE_DIR 'openclaw.json'))) {
    $stateDir = $env:OPENCLAW_STATE_DIR
} else {
    $cfgPath2 = Join-Path $ScriptDir 'config.json'
    $cfgOpenclawPath = ''
    if (Test-Path $cfgPath2) {
        try {
            $cfg2 = Get-Content $cfgPath2 -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($cfg2.openclawConfigPath -and (Test-Path $cfg2.openclawConfigPath)) {
                $cfgOpenclawPath = $cfg2.openclawConfigPath
            }
        } catch {}
    }
    if ($cfgOpenclawPath) {
        $stateDir = Split-Path $cfgOpenclawPath -Parent
    } elseif ($env:APPDATA -and (Test-Path (Join-Path $env:APPDATA 'openclaw\openclaw.json'))) {
        $stateDir = Join-Path $env:APPDATA 'openclaw'
    } elseif ($env:LOCALAPPDATA -and (Test-Path (Join-Path $env:LOCALAPPDATA 'openclaw\openclaw.json'))) {
        $stateDir = Join-Path $env:LOCALAPPDATA 'openclaw'
    } else {
        $stateDir = Join-Path $env:APPDATA 'openclaw'
    }
}
$EDGE_PROFILE = Join-Path $stateDir 'browser-pwa'
if (-not (Test-Path $EDGE_PROFILE)) {
    New-Item -ItemType Directory -Path $EDGE_PROFILE -Force | Out-Null
}

Write-Host "[OK] Opening Shrift app window..." -ForegroundColor Green
Write-Host "[..] Close the app window to stop services." -ForegroundColor Gray

$edgeProc = Start-Process -FilePath $EDGE -ArgumentList @(
    "--app=http://localhost:$WEB_PORT",
    "--user-data-dir=$EDGE_PROFILE",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=msSignin"
) -PassThru

$edgePid = 0
if ($edgeProc) { $edgePid = $edgeProc.Id }

Start-Sleep -Seconds 4

$idleCount = 0
$MAX_IDLE = 15

while ($true) {
    try {
        $alive = Get-Process -Id $edgePid -ErrorAction Stop
    } catch {
        $alive = $null
    }

    if (-not $alive) {
        Write-Host "[INFO] App window closed" -ForegroundColor Gray
        break
    }

    # 检查 TCP 连接：HTTP 短连接 + WebSocket 长连接
    # netstat 输出中 WebSocket 连接也显示为 ESTABLISHED
    $conns = netstat -ano 2>$null | Select-String ":$WEB_PORT " | Select-String "ESTABLISHED"
    if ($conns) {
        $idleCount = 0
    } else {
        $idleCount++
        if ($idleCount -ge $MAX_IDLE) {
            Write-Host "[INFO] No connections, stopping" -ForegroundColor Gray
            break
        }
    }

    Start-Sleep -Seconds 1
}

Start-Sleep -Seconds 1

# 清理引用了我们 profile 的所有 Edge 进程
$pwaDirName = Split-Path $EDGE_PROFILE -Leaf
$shriftProcs = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object {
    try {
        $wmi = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue
        $wmi -and $wmi.CommandLine -like "*$pwaDirName*"
    } catch { $false }
}
if ($shriftProcs) {
    Write-Host "[..] Cleaning up Shrift processes..." -ForegroundColor Yellow
    $shriftProcs | Stop-Process -Force -ErrorAction SilentlyContinue
}

Write-Host "[..] Stopping services..." -ForegroundColor Yellow
& "$ScriptDir\stop.ps1"
Write-Host "[OK] Done." -ForegroundColor Green
Start-Sleep -Seconds 2
