/**
 * session-sync.js — 事件驱动的 session 文件同步
 *
 * 职责：收到 Gateway WS 事件后，读取主 agent session 文件，检测新消息并广播到前端。
 *
 * 输出事件：
 *   announce-result    → 主 agent session 中的新 assistant 消息（携带 sessionId）
 *   subagent-progress  → 子 agent 执行进度（正在调用的工具）
 *
 * 触发方式：
 *   Gateway WS 事件到达 → 提取 sessionKey → 延迟读对应文件 → 广播 → 结束
 *   不轮询，不循环。
 *
 * session 归属：
 *   前端发送请求时在 x-openclaw-session-key 中携带 session ID，
 *   格式: agent:<agentId>:webui:<sessionId>
 *   本模块从事件的 sessionKey 中提取 sessionId，随 announce-result 传回前端，
 *   前端据此将消息路由到正确的 session。
 */

const fs = require('fs');
const path = require('path');
const debugTrace = require('./debug-trace');

let _broadcastSSE = null;
let _fileOffsets = {};
let _retryTimer = null;
let _retryCount = 0;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const INITIAL_DELAY_MS = 500;
const MAIN_AGENT_SESSIONS_SUBDIR = path.join('agents', 'main', 'sessions');

function _logError(prefix, e) {
  if (e && e.message) console.error('[Sync] ' + prefix + ': ' + e.message);
}

function init(broadcastFn) {
  _broadcastSSE = broadcastFn;
}

let _lastAgentId = '';

function _extractFrontendSessionId(sessionKey) {
  if (!sessionKey || sessionKey.indexOf(':webui:') < 0) return '';
  const idx = sessionKey.indexOf(':webui:');
  return sessionKey.substring(idx + 7);
}

function onSubagentGatewayEvent(data) {
  try {
    const eventName = data.event || '';
    const p = data.payload || {};
    const sessionKey = p.sessionKey || '';

    let frontendSessionId = _extractFrontendSessionId(sessionKey);

    if (!frontendSessionId) {
      const parentKey = p.parentSessionKey || p.spawnedBy || '';
      frontendSessionId = _extractFrontendSessionId(parentKey);
    }

    if ((eventName === 'session.tool' || eventName === 'agent') && sessionKey) {
      const parts = sessionKey.split(':');
      if (parts.length >= 2 && parts[1] !== 'main') {
        const oldId = _lastAgentId;
        _lastAgentId = parts[1];
        debugTrace.trace('lastAgentId-change', { from: oldId, to: _lastAgentId, trigger: eventName, sessionKey: sessionKey });
      }
    }
    if (eventName === 'sessions.changed' || eventName === 'session.created' || eventName === 'session.updated') {
      _scheduleRead(sessionKey, frontendSessionId);
  } else if ((eventName === 'session.tool' || eventName === 'agent') && sessionKey && sessionKey.indexOf(':subagent:') < 0) {
      _scheduleRead(sessionKey, frontendSessionId);
  }
  } catch (e) { _logError('gatewayEvent', e); }
}

function _scheduleRead(sessionKey, frontendSessionId) {
  if (_retryTimer) return;
  _retryCount = 0;
  _retryTimer = setTimeout(function () {
    _retryTimer = null;
    _doRead(sessionKey, frontendSessionId);
  }, INITIAL_DELAY_MS);
}

function _doRead(sessionKey, frontendSessionId) {
  const targetFile = _findTargetFile(sessionKey);
  if (!targetFile) return;

  if (!(targetFile in _fileOffsets)) {
    try {
      _fileOffsets[targetFile] = fs.statSync(targetFile).size;
    } catch (e) { _fileOffsets[targetFile] = 0; }
    return;
  }

  let newMessages = [];
  try {
    const stat = fs.statSync(targetFile);
    const currentOffset = _fileOffsets[targetFile] || 0;
    if (stat.size <= currentOffset) {
      _maybeRetry(sessionKey, frontendSessionId);
      return;
    }
    const readSize = stat.size - currentOffset;
    const fd = fs.openSync(targetFile, 'r');
    let buf;
    try {
      buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, currentOffset);
    } finally {
      fs.closeSync(fd);
    }
    _fileOffsets[targetFile] = stat.size;
    newMessages = _parseAssistantMessages(buf.toString('utf8')).messages;
  } catch (e) { _logError('read', e); }

  if (newMessages.length > 0) {
    // Fix 4: main session 的 announce 不应带子 agent 标签
    if (sessionKey && sessionKey.indexOf(':webui:') >= 0) _lastAgentId = '';
    debugTrace.trace('announce-result-broadcast', { agentId: _lastAgentId, sessionId: frontendSessionId, msgCount: newMessages.length, lastMsgPreview: (newMessages[newMessages.length - 1].content || '').substring(0, 100) });
    if (_broadcastSSE) {
      _broadcastSSE({ type: 'announce-result', messages: newMessages, agentId: _lastAgentId, sessionId: frontendSessionId });
    }
    _lastAgentId = '';
  } else {
    _maybeRetry(sessionKey, frontendSessionId);
  }
}

function _maybeRetry(sessionKey, frontendSessionId) {
  if (_retryCount < MAX_RETRIES) {
    _retryCount++;
    _retryTimer = setTimeout(function () {
      _retryTimer = null;
      _doRead(sessionKey, frontendSessionId);
    }, RETRY_DELAY_MS);
  }
}

function stopSync() {
  if (_retryTimer) {
    clearTimeout(_retryTimer);
    _retryTimer = null;
  }
  _fileOffsets = {};
  _retryCount = 0;
  console.log('[Sync] Stopped');
}

function _isHeartbeatSession(filePath) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const headBuf = Buffer.alloc(Math.min(4096, fs.fstatSync(fd).size));
    fs.readSync(fd, headBuf, 0, headBuf.length, 0);
    const head = headBuf.toString('utf8');
    const lines = head.split('\n').filter(function (l) { return l.trim(); });
    let checkedCount = 0;
    for (let i = 0; i < lines.length && checkedCount < 5; i++) {
      try {
        const item = JSON.parse(lines[i]);
        checkedCount++;
        if (item.sessionKey && item.sessionKey.indexOf('heartbeat') >= 0) return true;
        if (item.type === 'message' && item.message && item.message.content) {
          const content = item.message.content;
          if (Array.isArray(content)) {
            let allHeartbeat = content.length > 0;
            for (let c = 0; c < content.length; c++) {
              if (!content[c] || (content[c].text !== 'HEARTBEAT_OK' && content[c].text !== 'heartbeat')) {
                allHeartbeat = false;
                break;
              }
            }
            if (allHeartbeat) return true;
          }
        }
      } catch (e) {}
    }
    return false;
  } catch (e) { return false; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch (e) {} } }
}

function _findTargetFile(sessionKey) {
  try {
    const stateDir = process.env.OPENCLAW_STATE_DIR;
    if (!stateDir) return null;
    const sessionsDir = path.join(stateDir, MAIN_AGENT_SESSIONS_SUBDIR);
    if (!fs.existsSync(sessionsDir)) return null;
    const files = fs.readdirSync(sessionsDir).filter(function (f) { return f.endsWith('.jsonl') && f.indexOf('trajectory') < 0; });
    if (files.length === 0) return null;

    if (sessionKey) {
      const normalizedKey = sessionKey.replace(/:/g, '_');
      for (let fi = 0; fi < files.length; fi++) {
        if (files[fi].indexOf(normalizedKey) >= 0) {
          const fp = path.join(sessionsDir, files[fi]);
          if (!_isHeartbeatSession(fp)) return fp;
        }
      }
    }

    files.sort(function (a, b) {
      let ta = 0, tb = 0;
      try { ta = fs.statSync(path.join(sessionsDir, a)).mtimeMs; } catch (e) {}
      try { tb = fs.statSync(path.join(sessionsDir, b)).mtimeMs; } catch (e) {}
      return tb - ta;
    });
    for (let fi = 0; fi < files.length; fi++) {
      const fp = path.join(sessionsDir, files[fi]);
      try {
        if (_isHeartbeatSession(fp)) continue;
        return fp;
      } catch (e) { _logError('findTarget', e); }
    }
    return path.join(sessionsDir, files[0]);
  } catch (e) { _logError('findTarget', e); return null; }
}

function _parseAssistantMessages(raw) {
  const result = { messages: [] };
  const lines = raw.split('\n').filter(function (l) { return l.trim(); });
  for (let k = 0; k < lines.length; k++) {
    try {
      const item = JSON.parse(lines[k]);
      if (item.type === 'message' && item.message && item.message.role === 'assistant') {
        const content = item.message.content || [];
        let text = '';
        if (Array.isArray(content)) {
          for (let c = 0; c < content.length; c++) {
            if (content[c] && content[c].text) { text = content[c].text; }
          }
        } else if (typeof content === 'string') {
          text = content;
        }
        if (text && text !== 'HEARTBEAT_OK') {
          result.messages.push({ role: 'assistant', content: text, agentId: '' });
        }
      }
    } catch (e) { _logError('parseLine', e); }
  }
  return result;
}

function readGatewayAssistantMessages() {
  const targetFile = _findTargetFile();
  if (!targetFile) return [];
  try {
    const raw = fs.readFileSync(targetFile, 'utf8');
    return _parseAssistantMessages(raw).messages;
  } catch (e) { _logError('readMessages', e); return []; }
}

module.exports = {
  init: init,
  onSubagentGatewayEvent: onSubagentGatewayEvent,
  startSync: function () { _scheduleRead('', ''); },
  stopSync: stopSync,
  readGatewayAssistantMessages: readGatewayAssistantMessages,
};
