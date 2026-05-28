/**
 * sse-manager.js — SSE 连接管理
 *
 * 职责：管理 Server-Sent Events 客户端连接的生命周期
 * - 客户端注册与注销
 * - 事件广播（推送 Gateway 状态、agent 变更等）
 * - 连接清理（服务关闭时）
 *
 * 契约：
 *   init(getWsStatus)   — 注入 WS 状态查询回调
 *   handleSSE(req, res) — SSE 端点处理器（/api/events）
 *   broadcast(payload)  — 向所有客户端广播事件
 *   closeAll()          — 关闭所有连接（服务关闭时调用）
 */

const SseManager = {
  clients: [],
  _getWsStatus: null,

  init(getWsStatus) {
    this._getWsStatus = getWsStatus || null;
  },

  handleSSE(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    const wsStatus = this._getWsStatus ? this._getWsStatus() : 'disconnected';
    res.write('data: ' + JSON.stringify({ type: 'status', ws: wsStatus }) + '\n\n');
    this.clients.push(res);
    const self = this;
    req.on('close', function () {
      const idx = self.clients.indexOf(res);
      if (idx >= 0) self.clients.splice(idx, 1);
    });
  },

  broadcast(payload) {
    const eventType = payload.type || 'message';
    const data = 'event: ' + eventType + '\ndata: ' + JSON.stringify(payload) + '\n\n';
    const dead = [];
    for (let i = 0; i < this.clients.length; i++) {
      try {
        this.clients[i].write(data);
      } catch (e) {
        dead.push(i);
      }
    }
    for (let j = dead.length - 1; j >= 0; j--) {
      this.clients.splice(dead[j], 1);
    }
  },

  closeAll() {
    for (let i = 0; i < this.clients.length; i++) {
      try { this.clients[i].end(); } catch (e) {}
    }
    this.clients = [];
  }
};

module.exports = SseManager;
