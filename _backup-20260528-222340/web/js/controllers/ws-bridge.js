/**
 * ws-bridge.js — 前端 SSE 事件桥
 *
 * ═══ 通道架构 ═══
 *
 * 消息渲染通道（唯一）：
 *   SSE 流 /v1/chat/completions → Api.chat() → StreamRenderer
 *   所有用户可见的消息文本，只通过这一条通道渲染到 DOM。
 *   其他通道不允许追加消息到 DOM，否则会产生重复。
 *
 * 状态通道（辅助）：
 *   gateway    → Gateway WS 事件转发（session.tool, sessions.changed 等）
 *   status     → 连接状态（ws: connected/disconnected）
 *   agents-updated → Agent 列表变更通知
 *
 * 预留通道（暂不渲染）：
 *   announce-result → 智能调度模式下子 agent 的 announce 结果
 *     当前 SSE 流已包含主 agent 的完整响应（含 announce 后续），
 *     此通道预留用于：SSE 流中断后的恢复、子 agent 进度展示。
 *     启用前需重构 session-sync.js，过滤掉 SSE 流已渲染的消息。
 *   subagent-progress → 子 agent 执行进度（正在调用的工具）
 *     预留用于未来的子 agent 进度卡片 UI。
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

    this._source.addEventListener('chat-update', function () {
    });

    this._source.addEventListener('announce-result', function (e) {
    });

    this._source.addEventListener('subagent-progress', function (e) {
    });
  },

  _handleGatewayEvent: function (data) {
    var inner = data.data || data;
    var eventName = inner.event || '';
    var payload = inner.payload || inner.params || inner;

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
  },

};
