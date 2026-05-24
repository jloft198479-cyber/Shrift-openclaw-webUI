const http = require('http');
const path = require('path');

function createProxy(gwHost, gwPort, gwToken, store) {
  function proxyRequest(req, res, raw) {
    const parsed = new URL(req.url, 'http://localhost');
    const agentId = req.headers['x-openclaw-agent-id'] || '';

    if (agentId && parsed.pathname === '/v1/chat/completions' && req.method === 'POST') {
      _injectSystemMessage(agentId, raw, function (modifiedRaw) {
        _forwardRequest(req, res, modifiedRaw, parsed);
      });
      return;
    }

    _forwardRequest(req, res, raw, parsed);
  }

  function _injectSystemMessage(agentId, raw, callback) {
    const ws = store.getAgentWorkspace(agentId);
    if (!ws) { callback(raw); return; }

    const agentsMd = store.readFile(path.join(ws, 'AGENTS.md')) || '';
    if (!agentsMd) { callback(raw); return; }

    try {
      const body = JSON.parse(raw.toString('utf8'));
      const messages = body.messages || [];
      const hasSystem = messages.length > 0 && messages[0].role === 'system';
      if (hasSystem) { callback(raw); return; }

      messages.unshift({ role: 'system', content: agentsMd });
      body.messages = messages;
      callback(Buffer.from(JSON.stringify(body), 'utf8'));
    } catch (e) {
      console.error('[Proxy] Failed to inject system message:', e.message);
      callback(raw);
    }
  }

  function _forwardRequest(req, res, raw, parsed) {
    const headers = {
      Authorization: 'Bearer ' + gwToken,
      'Content-Type': req.headers['content-type'] || 'application/json',
    };
    if (req.headers['x-openclaw-agent-id']) {
      headers['x-openclaw-agent-id'] = req.headers['x-openclaw-agent-id'];
    }
    const gwReq = http.request({
      hostname: gwHost,
      port: gwPort,
      path: parsed.pathname + parsed.search,
      method: req.method,
      headers: headers,
      timeout: 180000,
    }, function (gwRes) {
      const isSSE = (gwRes.headers['content-type'] || '').indexOf('text/event-stream') >= 0;
      const resHeaders = { 'Content-Type': gwRes.headers['content-type'] || 'application/json' };
      if (isSSE) {
        resHeaders['Cache-Control'] = 'no-cache';
        resHeaders['Connection'] = 'keep-alive';
        resHeaders['X-Accel-Buffering'] = 'no';
      }
      res.writeHead(gwRes.statusCode, resHeaders);
      gwRes.pipe(res);
    });
    gwReq.on('error', function (err) {
      console.error('[Proxy] Gateway error:', err.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Gateway unreachable', detail: err.message }));
      } else { res.end(); }
    });
    gwReq.on('timeout', function () {
      gwReq.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Gateway timeout' }));
      }
    });
    gwReq.write(raw);
    gwReq.end();
  }

  function checkHealth(res) {
    const gwReq = http.request({
      hostname: gwHost, port: gwPort, path: '/v1/models', method: 'GET',
      headers: { Authorization: 'Bearer ' + gwToken }, timeout: 5000,
    }, function (gwRes) {
      let body = '';
      gwRes.on('data', function (c) { body += c; });
      gwRes.on('end', function () {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ gateway: 'online', status: gwRes.statusCode }));
      });
    });
    gwReq.on('error', function () {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ gateway: 'offline' }));
    });
    gwReq.on('timeout', function () {
      gwReq.destroy();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ gateway: 'offline' }));
    });
    gwReq.end();
  }

  return { proxyRequest: proxyRequest, checkHealth: checkHealth };
}

module.exports = { createProxy: createProxy };
