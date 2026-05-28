/**
 * session-sync.js — Gateway session 文件轮询
 *
 * 职责：轮询主 agent 的 session 文件，检测新消息并广播到前端。
 *
 * 输出事件：
 *   announce-result    → 主 agent session 中的新 assistant 消息
 *     注意：当前包含所有新消息（含 SSE 流已渲染的重复），
 *     前端暂不处理此事件。启用前需过滤掉 SSE 流已渲染的消息。
 *   subagent-progress  → 子 agent 执行进度（正在调用的工具）
 *     前端暂不处理此事件，预留用于未来的进度卡片 UI。
 *
 * 触发条件：
 *   Gateway WS 事件（session.tool, sessions.changed 等）触发 startSync()
 *   之后每 5 秒轮询一次，连续 24 次无新消息则停止
 */

const fs = require('fs');
const path = require('path');

var _broadcastSSE = null;
var _syncLoopTimer = null;
var _syncLastCount = 0;
var _syncIdleRounds = 0;
var _syncFilePath = '';
var _syncFileOffset = 0;
var _syncParsedCount = 0;
var SYNC_INTERVAL_MS = 5000;
var SYNC_MAX_IDLE_ROUNDS = 6;
var MAIN_AGENT_SESSIONS_SUBDIR = path.join('agents', 'main', 'sessions');
var SUBAGENT_PROGRESS_MAX_AGE_MS = 300000;
var _subagentDirsCache = null;
var _subagentDirsCacheTime = 0;
var SUBAGENT_DIRS_CACHE_TTL = 10000;

function _hasActiveSubagentDirs() {
  var now = Date.now();
  if (_subagentDirsCache !== null && now - _subagentDirsCacheTime < SUBAGENT_DIRS_CACHE_TTL) {
    return _subagentDirsCache;
  }
  try {
    var stateDir = process.env.OPENCLAW_STATE_DIR;
    if (!stateDir) { _subagentDirsCache = false; _subagentDirsCacheTime = now; return false; }
    var agentsDir = path.join(stateDir, 'agents');
    if (!fs.existsSync(agentsDir)) { _subagentDirsCache = false; _subagentDirsCacheTime = now; return false; }
    var dirs = fs.readdirSync(agentsDir).filter(function (d) { return d !== 'main'; });
    _subagentDirsCache = dirs.length > 0;
    _subagentDirsCacheTime = now;
    return _subagentDirsCache;
  } catch (e) { _subagentDirsCache = false; _subagentDirsCacheTime = now; return false; }
}

function _logError(prefix, e) {
  if (e && e.message) console.error('[Sync] ' + prefix + ': ' + e.message);
}

function init(broadcastFn) {
  _broadcastSSE = broadcastFn;
}

function onSubagentGatewayEvent(data) {
  try {
    var inner = data.data || data;
    var eventName = inner.event || '';
    if (eventName === 'session.tool' || eventName === 'sessions.changed' || eventName === 'session.created' || eventName === 'session.updated') {
      if (!_syncLoopTimer) startSync();
    }
  } catch (e) { _logError('gatewayEvent', e); }
}

var SYNC_LOOKBACK_BYTES = 16384;

function startSync() {
  if (_syncLoopTimer) return;
  _syncIdleRounds = 0;
  var targetFile = _findTargetFile();
  if (targetFile) {
    _syncFilePath = targetFile;
    try {
      var stat = fs.statSync(targetFile);
      _syncFileOffset = Math.max(0, stat.size - SYNC_LOOKBACK_BYTES);
    } catch (e) { _syncFileOffset = 0; }
  } else {
    _syncFilePath = '';
    _syncFileOffset = 0;
  }
  _syncParsedCount = countGatewayAssistantMessages();
  _syncLastCount = _syncParsedCount;
  _syncLoopTimer = setInterval(doSync, SYNC_INTERVAL_MS);
  console.log('[Sync] Loop started, baseline=' + _syncLastCount + ', offset=' + _syncFileOffset);
}

function doSync() {
  var targetFile = _findTargetFile();
  if (!targetFile) {
    _syncIdleRounds++;
    if (_syncIdleRounds >= SYNC_MAX_IDLE_ROUNDS) stopSync();
    return;
  }
  if (targetFile !== _syncFilePath) {
    _syncFilePath = targetFile;
    _syncFileOffset = 0;
    _syncParsedCount = 0;
  }
  var newMessages = [];
  try {
    var stat = fs.statSync(targetFile);
    if (stat.size <= _syncFileOffset) {
      if (!_hasActiveSubagentDirs()) { stopSync(); return; }
      var prog = _readSubagentProgress();
      if (prog && Object.keys(prog).length > 0) {
        _syncIdleRounds = 0;
        if (_broadcastSSE) {
          _broadcastSSE({ type: 'subagent-progress', progress: prog });
        }
      } else {
        _syncIdleRounds++;
        if (_syncIdleRounds >= SYNC_MAX_IDLE_ROUNDS) stopSync();
      }
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
    var chunk = buf.toString('utf8');
    var parsed = _parseAssistantMessages(chunk);
    newMessages = parsed.messages;
  } catch (e) { _logError('incrementalRead', e); }
  _syncParsedCount += newMessages.length;
  var progress = null;
  if (_hasActiveSubagentDirs()) {
    progress = _readSubagentProgress();
  }
  var hasProgress = progress && Object.keys(progress).length > 0;
  if (newMessages.length === 0) {
    if (hasProgress) {
      _syncIdleRounds = 0;
      if (_broadcastSSE) {
        _broadcastSSE({ type: 'subagent-progress', progress: progress });
      }
    } else {
      _syncIdleRounds++;
      if (_syncIdleRounds >= SYNC_MAX_IDLE_ROUNDS) stopSync();
    }
    return;
  }
  _syncIdleRounds = 0;
  if (_broadcastSSE) {
    _broadcastSSE({ type: 'announce-result', messages: newMessages, total: _syncParsedCount, progress: progress });
  }
  _syncLastCount = _syncParsedCount;
}

function stopSync() {
  if (_syncLoopTimer) {
    clearInterval(_syncLoopTimer);
    _syncLoopTimer = null;
    _syncLastCount = 0;
    _syncIdleRounds = 0;
    _syncFilePath = '';
    _syncFileOffset = 0;
    _syncParsedCount = 0;
    _subagentDirsCache = null;
    _subagentDirsCacheTime = 0;
    console.log('[Sync] Loop stopped');
  }
}

function countGatewayAssistantMessages() {
  return readGatewayAssistantMessages().length;
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
        var fd = fs.openSync(fp, 'r');
        var headBuf = Buffer.alloc(Math.min(4096, fs.fstatSync(fd).size));
        fs.readSync(fd, headBuf, 0, headBuf.length, 0);
        fs.closeSync(fd);
        var head = headBuf.toString('utf8');
        if (head.indexOf('heartbeat') >= 0 && head.indexOf('HEARTBEAT') >= 0 && head.indexOf('agent-mp') < 0 && head.indexOf('agent:main') < 0) continue;
        return fp;
      } catch (e) { _logError('findTargetHead', e); }
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

function _readSubagentProgress() {
  var progress = {};
  try {
    var stateDir = process.env.OPENCLAW_STATE_DIR;
    if (!stateDir) return progress;
    var agentsDir = path.join(stateDir, 'agents');
    if (!fs.existsSync(agentsDir)) return progress;
    var agentDirs = fs.readdirSync(agentsDir);
    for (var ai = 0; ai < agentDirs.length; ai++) {
      var agentId = agentDirs[ai];
      if (agentId === 'main') continue;
      var sessionsDir = path.join(agentsDir, agentId, 'sessions');
      if (!fs.existsSync(sessionsDir)) continue;
      var files = fs.readdirSync(sessionsDir).filter(function (f) { return f.endsWith('.jsonl') && f.indexOf('trajectory') < 0; });
      if (files.length === 0) continue;
      files.sort(function (a, b) {
        var ta = 0, tb = 0;
        try { ta = fs.statSync(path.join(sessionsDir, a)).mtimeMs; } catch (e) {}
        try { tb = fs.statSync(path.join(sessionsDir, b)).mtimeMs; } catch (e) {}
        return tb - ta;
      });
      var fp = path.join(sessionsDir, files[0]);
      try {
        var stat = fs.statSync(fp);
        if (Date.now() - stat.mtimeMs > SUBAGENT_PROGRESS_MAX_AGE_MS) continue;
      } catch (e) { continue; }
      var raw = fs.readFileSync(fp, 'utf8');
      var lines = raw.split('\n').filter(function (l) { return l.trim(); });
      var lastTool = '';
      for (var k = lines.length - 1; k >= 0; k--) {
        try {
          var item = JSON.parse(lines[k]);
          if (item.type === 'message' && item.message && item.message.content) {
            var content = item.message.content;
            if (Array.isArray(content)) {
              for (var c = content.length - 1; c >= 0; c--) {
                if (content[c] && content[c].type === 'toolCall' && content[c].name) {
                  lastTool = content[c].name;
                  break;
                }
              }
            }
            if (lastTool) break;
          }
        } catch (e) { _logError('progressParseLine', e); }
      }
      if (lastTool) {
        progress[agentId] = { toolName: lastTool };
      }
    }
  } catch (e) { _logError('readProgress', e); }
  return progress;
}

module.exports = {
  init: init,
  onSubagentGatewayEvent: onSubagentGatewayEvent,
  startSync: startSync,
  stopSync: stopSync,
  readGatewayAssistantMessages: readGatewayAssistantMessages,
  countGatewayAssistantMessages: countGatewayAssistantMessages,
};
