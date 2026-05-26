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
      pendingRequests[id] = { resolve: resolve, reject: reject };
      ws.send(JSON.stringify({ type: 'req', id: id, method: method, params: params }));
      setTimeout(function () {
        if (pendingRequests[id]) {
          delete pendingRequests[id];
          reject(new Error('Request timeout: ' + method));
        }
      }, timeoutMs || 30000);
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
        if (eventName !== 'tick' && eventName !== 'health' && eventName !== 'presence') {
          console.log('[WS] Event:', eventName, JSON.stringify(data).slice(0, 500));
        }
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

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    stopPing();
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
