const WebSocket = require('ws');
const EventEmitter = require('events');
const crypto = require('crypto');

const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;
const PING_INTERVAL = 25000;

function createWsClient(gwUrl, gwToken) {
  const emitter = new EventEmitter();
  let ws = null;
  let connected = false;
  let handshakeDone = false;
  let reconnectTimer = null;
  let pingTimer = null;
  let reconnectDelay = RECONNECT_DELAY;
  let msgId = 0;
  const pendingRequests = {};
  let sessionPollTimer = null;
  let lastKnownSessions = null;

  const parsed = new URL(gwUrl);
  const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = wsProtocol + '//' + parsed.hostname + ':' + (parsed.port || 18789) + '/ws';

  function sendRequest(method, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!ws || ws.readyState !== WebSocket.OPEN || !handshakeDone) {
        reject(new Error('WS not connected'));
        return;
      }
      const id = String(++msgId);
      // P2-3: 存 timer id，resolve/reject 时 clearTimeout，避免 timer 泄漏
      const timer = setTimeout(function () {
        if (pendingRequests[id]) {
          delete pendingRequests[id];
          reject(new Error('Request timeout: ' + method));
        }
      }, timeoutMs || 30000);
      pendingRequests[id] = { resolve: resolve, reject: reject, timer: timer };
      ws.send(JSON.stringify({ type: 'req', id: id, method: method, params: params }));
    });
  }

  function chatSend(sessionKey, message) {
    return sendRequest('chat.send', {
      sessionKey: sessionKey,
      message: message,
      idempotencyKey: crypto.randomUUID()
    }, 60000);
  }

  function chatHistory(sessionKey, limit) {
    return sendRequest('chat.history', {
      sessionKey: sessionKey,
      limit: limit || 50
    }, 10000);
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      ws = new WebSocket(wsUrl, {
        headers: { 'Origin': wsProtocol + '//' + parsed.hostname + ':' + (parsed.port || '18789') }
      });
    } catch (e) {
      console.error('[WS] Create error:', e.message);
      scheduleReconnect();
      return;
    }

    ws.on('open', function () {
      console.log('[WS] Connected to Gateway');
      connected = true;
      reconnectDelay = RECONNECT_DELAY;

      const connectMsg = {
        type: 'req',
        id: String(++msgId),
        method: 'connect',
        params: {
          auth: { token: gwToken },
          role: 'operator',
          minProtocol: 4,
          maxProtocol: 4,
          client: {
            id: 'openclaw-control-ui',
            version: '1.0.0',
            platform: 'web',
            mode: 'ui'
          },
          scopes: ['operator.read', 'operator.write', 'operator.admin'],
          caps: [],
          commands: [],
          permissions: {},
          locale: 'zh-CN',
          userAgent: 'openclaw-web-ui/1.0.0'
        }
      };
      ws.send(JSON.stringify(connectMsg));
      startPing();
      emitter.emit('connected');
    });

    ws.on('message', function (raw) {
      let data;
      try { data = JSON.parse(raw.toString()); } catch (e) { return; }

      if (data.type === 'res' && data.id === '1') {
        if (data.error) {
          console.error('[WS] Connect rejected:', data.error);
          handshakeDone = false;
        } else {
          console.log('[WS] Handshake ok, scopes:', data.payload && data.payload.auth && data.payload.auth.scopes);
          handshakeDone = true;
          sendRequest('sessions.subscribe', {}, 10000).then(function () {
            console.log('[WS] Subscribed to session events');
          }).catch(function (err) {
            console.warn('[WS] sessions.subscribe failed:', err.message + '. Falling back to polling.');
            _startSessionPolling();
          });
        }
        return;
      }

      if (data.type === 'res' && pendingRequests[data.id]) {
        const pr = pendingRequests[data.id];
        delete pendingRequests[data.id];
        if (data.ok) {
          pr.resolve(data.payload);
        } else {
          pr.reject(new Error(data.error ? data.error.message : 'Unknown error'));
        }
        return;
      }

      if (data.type === 'event') {
        const eventName = data.event || '';
        console.log('[WS] Event:', eventName, JSON.stringify(data).slice(0, 1000));
        emitter.emit('event', data);
        return;
      }

      if (data.type === 'res') {
        emitter.emit('response', data);
        return;
      }
    });

    ws.on('close', function (code, reason) {
      console.log('[WS] Disconnected:', code, reason || '');
      connected = false;
      handshakeDone = false;
      stopPing();
      _stopSessionPolling();
      // P2-3: 断连时清空所有 pending 请求，避免等满 timeout
      for (const id in pendingRequests) {
        const pr = pendingRequests[id];
        if (pr.timer) clearTimeout(pr.timer);
        pr.reject(new Error('WS disconnected'));
        delete pendingRequests[id];
      }
      emitter.emit('disconnected', { code: code });
      scheduleReconnect();
    });

    ws.on('error', function (err) {
      console.error('[WS] Error:', err.message);
      connected = false;
      if (emitter.listenerCount('error') > 0) {
        emitter.emit('error', err);
      }
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(function () {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, PING_INTERVAL);
  }

  function stopPing() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function _startSessionPolling() {
    _stopSessionPolling();
    const http = require('http');
    const gwHost = parsed.hostname || '127.0.0.1';
    const gwPort = parseInt(parsed.port) || 18789;
    sessionPollTimer = setInterval(function () {
      if (!connected || !handshakeDone) return;
      const req = http.request({
        hostname: gwHost, port: gwPort, path: '/v1/sessions', method: 'GET',
        headers: { Authorization: 'Bearer ' + gwToken }, timeout: 5000,
      }, function (res) {
        let data = '';
        res.on('data', function (c) { data += c; });
        res.on('end', function () {
          try {
            const sessions = JSON.parse(data);
            if (!Array.isArray(sessions)) return;
            const current = {};
            sessions.forEach(function (s) { current[s.id || s.key] = s; });
            if (lastKnownSessions) {
              for (const key in current) {
                if (!lastKnownSessions[key]) {
                  emitter.emit('event', { type: 'event', event: 'session.created', session: current[key] });
                } else if (lastKnownSessions[key].status !== current[key].status) {
                  emitter.emit('event', { type: 'event', event: 'session.updated', session: current[key] });
                }
              }
            }
            lastKnownSessions = current;
          } catch (e) {}
        });
      });
      req.on('error', function () {});
      req.on('timeout', function () { req.destroy(); });
      req.end();
    }, 5000);
  }

  function _stopSessionPolling() {
    if (sessionPollTimer) {
      clearInterval(sessionPollTimer);
      sessionPollTimer = null;
    }
    lastKnownSessions = null;
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    stopPing();
    _stopSessionPolling();
    if (ws) {
      try { ws.close(); } catch (e) {}
      ws = null;
    }
    connected = false;
    handshakeDone = false;
  }

  function isConnected() {
    return connected && handshakeDone;
  }

  connect();

  return {
    emitter: emitter,
    connect: connect,
    disconnect: disconnect,
    isConnected: isConnected,
    chatSend: chatSend,
    chatHistory: chatHistory,
    sendRequest: sendRequest
  };
}

module.exports = { createWsClient: createWsClient };
