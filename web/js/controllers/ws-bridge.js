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
 Announce 通道（智能调度结果回传）：
 *   announce-result → 主 Agent 合成子 Agent 结果后的新回复
 *     SSE 流在 spawn 后结束 [DONE]，子 Agent 结果通过 Announce 机制
 *     异步回传到主 Agent session，session-sync.js 事件驱动检测后广播此事件。
 *     前端收到后渲染为新的 assistant 消息气泡。
 *   subagent-progress → 子 Agent 执行进度（正在调用的工具）
 *     显示子 Agent 正在执行的工具，提供执行流程可视化。
 */

var WsBridge = {
  _source: null,
  _reconnectTimer: null,
  _connected: false,
  _listeners: {},
  _retryCount: 0,
  _maxRetryDelay: 30000,  // 最大重连延迟 30 秒
  _baseDelay: 3000,       // 基础延迟 3 秒

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
      self._retryCount = 0;  // 连接成功，重置重试计数
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
      self._scheduleReconnect();
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
      try {
        var data = JSON.parse(e.data);
        DebugTrace.log('ws-bridge-announce-result', { agentId: data.agentId || '', msgCount: data.messages ? data.messages.length : 0 });
        if (data.messages && data.messages.length > 0 && typeof ChatController !== 'undefined' && ChatController.handleAnnounceResult) {
          ChatController.handleAnnounceResult(data.messages, data.agentId || '');
        }
      } catch (err) { console.error('[WsBridge] announce-result error:', err); }
    });

    this._source.addEventListener('subagent-progress', function (e) {
      try {
        var data = JSON.parse(e.data);
        DebugTrace.log('ws-bridge-subagent-progress', { progress: data.progress });
        if (data.progress && typeof ChatController !== 'undefined' && ChatController.handleSubagentProgress) {
          ChatController.handleSubagentProgress(data.progress);
        }
      } catch (err) { console.error('[WsBridge] subagent-progress error:', err); }
    });
  },

  /**
   * 调度重连（指数退避）
   *
   * 策略：
   *   第 1 次：3 秒后重连
   *   第 2 次：6 秒后重连（3 × 2）
   *   第 3 次：12 秒后重连（6 × 2）
   *   第 4 次：24 秒后重连（12 × 2）
   *   ...最多 30 秒
   *
   * @private
   */
  _scheduleReconnect: function () {
    if (this._reconnectTimer) return;

    var delay = Math.min(
      this._baseDelay * Math.pow(2, this._retryCount),
      this._maxRetryDelay
    );
    this._retryCount++;

    console.log('[WsBridge] Reconnecting in ' + (delay / 1000) + 's (attempt ' + this._retryCount + ')');

    var self = this;
    this._reconnectTimer = setTimeout(function () {
      self._reconnectTimer = null;
      self.connect();
    }, delay);
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
    this._retryCount = 0;
    this._listeners = {};
  },

};
