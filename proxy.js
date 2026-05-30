const http = require('http');

function createProxy(gwHost, gwPort, gwToken, store) {
  function proxyRequest(req, res, raw) {
    const parsed = new URL(req.url, 'http://localhost');
    _forwardRequest(req, res, raw, parsed);
  }

  function _forwardRequest(req, res, raw, parsed) {
    const headers = {
      Authorization: 'Bearer ' + gwToken,
      'Content-Type': req.headers['content-type'] || 'application/json',
    };
    if (req.headers['x-openclaw-agent-id']) {
      headers['x-openclaw-agent-id'] = req.headers['x-openclaw-agent-id'];
    }
    if (req.headers['x-openclaw-session-key']) {
      headers['x-openclaw-session-key'] = req.headers['x-openclaw-session-key'];
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
      if (!res.headersSent) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ gateway: 'offline' }));
      }
    });
    gwReq.on('timeout', function () {
      gwReq.destroy();
      if (!res.headersSent) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ gateway: 'offline' }));
      }
    });
    gwReq.end();
  }

  return { proxyRequest: proxyRequest, checkHealth: checkHealth };
}

module.exports = { createProxy: createProxy };
