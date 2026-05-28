const fs = require('fs');
const path = require('path');

var _broadcastSSE = null;
var _syncLoopTimer = null;
var _syncLastCount = 0;
var _syncIdleRounds = 0;
var _syncFilePath = '';
var _syncFileOffset = 0;
var _syncParsedCount = 0;
var _syncSpawnedCallIds = {};
var SYNC_INTERVAL_MS = 5000;
var SYNC_MAX_IDLE_ROUNDS = 24;
var MAIN_AGENT_SESSIONS_SUBDIR = path.join('agents', 'main', 'sessions');
var SUBAGENT_PROGRESS_MAX_AGE_MS = 300000;

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
    var payload = inner.payload || inner.params || inner;
    var phase = payload.phase || payload.reason || '';
    console.log('[Sync] Gateway event:', eventName, 'phase:', phase, 'payload keys:', Object.keys(payload).join(','));
    if (eventName === 'session.tool') {
      var toolData = payload.data || {};
      if (toolData.name === 'sessions_spawn' && (toolData.phase === 'start' || toolData.phase === 'result')) {
        var agentId = '';
        var task = '';
        if (toolData.result && toolData.result.details) {
          var details = toolData.result.details;
          var csk = details.childSessionKey || '';
          var cskParts = csk.split(':');
          if (cskParts.length >= 2 && cskParts[0] === 'agent') agentId = cskParts[1];
        }
        if (!agentId && toolData.meta) {
          var metaMatch = toolData.meta.match(/agent\s+(\S+)/);
          if (metaMatch) agentId = metaMatch[1];
        }
        if (toolData.meta) {
          var taskMatch = toolData.meta.match(/task\s+(.+?)(?:,\s*agent|$)/);
          if (taskMatch) task = taskMatch[1].slice(0, 80);
        }
        if (agentId && agentId !== 'main') {
          var spawnKey3 = 'tool:' + (toolData.toolCallId || agentId);
          if (!_syncSpawnedCallIds[spawnKey3]) {
            _syncSpawnedCallIds[spawnKey3] = true;
            if (_broadcastSSE) {
              _broadcastSSE({ type: 'subagent-spawned', agentId: agentId, task: task, callId: toolData.toolCallId || '' });
              console.log('[Sync] Tool spawn event: agentId=' + agentId + ' callId=' + (toolData.toolCallId || ''));
            }
          }
        }
        if (!_syncLoopTimer) startSync();
      }
    }
    if (eventName === 'sessions.changed' || eventName === 'session.created' || eventName === 'session.updated') {
      var sess = payload.session || {};
      var childSessions = sess.childSessions || [];
      if (childSessions.length > 0) {
        for (var ci = 0; ci < childSessions.length; ci++) {
          var csk = childSessions[ci];
          var cskParts = csk.split(':');
          if (cskParts.length >= 2 && cskParts[0] === 'agent') {
            var cAgentId = cskParts[1];
            if (cAgentId && cAgentId !== 'main') {
              var cSpawnKey = 'cs:' + csk;
              if (!_syncSpawnedCallIds[cSpawnKey]) {
                _syncSpawnedCallIds[cSpawnKey] = true;
                if (_broadcastSSE) {
                  _broadcastSSE({ type: 'subagent-spawned', agentId: cAgentId, childSessionKey: csk });
                  console.log('[Sync] ChildSession spawn: agentId=' + cAgentId + ' key=' + csk);
                }
              }
            }
          }
        }
      }
      if (phase === 'create' || phase === 'created' || phase === 'spawn') {
        var agentId = payload.agentId || payload.agent_id || '';
        if (!agentId && sess && sess.key) {
          var sk = sess.key || sess.id || '';
          var skParts = sk.split(':');
          if (skParts.length >= 2 && skParts[0] === 'agent') agentId = skParts[1];
        }
        if (agentId && agentId !== 'main') {
          if (_broadcastSSE) {
            var spawnKey2 = 'gw:' + agentId;
            if (!_syncSpawnedCallIds[spawnKey2]) {
              _syncSpawnedCallIds[spawnKey2] = true;
              _broadcastSSE({ type: 'subagent-spawned', agentId: agentId });
              console.log('[Sync] Gateway spawn event: agentId=' + agentId);
            }
          }
        }
      }
      if (!_syncLoopTimer) {
        startSync();
      } else if (_syncFilePath) {
        try {
          var stat = fs.statSync(_syncFilePath);
          _scanLookbackForSpawns(_syncFilePath, stat.size);
        } catch (e) {}
      }
    }
  } catch (e) { _logError('gatewayEvent', e); }
}

var SYNC_LOOKBACK_BYTES = 16384;

function _scanLookbackForSpawns(filePath, fileSize) {
  if (fileSize <= 0 || !_broadcastSSE) return;
  var start = Math.max(0, fileSize - SYNC_LOOKBACK_BYTES);
  var readSize = fileSize - start;
  try {
    var fd = fs.openSync(filePath, 'r');
    try {
      var buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, start);
    } finally {
      fs.closeSync(fd);
    }
    var chunk = buf.toString('utf8');
    var parsed = _parseAssistantMessages(chunk);
    if (parsed.spawns.length > 0) {
      for (var si = 0; si < parsed.spawns.length; si++) {
        var sp = parsed.spawns[si];
        var spawnKey = sp.callId || (sp.agentId + ':' + sp.task.slice(0, 40));
        if (!_syncSpawnedCallIds[spawnKey]) {
          _syncSpawnedCallIds[spawnKey] = true;
          _broadcastSSE({ type: 'subagent-spawned', agentId: sp.agentId, task: sp.task, callId: sp.callId });
          console.log('[Sync] Lookback spawn: agentId=' + sp.agentId + ' callId=' + sp.callId);
        }
      }
    }
  } catch (e) { _logError('lookbackScan', e); }
}

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
    console.log('[Sync] doSync: offset=' + (_syncFileOffset - readSize) + ' readSize=' + readSize + ' msgs=' + parsed.messages.length + ' spawns=' + parsed.spawns.length);
    if (parsed.spawns.length > 0 && _broadcastSSE) {
      for (var si = 0; si < parsed.spawns.length; si++) {
        var sp = parsed.spawns[si];
        var spawnKey = sp.callId || (sp.agentId + ':' + sp.task.slice(0, 40));
        if (!_syncSpawnedCallIds[spawnKey]) {
          _syncSpawnedCallIds[spawnKey] = true;
          _broadcastSSE({ type: 'subagent-spawned', agentId: sp.agentId, task: sp.task, callId: sp.callId });
          console.log('[Sync] Spawn detected: agentId=' + sp.agentId + ' callId=' + sp.callId);
        }
      }
    }
  } catch (e) { _logError('incrementalRead', e); }
  _syncParsedCount += newMessages.length;
  var progress = _readSubagentProgress();
  var hasProgress = progress && Object.keys(progress).length > 0;
  if (newMessages.length === 0) {
    if (hasProgress) {
      _syncIdleRounds = 0;
      if (_broadcastSSE) {
        _broadcastSSE({ type: 'subagent-progress', progress: progress });
      }
    }
    return;
  }
  _syncIdleRounds = 0;
  if (_broadcastSSE) {
    _broadcastSSE({ type: 'chat-sync', messages: newMessages, total: _syncParsedCount, progress: progress });
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
    _syncSpawnedCallIds = {};
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
  var result = { messages: [], spawns: [] };
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
            if (content[c] && content[c].type === 'toolCall' && content[c].name === 'sessions_spawn') {
              var spawnRaw = content[c].arguments || content[c].input || '{}';
              var spawnArgs = {};
              try { if (typeof spawnRaw === 'string') { spawnArgs = JSON.parse(spawnRaw); } else if (typeof spawnRaw === 'object') { spawnArgs = spawnRaw; } } catch (e) {}
              result.spawns.push({
                agentId: spawnArgs.agentId || '',
                task: spawnArgs.task || '',
                callId: content[c].id || ''
              });
            }
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
