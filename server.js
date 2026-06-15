// ── 依赖检查 ────────────────────────────────
try {
  require.resolve('ws');
} catch (e) {
  console.error('');
  console.error('[FAIL] 缺少依赖模块，请双击项目中的 shrift.bat 自动安装并启动');
  console.error('[FAIL] 或手动运行: npm install && node server.js');
  console.error('');
  process.exit(1);
}

const http = require('http');
const fs = require('fs');
const path = require('path');

// ── 配置加载 ──────────────────────────────────────────

const configPath = path.join(__dirname, 'config.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.warn('[Config] config.json not found, using defaults. Copy config.example.json to config.json for customization.');
  config = {};
}

const PORT = process.env.PORT || config.port || 3001;
const HOST = process.env.HOST || config.host || '127.0.0.1';
const GATEWAY_URL = config.gatewayUrl || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = config.gatewayToken || 'hermes-local-dev';

// ── OpenClaw 配置定位 ────────────────────────────────

function _resolveOpenclawConfig(cfg) {
  const envPath = process.env.OPENCLAW_CONFIG_PATH;
  const envPathValid = envPath && envPath.length > 0 && fs.existsSync(envPath);
  const cfgPath = (cfg && cfg.openclawConfigPath) || '';
  const cfgPathValid = cfgPath && cfgPath.length > 0 && fs.existsSync(cfgPath);
  return (envPathValid ? envPath : null) || (cfgPathValid ? cfgPath : null) || _detectOpenclawConfig();
}

function _detectOpenclawConfig() {
  const candidates = [];
  if (process.env.OPENCLAW_STATE_DIR) candidates.push(path.join(process.env.OPENCLAW_STATE_DIR, 'openclaw.json'));
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'openclaw', 'openclaw.json'));
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'openclaw', 'openclaw.json'));
  if (process.env.USERPROFILE) candidates.push(path.join(process.env.USERPROFILE, '.openclaw', 'openclaw.json'));
  if (process.env.HOME) candidates.push(path.join(process.env.HOME, '.openclaw', 'openclaw.json'));
  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) return candidates[i];
  }
  return '';
}

let OPENCLAW_CONFIG = _resolveOpenclawConfig(config);
const WEB_DIR = path.join(__dirname, 'web');

let SETUP_MODE = !OPENCLAW_CONFIG;
if (SETUP_MODE) {
  console.log('[Config] openclaw.json not found. Starting in setup mode.');
  console.log('[Config] Visit http://localhost:' + PORT + ' to configure.');
}

function _refreshSetupMode() {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    config = {};
  }
  OPENCLAW_CONFIG = _resolveOpenclawConfig(config);
  SETUP_MODE = !OPENCLAW_CONFIG;
  store.init(OPENCLAW_CONFIG, __dirname);
  if (OPENCLAW_CONFIG) {
    console.log('[Config] openclaw.json found, setup mode disabled.');
  }
}

// ── 模块初始化 ────────────────────────────────────────

const gatewayParsed = new URL(GATEWAY_URL);
const GW_HOST = gatewayParsed.hostname || '127.0.0.1';
const GW_PORT = parseInt(gatewayParsed.port) || 18789;

const store = require('./fs-store');
store.init(OPENCLAW_CONFIG, __dirname);

const sseManager = require('./sse-manager');

const agentRoutes = require('./agent-routes');
const proxy = require('./proxy').createProxy(GW_HOST, GW_PORT, GATEWAY_TOKEN, store);
const sessionSync = require('./session-sync');
const rosterSync = require('./roster-sync');
const debugTrace = require('./debug-trace');

// ── WebSocket 客户端（Gateway 事件桥）──────────────────

let wsClient = null;

sseManager.init(function () {
  return wsClient && wsClient.isConnected() ? 'connected' : 'disconnected';
});

try {
  const wsModule = require('./ws-client');
  wsClient = wsModule.createWsClient(GATEWAY_URL, GATEWAY_TOKEN);

  wsClient.emitter.on('connected', function () {
    console.log('[SSE] Gateway WS connected');
    sseManager.broadcast({ type: 'status', ws: 'connected' });
  });

  wsClient.emitter.on('disconnected', function () {
    sseManager.broadcast({ type: 'status', ws: 'disconnected' });
  });

  function _broadcastSubagentProgress(agentId, toolName, sessionId) {
    if (!agentId || agentId === 'main') return;
    debugTrace.trace('subagent-progress-broadcast', { agentId: agentId, toolName: toolName, sessionId: sessionId || '' });
    const _progress = {};
    _progress[agentId] = { toolName: toolName, sessionId: sessionId || '' };
    sseManager.broadcast({
      type: 'subagent-progress',
      progress: _progress
    });
  }

  function _broadcastSubagentDone(agentId, sessionId) {
    if (!agentId || agentId === 'main') return;
    debugTrace.trace('subagent-done-broadcast', { agentId: agentId, sessionId: sessionId || '' });
    sseManager.broadcast({
      type: 'subagent-done',
      agentId: agentId,
      sessionId: sessionId || ''
    });
  }

  function _extractFrontendSessionId(sessionKey) {
    if (!sessionKey || sessionKey.indexOf(':webui:') < 0) return '';
    const idx = sessionKey.indexOf(':webui:');
    return sessionKey.substring(idx + 7);
  }

  wsClient.emitter.on('event', function (data) {
    sseManager.broadcast({ type: 'gateway', data: data });
    sessionSync.onSubagentGatewayEvent(data);
    const eventName = data.event || '';
    const p = data.payload || {};
    const sessionKey = p.sessionKey || '';
    debugTrace.trace('gateway-event', { event: eventName, sessionKey: sessionKey, payloadKeys: Object.keys(p).join(',') });
    if ((eventName === 'session.tool' || eventName === 'agent') && p) {
      const toolData = p.data || {};
      const isToolStart = toolData.phase === 'start' && toolData.name;
      let subAgentId = '';
      if (sessionKey.indexOf(':subagent:') >= 0) {
        subAgentId = sessionKey.split(':')[1] || '';
      }
      if (!subAgentId && p.spawnedBy) {
        const parts = p.spawnedBy.split(':');
        if (parts.length >= 2 && parts[1] !== 'main') subAgentId = parts[1];
      }
      if (isToolStart && subAgentId) {
        _broadcastSubagentProgress(subAgentId, toolData.name);
      }
      if (isToolStart && toolData.name === 'sessions_spawn') {
        let spawnAgentId = (toolData.args && toolData.args.agentId) || '';
        if (!spawnAgentId && toolData.meta) {
          var m = toolData.meta.match(/agent\s+(\S+)/);
          if (m) spawnAgentId = m[1];
        }
        if (spawnAgentId && spawnAgentId !== 'main') {
          _broadcastSubagentProgress(spawnAgentId, 'sessions_spawn');
        }
      }
    }
    if (eventName === 'sessions.changed') {
      if (sessionKey.indexOf(':subagent:') >= 0) {
        const agentId = sessionKey.split(':')[1] || '';
        const parentKey = p.spawnedBy || (p.session && p.session.spawnedBy) || '';
        const sessionId = _extractFrontendSessionId(parentKey);
        if (p.phase === 'start' || p.reason === 'create') {
          _broadcastSubagentProgress(agentId, '', sessionId);
        } else if (p.phase === 'end' || p.phase === 'error' || p.reason === 'delete') {
          _broadcastSubagentDone(agentId, sessionId);
        }
      }
    }
  });

  console.log('[WS] Gateway WebSocket client initialized');
} catch (e) {
  console.warn('[WS] WebSocket client not available:', e.message);
}

sessionSync.init(function (payload) { sseManager.broadcast(payload); });

// ── 配置文件监听 ──────────────────────────────────────

let _configWatchTimer = null;
if (OPENCLAW_CONFIG) {
try {
  fs.watch(OPENCLAW_CONFIG, function (eventType) {
    if (eventType !== 'change' && eventType !== 'rename') return;
    if (_configWatchTimer) return;
    _configWatchTimer = setTimeout(function () {
      _configWatchTimer = null;
      try {
        rosterSync.syncAllRosters();
        agentRoutes.invalidateCache();
        sseManager.broadcast({ type: 'agents-updated' });
        console.log('[Watch] openclaw.json changed, rosters synced');
      } catch (e) {
        console.error('[Watch] syncAllRosters error:', e.message);
      }
    }, 1000);
  });
  console.log('[Watch] Monitoring openclaw.json for changes');
} catch (e) {
  console.warn('[Watch] Cannot watch openclaw.json:', e.message);
}
}

// ── HTTP 工具函数 ─────────────────────────────────────

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.md': 'text/markdown; charset=utf-8',
};

const MAX_BODY_SIZE = 10 * 1024 * 1024;

function collectBody(req, callback) {
  const chunks = [];
  let size = 0;
  let oversized = false;
  req.on('data', function (c) {
    size += c.length;
    if (size > MAX_BODY_SIZE) {
      oversized = true;
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', function () {
    if (oversized || size > MAX_BODY_SIZE) {
      callback(null, null, new Error('Request body too large (max ' + (MAX_BODY_SIZE / 1024 / 1024) + 'MB)'));
      return;
    }
    const raw = Buffer.concat(chunks);
    let body = null;
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) {}
    callback(body, raw, null);
  });
}

function serveStatic(req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  let fullPath;
  if (filePath.indexOf('/uploads/') === 0) {
    fullPath = path.join(__dirname, filePath);
    if (fullPath.indexOf(path.join(__dirname, 'uploads')) !== 0) {
      if (!store.getDataDir()) { res.writeHead(403); res.end('Forbidden'); return; }
      fullPath = path.join(store.getDataDir(), 'uploads', path.basename(filePath));
    }
  } else {
    fullPath = path.join(WEB_DIR, filePath);
    if (fullPath.indexOf(WEB_DIR) !== 0) { res.writeHead(403); res.end('Forbidden'); return; }
  }
  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(fullPath, function (err, data) {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Internal error');
      return;
    }
    const NO_CACHE_EXTS = new Set(['.html', '.js', '.css', '.json']);
    const headers = { 'Content-Type': contentType };
    if (NO_CACHE_EXTS.has(ext)) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

/**
 * 本地工作区文件代理 — 将 workspace 下的文件通过 HTTP 提供访问
 * 路由：GET /api/file?path=<url-encoded-absolute-path>
 * 安全：仅允许访问 agent workspace 目录和全局 skills 目录内的文件
 */
function handleWorkspaceFile(req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const filePath = parsed.searchParams.get('path');
  if (!filePath) { res.writeHead(400); res.end('Missing path parameter'); return; }

  const decoded = decodeURIComponent(filePath);
  const resolved = path.resolve(decoded);

  // 构建白名单：所有 agent workspace + 全局 skills 目录
  const allowed = _getWorkspaceAllowedDirs();
  let isAllowed = false;
  for (let i = 0; i < allowed.length; i++) {
    if (resolved.indexOf(allowed[i]) === 0) { isAllowed = true; break; }
  }
  if (!isAllowed) { res.writeHead(403); res.end('Forbidden: path outside workspace'); return; }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(resolved, function (err, data) {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? 'File not found' : 'Internal error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(data);
  });
}

var _wsAllowedDirsCache = null;
var _wsAllowedDirsCacheTime = 0;

function _getWorkspaceAllowedDirs() {
  // 缓存 30 秒，避免每次请求都读配置
  var now = Date.now();
  if (_wsAllowedDirsCache && (now - _wsAllowedDirsCacheTime) < 30000) return _wsAllowedDirsCache;

  var dirs = [];
  var data = store.readConfig();
  if (data && data.agents && data.agents.list) {
    var list = data.agents.list;
    for (var i = 0; i < list.length; i++) {
      var ws = store.resolveHome(list[i].workspace || '');
      if (ws) dirs.push(path.resolve(ws));
    }
  }
  // 全局 skills 目录
  var gsDir = store._resolveGlobalSkillsDir();
  if (gsDir) dirs.push(path.resolve(gsDir));
  // uploads 目录
  var dataDir = store.getDataDir();
  if (dataDir) dirs.push(path.resolve(path.join(dataDir, 'uploads')));

  _wsAllowedDirsCache = dirs;
  _wsAllowedDirsCacheTime = now;
  return dirs;
}

function serveStaticWithOverride(req, res, overridePath) {
  const fullPath = path.join(WEB_DIR, overridePath);
  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(fullPath, function (err, data) {
    if (err) {
      res.writeHead(500);
      res.end('Setup page not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' });
    res.end(data);
  });
}

// ── 路由初始化 ────────────────────────────────────────

const routes = require('./routes');
const routeHandlers = routes.init({
  wsClient: wsClient,
  sseManager: sseManager,
  proxy: proxy,
  collectBody: collectBody,
  getConfig: function () { return config; },
  refreshSetupMode: _refreshSetupMode,
  stateDir: store.getDataDir(),
  handleWorkspaceFile: handleWorkspaceFile,
});
const ROUTES = routeHandlers.routes;

// ── HTTP 服务器 ───────────────────────────────────────

const server = http.createServer(function (req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname;
  const method = req.method;

  if (SETUP_MODE) {
    if (pathname === '/api/setup' && method === 'POST') {
      routeHandlers.handleSetup(req, res);
      return;
    }
    if (pathname === '/api/setup/detect' && method === 'POST') {
      routeHandlers.handleSetupDetect(req, res);
      return;
    }
    if (pathname === '/api/setup/verify' && method === 'POST') {
      routeHandlers.handleSetupVerify(req, res);
      return;
    }
    if (pathname.indexOf('/js/') === 0 || pathname.indexOf('/css/') === 0 || pathname.indexOf('/avatars/') === 0 || pathname.indexOf('/lib/') === 0) {
      serveStatic(req, res);
      return;
    }
    serveStaticWithOverride(req, res, '/setup.html');
    return;
  }

  for (let i = 0; i < ROUTES.length; i++) {
    const route = ROUTES[i];
    if (route.method !== method) continue;
    const match = pathname.match(route.pattern);
    if (match) { route.handler(match, req, res); return; }
  }

  if (pathname.indexOf('/v1/') === 0) {
    collectBody(req, function (body, raw, err) {
      if (err) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      proxy.proxyRequest(req, res, raw);
    });
    return;
  }

  serveStatic(req, res);
});

server.timeout = 180000;
server.listen(PORT, HOST, function () {
  const displayHost = HOST === '127.0.0.1' ? 'localhost' : HOST;
  console.log('[OpenClaw Web UI] Server running at http://' + displayHost + ':' + PORT);
  console.log('[OpenClaw Web UI] Gateway: ' + GATEWAY_URL);
  console.log('[OpenClaw Web UI] SSE events: /api/events');
  console.log('[OpenClaw Web UI] Press Ctrl+C to stop');
});

process.on('SIGINT', function () {
  console.log('\n[OpenClaw Web UI] Shutting down…');
  if (wsClient) wsClient.disconnect();
  sseManager.closeAll();
  server.close();
  process.exit(0);
});
