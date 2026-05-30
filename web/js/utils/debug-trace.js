/**
 * debug-trace.js — 前端调试追踪模块
 *
 * 职责：
 *   1. 记录前端关键事件到内存
 *   2. 关键事件立即 flush 到后端
 *   3. 普通事件批量 flush
 *
 * 用法：
 *   DebugTrace.log('onAgentSwitch', { switchedAgentId: 'xxx', blocked: true });
 *   DebugTrace.flush();
 */

const DebugTrace = {
  _buffer: [],
  _flushTimer: null,
  _flushDelay: 2000,

  log: function (type, data) {
    const entry = {
      ts: new Date().toISOString(),
      type: type,
      data: data || {}
    };
    this._buffer.push(entry);
    console.log('[Trace] ' + type, data);

    if (this._isCritical(type)) {
      this.flush();
    } else if (!this._flushTimer) {
      const self = this;
      this._flushTimer = setTimeout(function () {
        self._flushTimer = null;
        self.flush();
      }, this._flushDelay);
    }
  },

  _isCritical: function (type) {
    return type === 'onAgentSwitch'
      || type === 'onDone'
      || type === 'handleAnnounceResult'
      || type === 'appendMessage'
      || type === 'sendMessage';
  },

  flush: function () {
    if (this._buffer.length === 0) return;
    const batch = this._buffer.splice(0, this._buffer.length);
    for (let i = 0; i < batch.length; i++) {
      try {
        const blob = new Blob([JSON.stringify({
          type: batch[i].type,
          data: Object.assign({}, batch[i].data, { _ts: batch[i].ts })
        })], { type: 'application/json' });
        navigator.sendBeacon('/api/log', blob);
      } catch (e) {
        console.warn('[DebugTrace] flush error:', e);
      }
    }
  },

  clear: function () {
    this._buffer = [];
    fetch('/api/logs/clear', { method: 'POST' }).catch(function () {});
  },
};

window.addEventListener('beforeunload', function () {
  DebugTrace.flush();
});
