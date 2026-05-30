/**
 * session-sync.js — 事件驱动的 session 文件同步
 *
 * 职责：收到 Gateway WS 事件后，读取主 agent session 文件，检测新消息并广播到前端。
 *
 * 输出事件：
 *   announce-result    → 主 agent session 中的新 assistant 消息
 *   subagent-progress  → 子 agent 执行进度（正在调用的工具）
 *
 * 触发方式：
 *   Gateway WS 事件到达 → 延迟读一次文件 → 广播 → 结束
 *   不轮询，不循环。
 */

const fs = require('fs');
const path = require('path');
const debugTrace = require('./debug-trace');

var _broadcastSSE = null;
var _syncFilePath = '';
var _syncFileOffset = 0;
var _retryTimer = null;
var _retryCount = 0;
var MAX_RETRIES = 2;
var RETRY_DELAY_MS = 1000;
var INITIAL_DELAY_MS = 500;
var MAIN_AGENT_SESSIONS_SUBDIR = path.join('agents', 'main', 'sessions');

function _logError(prefix, e) {
  if (e && e.message) console.error('[Sync] ' + prefix + ': ' + e.message);
}

function init(broadcastFn) {
  _broadcastSSE = broadcastFn;
}

var _lastAgentId = '';

function onSubagentGatewayEvent(data) {
  try {
    var eventName = data.event || '';
    if ((eventName === 'session.tool' || eventName === 'agent') && data.payload) {
      var sk = data.payload.sessionKey || '';
      var parts = sk.split(':');
      if (parts.length >= 2 && parts[1] !== 'main') {
        var oldId = _lastAgentId;
        _lastAgentId = parts[1];
        debugTrace.trace('lastAgentId-change', { from: oldId, to: _lastAgentId, trigger: eventName, sessionKey: sk });
      }
    }
    if (eventName === 'session.tool' || eventName === 'agent'
        || eventName === 'sessions.changed' || eventName === 'session.created' || eventName === 'session.updated') {
      _scheduleRead();
    }
  } catch (e) { _logError('gatewayEvent', e); }
}

function _scheduleRead() {
  if (_retryTimer) return;
  _retryCount = 0;
  _retryTimer = setTimeout(function () {
    _retryTimer = null;
    _doRead();
  }, INITIAL_DELAY_MS);
}

function _doRead() {
  var targetFile = _findTargetFile();
  if (!targetFile) return;

  if (targetFile !== _syncFilePath) {
    _syncFilePath = targetFile;
    try {
      _syncFileOffset = fs.statSync(targetFile).size;
    } catch (e) { _syncFileOffset = 0; }
    return;
  }

  var newMessages = [];
  try {
    var stat = fs.statSync(targetFile);
    if (stat.size <= _syncFileOffset) {
      _maybeRetry();
      return;
    }
    var readSize = stat.size - _syncFileOffset;
    var fd = fs.openSync(targetFile, 'r');
    try {
      var buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, _syncFileOffset);
    } finally {
      fs.closeSync(fd);
    }
    _syncFileOffset = stat.size;
    newMessages = _parseAssistantMessages(buf.toString('utf8')).messages;
  } catch (e) { _logError('read', e); }

  if (newMessages.length > 0) {
    debugTrace.trace('announce-result-broadcast', { agentId: _lastAgentId, msgCount: newMessages.length, lastMsgPreview: (newMessages[newMessages.length - 1].content || '').substring(0, 100) });
    if (_broadcastSSE) {
      _broadcastSSE({ type: 'announce-result', messages: newMessages, agentId: _lastAgentId });
    }
    _lastAgentId = '';
  } else {
    _maybeRetry();
  }
}

function _maybeRetry() {
  if (_retryCount < MAX_RETRIES) {
    _retryCount++;
    _retryTimer = setTimeout(function () {
      _retryTimer = null;
      _doRead();
    }, RETRY_DELAY_MS);
  }
}

function stopSync() {
  if (_retryTimer) {
    clearTimeout(_retryTimer);
    _retryTimer = null;
  }
  _syncFilePath = '';
  _syncFileOffset = 0;
  _retryCount = 0;
  console.log('[Sync] Stopped');
}

function _isHeartbeatSession(filePath) {
  try {
    var fd = fs.openSync(filePath, 'r');
    var headBuf = Buffer.alloc(Math.min(4096, fs.fstatSync(fd).size));
    fs.readSync(fd, headBuf, 0, headBuf.length, 0);
    fs.closeSync(fd);
    var head = headBuf.toString('utf8');
    var lines = head.split('\n').filter(function (l) { return l.trim(); });
    var checkedCount = 0;
    for (var i = 0; i < lines.length && checkedCount < 5; i++) {
      try {
        var item = JSON.parse(lines[i]);
        checkedCount++;
        if (item.sessionKey && item.sessionKey.indexOf('heartbeat') >= 0) return true;
        if (item.type === 'message' && item.message && item.message.content) {
          var content = item.message.content;
          if (Array.isArray(content)) {
            var allHeartbeat = content.length > 0;
            for (var c = 0; c < content.length; c++) {
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
}

function _findTargetFile() {
  try {
    var stateDir = process.env.OPENCLAW_STATE_DIR;
    if (!stateDir) return null;
    var sessionsDir = path.join(stateDir, MAIN_AGENT_SESSIONS_SUBDIR);
    if (!fs.existsSync(sessionsDir)) return null;
    var files = fs.readdirSync(sessionsDir).filter(function (f) { return f.endsWith('.jsonl') && f.indexOf('trajectory') < 0; });
    if (files.length === 0) return null;
    files.sort(function (a, b) {
      var ta = 0, tb = 0;
      try { ta = fs.statSync(path.join(sessionsDir, a)).mtimeMs; } catch (e) {}
      try { tb = fs.statSync(path.join(sessionsDir, b)).mtimeMs; } catch (e) {}
      return tb - ta;
    });
    for (var fi = 0; fi < files.length; fi++) {
      var fp = path.join(sessionsDir, files[fi]);
      try {
        if (_isHeartbeatSession(fp)) continue;
        return fp;
      } catch (e) { _logError('findTarget', e); }
    }
    return path.join(sessionsDir, files[0]);
  } catch (e) { _logError('findTarget', e); return null; }
}

function _parseAssistantMessages(raw) {
  var result = { messages: [] };
  var lines = raw.split('\n').filter(function (l) { return l.trim(); });
  for (var k = 0; k < lines.length; k++) {
    try {
      var item = JSON.parse(lines[k]);
      if (item.type === 'message' && item.message && item.message.role === 'assistant') {
        var content = item.message.content || [];
        var text = '';
        if (Array.isArray(content)) {
          for (var c = 0; c < content.length; c++) {
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
  var targetFile = _findTargetFile();
  if (!targetFile) return [];
  try {
    var raw = fs.readFileSync(targetFile, 'utf8');
    return _parseAssistantMessages(raw).messages;
  } catch (e) { _logError('readMessages', e); return []; }
}

module.exports = {
  init: init,
  onSubagentGatewayEvent: onSubagentGatewayEvent,
  startSync: _scheduleRead,
  stopSync: stopSync,
  readGatewayAssistantMessages: readGatewayAssistantMessages,
};
