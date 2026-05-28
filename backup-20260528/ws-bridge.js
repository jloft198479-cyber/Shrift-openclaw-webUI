/**
 * ws-bridge.js — 前端 SSE 事件桥
 *
 * 职责：
 *   1. 连接 /api/events（SSE 端点）
 *   2. 接收后端转发的 Gateway WebSocket 事件
 *   3. 解析事件类型，路由到监听器
 */

var WsBridge = {
  _source: null,
  _reconnectTimer: null,
  _connected: false,
  _listeners: {},

  init: function () {
    this.connect();
  },

  connect: function () {
    var self = this;
    if (this._source) {
      try { this._source.close(); } catch (e) {}
    }

    this._source = new EventSource('/api/events');

    this._source.onopen = function () {
      console.log('[WsBridge] SSE connected');
      self._connected = true;
      State.setState({ connected: true });
      if (typeof Api !== 'undefined') {
        if (Api.fetchAgents) Api.fetchAgents();
        if (Api.fetchModels) Api.fetchModels();
      }
    };

    this._source.onerror = function () {
      console.warn('[WsBridge] SSE error, reconnecting…');
      self._connected = false;
      self._source.close();
      self._source = null;
      if (!self._reconnectTimer) {
        self._reconnectTimer = setTimeout(function () {
          self._reconnectTimer = null;
          self.connect();
        }, 3000);
      }
    };

    this._source.addEventListener('gateway', function (e) {
      try {
        var data = JSON.parse(e.data);
        self._handleGatewayEvent(data);
      } catch (err) {
        console.error('[WsBridge] Parse error:', err);
      }
    });

    this._source.addEventListener('status', function (e) {
      try {
        var data = JSON.parse(e.data);
        if (data.ws === 'connected') {
          self._connected = true;
          State.setState({ connected: true });
        } else if (data.ws === 'disconnected') {
          self._connected = false;
        }
      } catch (err) { console.error('[WsBridge] status parse error:', err); }
    });

    this._source.addEventListener('agents-updated', function () {
      if (typeof Api !== 'undefined' && Api.fetchAgents) {
        Api.fetchAgents();
      }
    });

    this._source.addEventListener('chat-update', function (e) {
      try {
        var data = JSON.parse(e.data);
        self._handleChatUpdate(data);
      } catch (err) { console.error('[WsBridge] chat-update error:', err); }
    });

    this._source.addEventListener('chat-sync', function (e) {
      try {
        var data = JSON.parse(e.data);
        self._handleChatSync(data);
      } catch (err) { console.error('[WsBridge] chat-sync error:', err); }
    });

    this._source.addEventListener('subagent-spawned', function (e) {
      try {
        var data = JSON.parse(e.data);
        self._handleSubagentSpawned(data);
      } catch (err) { console.error('[WsBridge] subagent-spawned error:', err); }
    });

    this._source.addEventListener('subagent-progress', function (e) {
      try {
        var data = JSON.parse(e.data);
        self._handleSubagentProgress(data);
      } catch (err) { console.error('[WsBridge] subagent-progress error:', err); }
    });
  },

  _handleGatewayEvent: function (data) {
    var inner = data.data || data;
    var eventName = inner.event || '';
    var payload = inner.payload || inner.params || inner;

    console.log('[WsBridge] Gateway event:', eventName, JSON.stringify(data).slice(0, 500));

    // 通知所有监听器
    var fns = this._listeners[eventName];
    if (fns) fns.forEach(function (fn) {
      try { fn(payload, data); } catch (e) { console.error('[WsBridge] Listener error:', e); }
    });
    var starFns = this._listeners['*'];
    if (starFns) starFns.forEach(function (fn) {
      try { fn(payload, data, eventName); } catch (e) { console.error('[WsBridge] wildcard listener error:', e); }
    });
  },

  on: function (eventName, callback) {
    if (!this._listeners[eventName]) this._listeners[eventName] = new Set();
    this._listeners[eventName].add(callback);
  },

  off: function (eventName, callback) {
    if (!this._listeners[eventName]) return;
    this._listeners[eventName].delete(callback);
    if (this._listeners[eventName].size === 0) delete this._listeners[eventName];
  },

  isConnected: function () {
    return this._connected;
  },

  destroy: function () {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._source) {
      this._source.close();
      this._source = null;
    }
    this._connected = false;
    this._listeners = {};
    Dedup.reset();
  },

  _handleChatUpdate: function (data) {
    if (!data || !data.messages || !data.messages.length) return;
    var msgEl = document.getElementById('messages');
    var addedAny = false;
    for (var i = 0; i < data.messages.length; i++) {
      var msg = data.messages[i];
      if (!msg.content) continue;
      if (Dedup.isDuplicate(msg.content)) continue;
      if (msg.role === 'assistant' && typeof MessageRenderer !== 'undefined' && MessageRenderer.appendMessage) {
        MessageRenderer.appendMessage(msg.role, msg.content, false, '', msg.agentId || '');
        addedAny = true;
      }
    }
    if (addedAny && msgEl) {
      msgEl.scrollTop = msgEl.scrollHeight;
    }
  },

  _handleChatSync: function (data) {
    if (!data || !data.messages || !data.messages.length) return;
    if (data.progress && typeof SubagentCard !== 'undefined') {
      SubagentCard.updateProgress(data.progress);
    }
    var msgEl = document.getElementById('messages');
    var addedAny = false;
    var lastBubble = msgEl && msgEl.querySelector('.message.assistant:last-of-type');
    for (var i = 0; i < data.messages.length; i++) {
      var msg = data.messages[i];
      if (!msg.content) continue;
      if (Dedup.isDuplicate(msg.content)) continue;
      if (msg.role === 'assistant' && typeof MessageRenderer !== 'undefined' && MessageRenderer.appendMessage) {
        if (!addedAny && typeof SubagentCard !== 'undefined') {
          SubagentCard.ensureActive(lastBubble);
        }
        MessageRenderer.appendMessage(msg.role, msg.content, false, '', msg.agentId || '');
        addedAny = true;
      }
    }
    if (addedAny) {
      if (typeof SubagentCard !== 'undefined') {
        SubagentCard.completeAll();
      }
      if (msgEl) msgEl.scrollTop = msgEl.scrollHeight;
    }
  },

  _handleSubagentSpawned: function (data) {
    if (!data || !data.agentId) return;
    if (typeof SubagentCard === 'undefined') return;
    var msgEl = document.getElementById('messages');
    var lastBubble = msgEl && msgEl.querySelector('.message.assistant:last-of-type');
    SubagentCard.create({
      anchorEl: lastBubble,
      agentId: data.agentId,
      agentName: '',
      task: data.task || '',
      runId: data.callId || ''
    });
  },

  _handleSubagentProgress: function (data) {
    if (!data || !data.progress) return;
    if (typeof SubagentCard === 'undefined') return;
    SubagentCard.updateProgress(data.progress);
  },
};
