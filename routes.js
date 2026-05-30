/**
 * routes.js — API 路由定义与处理器
 *
 * 职责：定义所有 /api/* 路由及其处理逻辑
 *
 * 依赖（通过 init 注入）：
 *   wsClient         — Gateway WebSocket 客户端实例
 *   sseManager       — SSE 连接管理器
 *   proxy            — Gateway HTTP 代理实例
 *   collectBody      — 请求体收集工具函数
 *   getConfig        — 获取当前配置的回调 () => config
 *   refreshSetupMode — 刷新 setup 模式的回调 () => void
 */

const fs = require('fs');
const path = require('path');
const store = require('./fs-store');
const agentRoutes = require('./agent-routes');
const sessionSync = require('./session-sync');
const debugTrace = require('./debug-trace');

const UPLOAD_ALLOWED_EXT = {
  '.png': 1, '.jpg': 1, '.jpeg': 1, '.gif': 1, '.svg': 1, '.webp': 1,
  '.pdf': 1, '.txt': 1, '.md': 1, '.json': 1, '.csv': 1,
  '.js': 1, '.ts': 1, '.py': 1, '.html': 1, '.css': 1, '.xml': 1,
  '.zip': 1, '.tar': 1, '.gz': 1,
  '.doc': 1, '.docx': 1, '.xls': 1, '.xlsx': 1, '.ppt': 1, '.pptx': 1,
};

function _safeSessionId(id) {
  if (!id || typeof id !== 'string') return null;
  if (id.indexOf('/') >= 0 || id.indexOf('\\') >= 0 || id.indexOf('..') >= 0) return null;
  return id;
}

function _jsonRes(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
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

module.exports = {
  init(deps) {
    const wsClient = deps.wsClient;
    const sseManager = deps.sseManager;
    const proxy = deps.proxy;
    const collectBody = deps.collectBody;
    const getConfig = deps.getConfig;
    const refreshSetupMode = deps.refreshSetupMode;

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

    function handleSessionSync(id, req, res) {
      var messages = sessionSync.readGatewayAssistantMessages();
      _jsonRes(res, 200, { success: true, messages: messages });
    }

    function handleSetup(req, res) {
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
        const currentConfig = getConfig();
        const newConfig = {
          port: currentConfig.port || 3001,
          gatewayUrl: currentConfig.gatewayUrl || 'http://127.0.0.1:18789',
          gatewayToken: currentConfig.gatewayToken || 'hermes-local-dev',
          openclawConfigPath: body.openclawConfigPath,
        };
        try {
          fs.writeFileSync(configFile, JSON.stringify(newConfig, null, 2), 'utf8');
          refreshSetupMode();
          _jsonRes(res, 200, Object.assign({ success: true, message: '配置完成，即将加载…' }, verifyResult.info));
        } catch (e) {
          _jsonRes(res, 500, { error: '写入 config.json 失败: ' + e.message });
        }
      });
    }

    function handleSetupDetect(req, res) {
      collectBody(req, function (b, _r, err) {
        if (err) { _jsonRes(res, 500, { error: err.message }); return; }
        var candidates = [];
        if (b && b.path) { candidates.push(b.path); }
        if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'openclaw', 'openclaw.json'));
        if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'openclaw', 'openclaw.json'));
        if (process.env.USERPROFILE) candidates.push(path.join(process.env.USERPROFILE, '.openclaw', 'openclaw.json'));
        if (process.env.HOME) candidates.push(path.join(process.env.HOME, '.openclaw', 'openclaw.json'));
        var found = null;
        for (var ci = 0; ci < candidates.length; ci++) {
          try {
            if (fs.existsSync(candidates[ci])) { found = candidates[ci]; break; }
          } catch (ex) {}
        }
        if (found) {
          try {
            var data = JSON.parse(fs.readFileSync(found, 'utf8'));
            var gw = data.gateway || {};
            var providers = data.models && data.models.providers ? Object.keys(data.models.providers) : [];
            _jsonRes(res, 200, { found: true, path: found, port: gw.port || 18789, token: (gw.auth && gw.auth.token) || 'hermes-local-dev', providers: providers });
          } catch (ex) { _jsonRes(res, 200, { found: false }); }
        } else {
          _jsonRes(res, 200, { found: false });
        }
      });
    }

    function handleSetupVerify(req, res) {
      collectBody(req, function (b, _r, err) {
        if (err) { _jsonRes(res, 500, { error: err.message }); return; }
        if (!b || !b.path) { _jsonRes(res, 400, { error: 'Missing path' }); return; }
        var r = _verifyConfigPath(b.path);
        _jsonRes(res, r.valid ? 200 : 400, r.valid ? { valid: true, info: r.info } : { valid: false, error: r.error });
      });
    }

    const ROUTES = [
      { method: 'GET',    pattern: /^\/api\/agents$/,                     handler: function (m, req, res) { agentRoutes.listAgents(res); } },
      { method: 'POST',   pattern: /^\/api\/agents$/,                     handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } agentRoutes.createAgent(b, res); }); } },
      { method: 'GET',    pattern: /^\/api\/skills$/,                     handler: function (m, req, res) { agentRoutes.listSkills(res); } },
      { method: 'GET',    pattern: /^\/api\/models$/,                     handler: function (m, req, res) { agentRoutes.listModels(res); } },
      { method: 'PUT',    pattern: /^\/api\/models\/default$/,            handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } agentRoutes.updateDefaultModel(b, res); }); } },
      { method: 'GET',    pattern: /^\/api\/agents\/([^\/]+)$/,           handler: function (m, req, res) { agentRoutes.getAgentDetail(m[1], res); } },
      { method: 'PUT',    pattern: /^\/api\/agents\/([^\/]+)$/,           handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } agentRoutes.updateAgent(m[1], b, res); }); } },
      { method: 'DELETE', pattern: /^\/api\/agents\/([^\/]+)$/,           handler: function (m, req, res) { agentRoutes.deleteAgent(m[1], res); } },
      { method: 'GET',    pattern: /^\/api\/agents\/([^\/]+)\/agents-md$/,handler: function (m, req, res) { agentRoutes.getAgentsMd(m[1], res); } },
      { method: 'PUT',    pattern: /^\/api\/agents\/([^\/]+)\/agents-md$/,handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } agentRoutes.putAgentsMd(m[1], b, res); }); } },
      { method: 'DELETE', pattern: /^\/api\/agents\/([^\/]+)\/bootstrap$/,handler: function (m, req, res) { agentRoutes.deleteBootstrap(m[1], res); } },
      { method: 'GET',    pattern: /^\/api\/agents\/([^\/]+)\/skills$/,   handler: function (m, req, res) { agentRoutes.getAgentSkills(m[1], res); } },
      { method: 'POST',   pattern: /^\/api\/agents\/([^\/]+)\/skills$/,   handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } agentRoutes.handleSkillAction(m[1], b, res); }); } },
      { method: 'PUT',    pattern: /^\/api\/agents\/([^\/]+)\/skills$/,   handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } agentRoutes.syncSkills(m[1], b, res); }); } },
      { method: 'DELETE', pattern: /^\/api\/skills\/([^\/]+)$/,          handler: function (m, req, res) { agentRoutes.deleteSkill(decodeURIComponent(m[1]), res); } },
      { method: 'POST',   pattern: /^\/api\/upload$/,                     handler: function (m, req, res) { handleUpload(req, res); } },
      { method: 'GET',    pattern: /^\/api\/events$/,                     handler: function (m, req, res) { sseManager.handleSSE(req, res); } },
      { method: 'GET',    pattern: /^\/api\/health$/,                     handler: function (m, req, res) { proxy.checkHealth(res); } },
      { method: 'POST',   pattern: /^\/api\/setup$/,                      handler: function (m, req, res) { handleSetup(req, res); } },
      { method: 'POST',   pattern: /^\/api\/setup\/verify$/,              handler: function (m, req, res) { handleSetupVerify(req, res); } },
      { method: 'POST',   pattern: /^\/api\/setup\/detect$/,              handler: function (m, req, res) { handleSetupDetect(req, res); } },
      { method: 'GET',    pattern: /^\/api\/sessions$/,                   handler: function (m, req, res) { handleSessionList(req, res); } },
      { method: 'GET',    pattern: /^\/api\/sessions\/([^\/]+)$/,          handler: function (m, req, res) { handleSessionGet(decodeURIComponent(m[1]), req, res); } },
      { method: 'POST',   pattern: /^\/api\/sessions$/,                   handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } handleSessionSave(b, res); }); } },
      { method: 'PUT',    pattern: /^\/api\/sessions\/([^\/]+)$/,          handler: function (m, req, res) { collectBody(req, function (b, _r, err) { if (err) { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); return; } handleSessionSave(b, res); }); } },
      { method: 'DELETE', pattern: /^\/api\/sessions\/([^\/]+)$/,          handler: function (m, req, res) { handleSessionDelete(decodeURIComponent(m[1]), res); } },
      { method: 'GET',    pattern: /^\/api\/sessions\/([^\/]+)\/sync$/,    handler: function (m, req, res) { handleSessionSync(decodeURIComponent(m[1]), req, res); } },
      { method: 'POST',   pattern: /^\/api\/log$/,                         handler: function (m, req, res) { debugTrace.handlePostLog(req, res, collectBody); } },
      { method: 'GET',    pattern: /^\/api\/logs$/,                        handler: function (m, req, res) { debugTrace.handleGetLogs(req, res); } },
      { method: 'POST',   pattern: /^\/api\/logs\/clear$/,                 handler: function (m, req, res) { debugTrace.handleClearLogs(req, res); } },
    ];

    return {
      routes: ROUTES,
      handleSetup: handleSetup,
      handleSetupDetect: handleSetupDetect,
      handleSetupVerify: handleSetupVerify,
    };
  }
};
