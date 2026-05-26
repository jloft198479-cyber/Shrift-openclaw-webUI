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

const configPath = path.join(__dirname, 'config.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.warn('[Config] config.json not found, using defaults. Copy config.example.json to config.json for customization.');
  config = {};
}

const PORT = process.env.PORT || config.port || 3001;
const GATEWAY_URL = config.gatewayUrl || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = config.gatewayToken || 'hermes-local-dev';

function _resolveOpenclawConfig(cfg) {
  const envPath = process.env.OPENCLAW_CONFIG_PATH;
  const envPathValid = envPath && envPath.length > 0 && fs.existsSync(envPath);
  const cfgPath = (cfg && cfg.openclawConfigPath) || '';
  const cfgPathValid = cfgPath && cfgPath.length > 0 && fs.existsSync(cfgPath);
  return (envPathValid ? envPath : null) || (cfgPathValid ? cfgPath : null) || _detectOpenclawConfig();
}

let OPENCLAW_CONFIG = _resolveOpenclawConfig(config);
const WEB_DIR = path.join(__dirname, 'web');

// SETUP_MODE: 仅当无法通过任何方式定位到 openclaw.json 时才启用
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

function _safeSessionId(id) {
  if (!id || typeof id !== 'string') return null;
  if (id.indexOf('/') >= 0 || id.indexOf('\\') >= 0 || id.indexOf('..') >= 0) return null;
  return id;
}

const gatewayParsed = new URL(GATEWAY_URL);
const GW_HOST = gatewayParsed.hostname || '127.0.0.1';
const GW_PORT = parseInt(gatewayParsed.port) || 18789;

const store = require('./fs-store');
store.init(OPENCLAW_CONFIG, __dirname);

let _configWatchTimer = null;
try {
  fs.watch(OPENCLAW_CONFIG, function (eventType) {
    if (eventType !== 'change') return;
    if (_configWatchTimer) return;
    _configWatchTimer = setTimeout(function () {
      _configWatchTimer = null;
      try {
        store.syncAllRosters();
        agentRoutes.invalidateCache();
        _broadcastSSE({ type: 'agents-updated' });
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

const agentRoutes = require('./agent-routes');
const proxy = require('./proxy').createProxy(GW_HOST, GW_PORT, GATEWAY_TOKEN, store);

// ── WebSocket 客户端（Gateway 事件桥）──────────────────────
let wsClient = null;
const sseClients = [];

try {
  const wsModule = require('./ws-client');
  wsClient = wsModule.createWsClient(GATEWAY_URL, GATEWAY_TOKEN);

  wsClient.emitter.on('connected', function () {
    console.log('[SSE] Gateway WS connected');
    _broadcastSSE({ type: 'status', ws: 'connected' });
  });

  wsClient.emitter.on('disconnected', function () {
    _broadcastSSE({ type: 'status', ws: 'disconnected' });
  });

  wsClient.emitter.on('event', function (data) {
    _broadcastSSE({ type: 'gateway', data: data });
  });

  console.log('[WS] Gateway WebSocket client initialized');
} catch (e) {
  console.warn('[WS] WebSocket client not available:', e.message);
}

function _broadcastSSE(payload) {
  const eventType = payload.type || 'message';
  const data = 'event: ' + eventType + '\ndata: ' + JSON.stringify(payload) + '\n\n';
  const dead = [];
  for (let i = 0; i < sseClients.length; i++) {
    try {
      sseClients[i].write(data);
    } catch (e) {
      dead.push(i);
    }
  }
  for (let j = dead.length - 1; j >= 0; j--) {
    sseClients.splice(dead[j], 1);
  }
}

// ── MIME & 工具函数 ──────────────────────────────────────

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
  '.md': 'text/markdown; charset=utf-8',
};

const MAX_BODY_SIZE = 10 * 1024 * 1024;

const UPLOAD_ALLOWED_EXT = {
  '.png': 1, '.jpg': 1, '.jpeg': 1, '.gif': 1, '.svg': 1, '.webp': 1,
  '.pdf': 1, '.txt': 1, '.md': 1, '.json': 1, '.csv': 1,
  '.js': 1, '.ts': 1, '.py': 1, '.html': 1, '.css': 1, '.xml': 1,
  '.zip': 1, '.tar': 1, '.gz': 1,
  '.doc': 1, '.docx': 1, '.xls': 1, '.xlsx': 1, '.ppt': 1, '.pptx': 1,
};

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
    if (fullPath.indexOf(path.join(__dirname, 'uploads')) !== 0) { res.writeHead(403); res.end('Forbidden'); return; }
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
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
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
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ── SSE 事件端点 ─────────────────────────────────────────

function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  res.write('data: ' + JSON.stringify({ type: 'status', ws: wsClient && wsClient.isConnected() ? 'connected' : 'disconnected' }) + '\n\n');

  sseClients.push(res);

  req.on('close', function () {
    const idx = sseClients.indexOf(res);
    if (idx >= 0) sseClients.splice(idx, 1);
  });
}

function handleChatSend(req, res) {
  collectBody(req, function (body, raw, err) {
    if (err) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
    if (!body || !body.message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing message' }));
      return;
    }
    if (!wsClient || !wsClient.isConnected()) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'WS not connected to Gateway' }));
      return;
    }
    const sessionKey = body.sessionKey || 'main';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'sent' }));
    wsClient.chatSend(sessionKey, body.message).catch(function (err) {
      console.error('[ChatSend] WS error:', err.message);
    });
  });
}

function handleUpload(req, res) {
  collectBody(req, function (b, _raw, err) {
    if (err) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
    if (!b || !b.data) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing file data' }));
      return;
    }
    try {
      const ext = b.name ? path.extname(b.name).toLowerCase() : '';
      if (!ext || !UPLOAD_ALLOWED_EXT[ext]) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File type not allowed: ' + (ext || 'unknown') }));
        return;
      }
      const commaIdx = b.data.indexOf(',');
      const base64 = b.data.slice(commaIdx + 1);
      const buf = Buffer.from(base64, 'base64');
      const fileName = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
      const uploadDir = path.join(__dirname, 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(path.join(uploadDir, fileName), buf);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: b.name, path: '/uploads/' + fileName, type: b.type || 'application/octet-stream' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// ── Session API handlers ──────────────────────────────────

function _jsonRes(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function handleSessionList(req, res) {
  _jsonRes(res, 200, store.getSessionList());
}

function handleSessionGet(id, req, res) {
  const safeId = _safeSessionId(id);
  if (!safeId) { _jsonRes(res, 400, { error: 'Invalid session id' }); return; }
  const session = store.getSession(safeId);
  if (!session) { _jsonRes(res, 404, { error: 'Session not found' }); return; }
  _jsonRes(res, 200, session);
}

function handleSessionSave(body, res) {
  if (!body || !_safeSessionId(body.id)) { _jsonRes(res, 400, { error: 'Missing or invalid session id' }); return; }
  if (store.saveSession(body)) {
    _jsonRes(res, 200, { status: 'saved' });
  } else {
    _jsonRes(res, 500, { error: 'Failed to save session' });
  }
}

function handleSessionDelete(id, res) {
  const safeId = _safeSessionId(id);
  if (!safeId) { _jsonRes(res, 400, { error: 'Invalid session id' }); return; }
  store.deleteSession(safeId);
  _jsonRes(res, 200, { status: 'deleted' });
}

// ── 路由 ──────────────────────────────────────────────────

function handleSetup(req, res) {
  collectBody(req, function (body, raw, err) {
    if (err) { _jsonRes(res, 413, { error: err.message }); return; }
    if (!body || !body.openclawConfigPath) {
      _jsonRes(res, 400, { error: 'Missing openclawConfigPath' }); return;
    }
    // 保存前校验路径是否有效
    const verifyResult = _verifyConfigPath(body.openclawConfigPath);
    if (!verifyResult.valid) {
      _jsonRes(res, 400, { error: verifyResult.error, code: 'INVALID_PATH' }); return;
    }
    const configFile = path.join(__dirname, 'config.json');
    const newConfig = {
      port: config.port || 3001,
      gatewayUrl: config.gatewayUrl || 'http://127.0.0.1:18789',
      gatewayToken: config.gatewayToken || 'hermes-local-dev',
      openclawConfigPath: body.openclawConfigPath,
    };
    try {
      fs.writeFileSync(configFile, JSON.stringify(newConfig, null, 2), 'utf8');
      _refreshSetupMode();
      _jsonRes(res, 200, Object.assign({ success: true, message: '配置完成，即将加载…' }, verifyResult.info));
    } catch (e) {
      _jsonRes(res, 500, { error: '写入 config.json 失败: ' + e.message });
    }
  });
}

function _verifyConfigPath(filePath) {
  if (!filePath) return { valid: false, error: '路径不能为空' };
  try {
    if (!fs.existsSync(filePath)) return { valid: false, error: '文件不存在: ' + filePath };
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { valid: false, error: '路径不是文件: ' + filePath };
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const gw = data.gateway || {};
    const providers = data.models && data.models.providers ? Object.keys(data.models.providers) : [];
    return {
      valid: true,
      info: {
        port: gw.port || 18789,
        token: (gw.auth && gw.auth.token) || 'hermes-local-dev',
        providers: providers,
      },
    };
  } catch (e) {
    if (e instanceof SyntaxError) return { valid: false, error: '文件格式错误，不是有效的 JSON 文件' };
    return { valid: false, error: '读取文件失败: ' + e.message };
  }
}

const ROUTES = [
  { method: 'GET',    pattern: /^\/api\/agents$/,                     handler: function (m, req, res) { agentRoutes.listAgents(res); } },
  { method: 'POST',   pattern: /^\/api\/agents$/,                     handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } agentRoutes.createAgent(b, res); }); } },
  { method: 'GET',    pattern: /^\/api\/skills$/,                     handler: function (m, req, res) { agentRoutes.listSkills(res); } },
  { method: 'GET',    pattern: /^\/api\/models$/,                    handler: function (m, req, res) { agentRoutes.listModels(res); } },
  { method: 'PUT',    pattern: /^\/api\/models\/default$/,           handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } agentRoutes.updateDefaultModel(b, res); }); } },
  { method: 'GET',    pattern: /^\/api\/agents\/([^\/]+)$/,           handler: function (m, req, res) { agentRoutes.getAgentDetail(m[1], res); } },
  { method: 'PUT',    pattern: /^\/api\/agents\/([^\/]+)$/,           handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } agentRoutes.updateAgent(m[1], b, res); }); } },
  { method: 'DELETE', pattern: /^\/api\/agents\/([^\/]+)$/,           handler: function (m, req, res) { agentRoutes.deleteAgent(m[1], res); } },
  { method: 'GET',    pattern: /^\/api\/agents\/([^\/]+)\/agents-md$/,handler: function (m, req, res) { agentRoutes.getAgentsMd(m[1], res); } },
  { method: 'PUT',    pattern: /^\/api\/agents\/([^\/]+)\/agents-md$/,handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } agentRoutes.putAgentsMd(m[1], b, res); }); } },
  { method: 'DELETE', pattern: /^\/api\/agents\/([^\/]+)\/bootstrap$/,handler: function (m, req, res) { agentRoutes.deleteBootstrap(m[1], res); } },
  { method: 'GET',    pattern: /^\/api\/agents\/([^\/]+)\/skills$/,   handler: function (m, req, res) { agentRoutes.getAgentSkills(m[1], res); } },
  { method: 'POST',   pattern: /^\/api\/agents\/([^\/]+)\/skills$/,   handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } agentRoutes.handleSkillAction(m[1], b, res); }); } },
  { method: 'PUT',    pattern: /^\/api\/agents\/([^\/]+)\/skills$/,   handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } agentRoutes.syncSkills(m[1], b, res); }); } },
  { method: 'POST',   pattern: /^\/api\/upload$/,                     handler: function (m, req, res) { handleUpload(req, res); } },
  { method: 'GET',    pattern: /^\/api\/events$/,                     handler: function (m, req, res) { handleSSE(req, res); } },
  { method: 'GET',    pattern: /^\/api\/health$/,                     handler: function (m, req, res) { proxy.checkHealth(res); } },
  { method: 'POST',   pattern: /^\/api\/setup$/,                      handler: function (m, req, res) { handleSetup(req, res); } },
  { method: 'POST',   pattern: /^\/api\/setup\/verify$/,               handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { _jsonRes(res, 500, {error:err.message}); return; } if (!b || !b.path) { _jsonRes(res, 400, {error:'Missing path'}); return; } var r = _verifyConfigPath(b.path); _jsonRes(res, r.valid ? 200 : 400, r.valid ? {valid: true, info: r.info} : {valid: false, error: r.error}); }); } },
  { method: 'POST',   pattern: /^\/api\/setup\/detect$/,               handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { _jsonRes(res, 500, {error:err.message}); return; } var candidates = []; if (b && b.path) { candidates.push(b.path); } if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'openclaw', 'openclaw.json')); if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'openclaw', 'openclaw.json')); if (process.env.USERPROFILE) candidates.push(path.join(process.env.USERPROFILE, '.openclaw', 'openclaw.json')); if (process.env.HOME) candidates.push(path.join(process.env.HOME, '.openclaw', 'openclaw.json')); var found = null; for (var ci = 0; ci < candidates.length; ci++) { try { if (fs.existsSync(candidates[ci])) { found = candidates[ci]; break; } } catch(ex) {} } if (found) { try { var data = JSON.parse(fs.readFileSync(found, 'utf8')); var gw = data.gateway || {}; var providers = data.models && data.models.providers ? Object.keys(data.models.providers) : []; _jsonRes(res, 200, {found: true, path: found, port: gw.port || 18789, token: (gw.auth && gw.auth.token) || 'hermes-local-dev', providers: providers}); } catch(ex) { _jsonRes(res, 200, {found: false}); } } else { _jsonRes(res, 200, {found: false}); } }); } },
  { method: 'POST',   pattern: /^\/api\/chat\/send$/,                handler: function (m, req, res) { handleChatSend(req, res); } },
  { method: 'GET',    pattern: /^\/api\/sessions$/,                   handler: function (m, req, res) { handleSessionList(req, res); } },
  { method: 'GET',    pattern: /^\/api\/sessions\/([^\/]+)$/,          handler: function (m, req, res) { handleSessionGet(decodeURIComponent(m[1]), req, res); } },
  { method: 'POST',   pattern: /^\/api\/sessions$/,                   handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } handleSessionSave(b, res); }); } },
  { method: 'PUT',    pattern: /^\/api\/sessions\/([^\/]+)$/,          handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } handleSessionSave(b, res); }); } },
  { method: 'DELETE', pattern: /^\/api\/sessions\/([^\/]+)$/,          handler: function (m, req, res) { handleSessionDelete(decodeURIComponent(m[1]), res); } },
];

const server = http.createServer(function (req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname;
  const method = req.method;

  if (SETUP_MODE) {
    if (pathname === '/api/setup' && method === 'POST') {
      collectBody(req, function (body, raw, err) {
        if (err) { _jsonRes(res, 413, { error: err.message }); return; }
        if (!body || !body.openclawConfigPath) {
          _jsonRes(res, 400, { error: 'Missing openclawConfigPath' }); return;
        }
        const verifyResult = _verifyConfigPath(body.openclawConfigPath);
        if (!verifyResult.valid) {
          _jsonRes(res, 400, { error: verifyResult.error, code: 'INVALID_PATH' }); return;
        }
        const configFile = path.join(__dirname, 'config.json');
        const newConfig = {
          port: config.port || 3001,
          gatewayUrl: config.gatewayUrl || 'http://127.0.0.1:18789',
          gatewayToken: config.gatewayToken || 'hermes-local-dev',
          openclawConfigPath: body.openclawConfigPath,
        };
        try {
          fs.writeFileSync(configFile, JSON.stringify(newConfig, null, 2), 'utf8');
          _refreshSetupMode();
          _jsonRes(res, 200, Object.assign({ success: true, message: '配置完成，即将加载…' }, verifyResult.info));
        } catch (e) {
          _jsonRes(res, 500, { error: '写入 config.json 失败: ' + e.message });
        }
      });
      return;
    }
    if (pathname === '/api/setup/detect' && method === 'POST') {
      const matchedRoute = ROUTES.find(function (r) { return r.method === 'POST' && r.pattern.test('/api/setup/detect'); });
      if (matchedRoute) { matchedRoute.handler(['', '', ''], req, res); return; }
      _jsonRes(res, 404, { error: 'Not found' });
      return;
    }
    if (pathname === '/api/setup/verify' && method === 'POST') {
      collectBody(req, function (body, raw, err) {
        if (err) { _jsonRes(res, 500, {error: err.message}); return; }
        if (!body || !body.path) { _jsonRes(res, 400, {error:'Missing path'}); return; }
        var r = _verifyConfigPath(body.path);
        _jsonRes(res, r.valid ? 200 : 400, r.valid ? {valid: true, info: r.info} : {valid: false, error: r.error});
      });
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
server.listen(PORT, function () {
  console.log('[OpenClaw Web UI] Server running at http://localhost:' + PORT);
  console.log('[OpenClaw Web UI] Gateway: ' + GATEWAY_URL);
  console.log('[OpenClaw Web UI] SSE events: /api/events');
  console.log('[OpenClaw Web UI] Press Ctrl+C to stop');
});

process.on('SIGINT', function () {
  console.log('\n[OpenClaw Web UI] Shutting down…');
  if (wsClient) wsClient.disconnect();
  for (let i = 0; i < sseClients.length; i++) {
    try { sseClients[i].end(); } catch (e) {}
  }
  server.close();
  process.exit(0);
});
