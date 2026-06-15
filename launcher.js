/**
 * launcher.js — 虾指挥独立启动器
 *
 * 职责：启动 Gateway + Web UI → 以 Edge/Chrome PWA 模式打开 → 关闭窗口时自动结束进程
 *
 * 设计原则：
 * - 完全独立，不 require 任何业务模块（server.js / fs-store.js 等）
 * - 只读取 config.json / openclaw.json 获取配置
 * - 进程生命周期与 PWA 窗口绑定
 *
 * 用法：node launcher.js
 */

'use strict';

const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ========== 配置检测 ==========

const PROJECT_DIR = __dirname;

/** 检测 openclaw 数据目录 */
function detectStateDir() {
  if (process.env.OPENCLAW_STATE_DIR) return process.env.OPENCLAW_STATE_DIR;
  var candidates = [
    path.join(process.env.APPDATA || '', 'openclaw'),
    path.join(process.env.LOCALAPPDATA || '', 'openclaw'),
    path.join(process.env.USERPROFILE || process.env.HOME || '', '.openclaw'),
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (fs.existsSync(path.join(candidates[i], 'openclaw.json'))) return candidates[i];
  }
  return candidates[0];
}

/** 读取 openclaw.json 中的 Gateway 端口 */
function loadGatewayPort() {
  try {
    var configPath = path.join(STATE_DIR, 'openclaw.json');
    if (fs.existsSync(configPath)) {
      var data = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
      return (data.gateway && data.gateway.port) || 18789;
    }
  } catch (e) {}
  return 18789;
}

/** 读取 Web UI 配置 */
function loadWebUIConfig() {
  try {
    var configPath = path.join(PROJECT_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      var data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { port: data.port || 3001, host: data.host || '127.0.0.1' };
    }
  } catch (e) {}
  return { port: 3001, host: '127.0.0.1' };
}

/** 检测 openclaw 模块路径 */
function detectOpenclawPath() {
  var nodeDir = path.dirname(process.execPath);
  var candidates = [
    path.join(nodeDir, 'npm-global', 'node_modules', 'openclaw', 'openclaw.mjs'),
    path.join(nodeDir, 'node_modules', 'openclaw', 'openclaw.mjs'),
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) return candidates[i];
  }
  try { return require.resolve('openclaw/openclaw.mjs'); } catch (e) {}
  return null;
}

/** 检测浏览器路径（Edge 优先，Chrome 备选） */
function detectBrowser() {
  var browsers = [
    { name: 'Edge', paths: [
      path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]},
    { name: 'Chrome', paths: [
      path.join(process.env['ProgramFiles'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]},
  ];
  for (var i = 0; i < browsers.length; i++) {
    for (var j = 0; j < browsers[i].paths.length; j++) {
      if (fs.existsSync(browsers[i].paths[j])) {
        return { name: browsers[i].name, path: browsers[i].paths[j] };
      }
    }
  }
  return null;
}

var STATE_DIR = detectStateDir();
var GATEWAY_PORT = loadGatewayPort();
var webuiConfig = loadWebUIConfig();
var GATEWAY_URL = 'http://127.0.0.1:' + GATEWAY_PORT;
var WEBUI_URL = 'http://' + (webuiConfig.host === '127.0.0.1' ? 'localhost' : webuiConfig.host) + ':' + webuiConfig.port;
var BROWSER_PWA_DIR = path.join(STATE_DIR, 'browser-pwa');

// ========== 进程管理 ==========

var owned = [];     // { name, proc, startedByUs }
var shuttingDown = false;
var monitorTimer = null;

function _spawn(name, cmd, args, extraEnv) {
  var env = Object.assign({}, process.env, { OPENCLAW_STATE_DIR: STATE_DIR }, extraEnv || {});
  var proc = spawn(cmd, args, { env: env, stdio: ['ignore', 'pipe', 'pipe'] });
  var entry = { name: name, proc: proc, startedByUs: true };
  owned.push(entry);

  var tag = '[' + name + ']';
  proc.stdout.on('data', function (d) { process.stdout.write(tag + ' ' + d); });
  proc.stderr.on('data', function (d) { process.stderr.write(tag + ' ' + d); });

  proc.on('exit', function (code) {
    if (!shuttingDown) {
      console.error(tag + ' 意外退出 (code=' + code + ')');
      cleanup(1);
    }
  });

  return proc;
}

function cleanup(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (monitorTimer) { clearInterval(monitorTimer); monitorTimer = null; }
  releaseLock();

  console.log('\n[Launcher] 正在关闭所有进程...');

  // 只关闭我们启动的进程
  for (var i = owned.length - 1; i >= 0; i--) {
    if (!owned[i].startedByUs) continue;
    try { if (!owned[i].proc.killed) owned[i].proc.kill(); } catch (e) {}
  }

  setTimeout(function () {
    for (var i = 0; i < owned.length; i++) {
      if (!owned[i].startedByUs) continue;
      try { if (!owned[i].proc.killed) owned[i].proc.kill('SIGKILL'); } catch (e) {}
    }
    console.log('[Launcher] 已关闭');
    process.exit(exitCode || 0);
  }, 3000);
}

// ========== 单实例锁 ==========

var LOCK_FILE = path.join(STATE_DIR, 'launcher.lock');

function acquireLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      var pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
      try {
        process.kill(pid, 0);
        // 旧实例还活着，尝试把 PWA 窗口弹到前台
        console.log('[Launcher] 已有实例运行 (PID=' + pid + ')，激活窗口...');
        _bringPwaToFront();
        process.exit(0);
      } catch (e) {
        // 进程不存在，过期锁文件
        try { fs.unlinkSync(LOCK_FILE); } catch (e2) {}
      }
    }
    if (!fs.existsSync(path.dirname(LOCK_FILE))) {
      fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid));
  } catch (e) {}
}

/** 将已有 PWA 窗口弹到前台 */
function _bringPwaToFront() {
  // 最简单可靠的方式：用 start 打开 URL，浏览器会自动激活已有的 PWA 窗口
  // 无需 wmic/PowerShell，零依赖，兼容所有 Windows 版本
  try {
    execSync('start "" "' + WEBUI_URL + '"', { timeout: 5000, windowsHide: true });
  } catch (e) {}
}

function releaseLock() {
  try { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE); } catch (e) {}
}

// ========== 健康检查 ==========

function waitForUrl(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var start = Date.now();
    function tryCheck() {
      if (Date.now() - start > timeoutMs) {
        reject(new Error('超时 (' + timeoutMs + 'ms)'));
        return;
      }
      var req = http.get(url, function (res) {
        resolve(res);
        req.destroy();
      });
      req.on('error', function () { setTimeout(tryCheck, 1000); });
      req.setTimeout(2000, function () { req.destroy(); setTimeout(tryCheck, 1000); });
    }
    tryCheck();
  });
}

// ========== PWA 窗口管理 ==========

var pwaPid = 0; // PWA 主进程 PID，用于快速存活检查

function openPwa(browser) {
  var args = [
    '--app=' + WEBUI_URL,
    '--user-data-dir=' + BROWSER_PWA_DIR,
    '--no-first-run',
    '--disable-extensions',
    '--disable-default-apps',
    '--start-maximized',
  ];
  // Chrome 需要额外参数来确保关闭窗口时退出进程
  if (browser.name === 'Chrome') {
    args.push('--disable-background-networking');
  }
  var proc = spawn(browser.path, args, { detached: false, stdio: 'ignore' });
  pwaPid = proc.pid;
}

/**
 * 检查 PWA 进程是否存活
 * 两级检测策略：PID 快速检查 → wmic 补充确认
 */
function isPwaAlive() {
  // 第一级：PID 快速检查（~0ms，零开销）
  if (pwaPid > 0) {
    try {
      process.kill(pwaPid, 0); // 不发信号，仅检查进程是否存在
      return true;
    } catch (e) {
      // PID 对应的进程已退出，PWA 可能已关闭
      // 但 Edge 可能 fork 了新主进程，需要进一步确认
    }
  }

  // 第二级：wmic 检查是否有浏览器进程引用了我们的 profile 目录
  // 比 PowerShell WMI 快 5 倍（~90ms vs ~400ms），无需启动 PowerShell
  // 同时过滤进程名 + CommandLine，避免 wmic 自身进程误匹配
  var pwaDirName = path.basename(BROWSER_PWA_DIR);
  try {
    // 分两次查询（wmic 不支持 OR+AND 混合的简洁语法）
    var found = false;
    var browserNames = ['msedge.exe', 'chrome.exe'];
    for (var b = 0; b < browserNames.length && !found; b++) {
      var result = execSync(
        'wmic process where "Name=\'' + browserNames[b] + '\' and CommandLine like \'%' + pwaDirName + '%\'" get ProcessId /format:list',
        { encoding: 'utf8', timeout: 5000, windowsHide: true }
      );
      var match = result.match(/ProcessId=(\d+)/);
      if (match) {
        pwaPid = parseInt(match[1], 10);
        found = true;
      }
    }
    if (found) return true;
  } catch (e) {
    // wmic 查询失败，不做误判，保守认为存活
    return true;
  }

  return false;
}

/**
 * 监控 PWA 窗口
 * 使用 PID 快速检查为主，wmic 为补充，避免每 3 秒启动 PowerShell 进程
 */
function startPwaMonitor() {
  var missCount = 0;
  var MISS_THRESHOLD = 3; // 连续 3 次 miss（9 秒）才判定关闭，避免瞬时异常误判

  monitorTimer = setInterval(function () {
    if (shuttingDown) { clearInterval(monitorTimer); return; }

    try {
      if (isPwaAlive()) {
        missCount = 0;
      } else {
        missCount++;
        if (missCount >= MISS_THRESHOLD) {
          console.log('[Launcher] PWA 窗口已关闭');
          clearInterval(monitorTimer);
          cleanup(0);
        }
      }
    } catch (e) {
      missCount++;
      if (missCount >= MISS_THRESHOLD) {
        console.log('[Launcher] PWA 窗口已关闭');
        clearInterval(monitorTimer);
        cleanup(0);
      }
    }
  }, 3000);
}

// ========== 主流程 ==========

async function run() {
  console.log('');
  console.log('  ╔═══════════════════════════╗');
  console.log('  ║     虾指挥 启动中...      ║');
  console.log('  ╚═══════════════════════════╝');
  console.log('');

  acquireLock();

  var nodePath = process.execPath;
  var openclawPath = detectOpenclawPath();

  // 1. Gateway
  var gatewayStartedByUs = false;
  try {
    await waitForUrl(GATEWAY_URL + '/v1/models', 2000);
    console.log('[Launcher] Gateway 已在运行');
  } catch (e) {
    if (!openclawPath) {
      console.error('[Launcher] 未找到 openclaw 模块，请运行: npm install -g openclaw');
      cleanup(1); return;
    }
    console.log('[Launcher] 启动 Gateway...');
    _spawn('Gateway', nodePath, [openclawPath, 'gateway', '--port', String(GATEWAY_PORT), '--verbose']);
    gatewayStartedByUs = true;
    try {
      await waitForUrl(GATEWAY_URL + '/v1/models', 60000);
      console.log('[Launcher] Gateway 已就绪');
    } catch (e2) {
      console.error('[Launcher] Gateway 启动失败');
      cleanup(1); return;
    }
  }
  if (!gatewayStartedByUs) {
    owned.push({ name: 'Gateway', proc: { kill: function () {} }, startedByUs: false });
  }

  // 2. Web UI
  var webuiStartedByUs = false;
  try {
    await waitForUrl('http://127.0.0.1:' + webuiConfig.port + '/api/health', 2000);
    console.log('[Launcher] Web UI 已在运行');
  } catch (e) {
    console.log('[Launcher] 启动 Web UI...');
    _spawn('WebUI', nodePath, [path.join(PROJECT_DIR, 'server.js')]);
    webuiStartedByUs = true;
    try {
      await waitForUrl('http://127.0.0.1:' + webuiConfig.port + '/api/health', 15000);
      console.log('[Launcher] Web UI 已就绪');
    } catch (e2) {
      console.error('[Launcher] Web UI 启动失败');
      cleanup(1); return;
    }
  }
  if (!webuiStartedByUs) {
    owned.push({ name: 'WebUI', proc: { kill: function () {} }, startedByUs: false });
  }

  // 3. 打开 PWA
  var browser = detectBrowser();
  if (browser) {
    console.log('[Launcher] 以 PWA 模式打开 ' + browser.name + '...');
    openPwa(browser);
    startPwaMonitor();
    console.log('[Launcher] 关闭窗口将自动停止所有服务');
  } else {
    console.log('[Launcher] 未找到 Edge/Chrome，使用默认浏览器');
    spawn('cmd', ['/c', 'start', '', WEBUI_URL], { stdio: 'ignore', detached: false });
    console.log('[Launcher] 按 Ctrl+C 关闭服务');
  }

  // 4. 信号处理
  process.on('SIGINT', function () { cleanup(0); });
  process.on('SIGTERM', function () { cleanup(0); });
  process.on('exit', function () {
    // 安全网：确保子进程被终止
    for (var i = 0; i < owned.length; i++) {
      if (owned[i].startedByUs) {
        try { owned[i].proc.kill(); } catch (e) {}
      }
    }
  });
}

run().catch(function (e) {
  console.error('[Launcher] 启动失败:', e.message);
  cleanup(1);
});
