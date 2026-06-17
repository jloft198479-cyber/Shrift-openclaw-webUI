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
const store = require('./fs-store');
const debugTrace = require('./debug-trace');

let _broadcastSSE = null;
let _fileOffsets = {};
let _retryTimer = null;
let _retryCount = 0;
let _pendingReads = new Map(); // key: sessionKey, value: frontendSessionId（按 key 去重入队）
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

/**
 * 从 sessionKey 中提取 agent ID
 * 格式: agent:<agentId>:subagent:<subAgentId>:webui:<sessionId>
 * 或: agent:<agentId>:webui:<sessionId>
 * 返回第一个非 main 的 agentId（优先子 agent）
 */
function _extractAgentIdFromKey(sessionKey) {
  if (!sessionKey) return '';
  const parts = sessionKey.split(':');
  if (parts.length < 2 || parts[0] !== 'agent' || !parts[1]) return '';
  // 所有格式统一从 parts[1] 取 agent ID（ppt, agent-mpr5t5r2vi0e 等）
  // agent:<agentId>:webui:<sessionId>
  // agent:<agentId>:subagent:<uuid>  (JSONL 子 Agent 消息)
  // agent:<agentId>:subagent:<uuid>:webui:<sessionId>
  return parts[1] !== 'main' ? parts[1] : '';
}

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
    // 只处理主 Agent 事件（sessionKey 不含 :subagent:），广播主 Agent 的合成消息
    // 子 Agent 的结果通过 OpenClaw 内部 sessions_spawn 机制传给主 Agent，
    // 主 Agent 综合后产出的新消息才是该广播给用户的内容。
    // 子 Agent 的中间消息（英文思考过程等）不应出现在 UI 中。
    if (sessionKey && sessionKey.indexOf(':subagent:') < 0) {
      if (eventName === 'sessions.changed' || eventName === 'session.created'
          || eventName === 'session.updated' || eventName === 'session.tool'
          || eventName === 'agent') {
        _scheduleRead(sessionKey, frontendSessionId);
      }
    }
  } catch (e) { _logError('gatewayEvent', e); }
}

function _scheduleRead(sessionKey, frontendSessionId) {
  // 按 sessionKey 去重入队（同 key 更新 frontendSessionId）
  _pendingReads.set(sessionKey, frontendSessionId);
  if (_retryTimer) return; // 已有定时器在跑，入队后等它处理
  _retryTimer = setTimeout(function () {
    _retryTimer = null;
    _processQueue(); // _processQueue 内会重置 _retryCount
  }, INITIAL_DELAY_MS);
}

function _processQueue() {
  if (_pendingReads.size === 0) return;
  _retryCount = 0; // 每个 sessionKey 重置 retry 计数
  const entry = _pendingReads.entries().next();
  const sessionKey = entry.value[0];
  const frontendSessionId = entry.value[1];
  _pendingReads.delete(sessionKey);
  _doRead(sessionKey, frontendSessionId);
}

function _doRead(sessionKey, frontendSessionId) {
  const targetFile = _findTargetFile(sessionKey);
  if (!targetFile) { _processQueue(); return; }

  if (!(targetFile in _fileOffsets)) {
    try {
      _fileOffsets[targetFile] = fs.statSync(targetFile).size;
    } catch (e) { _fileOffsets[targetFile] = 0; }
    _processQueue();
    return;
  }

  let newMessages = [];
  let readOffset = 0;
  let statSize = 0;
  try {
    const stat = fs.statSync(targetFile);
    statSize = stat.size;
    let currentOffset = _fileOffsets[targetFile] || 0;
    readOffset = currentOffset; // 记录本次读取的起始偏移量，用于前端去重
    // 文件被截断/替换时，重置偏移量从头读取
    if (currentOffset > 0 && stat.size < currentOffset) {
      console.log('[Sync] fileTruncated: ' + targetFile + ' was ' + currentOffset + ' now ' + stat.size + ', resetting offset');
      _fileOffsets[targetFile] = 0;
      currentOffset = 0;
      readOffset = 0;
    }
    if (stat.size <= (readOffset || 0)) {
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
    // 不立即推进 offset，等 broadcast 成功后再推进（P0-6：无客户端时不推进，等重连重读）
    newMessages = _parseAssistantMessages(buf.toString('utf8')).messages;
  } catch (e) { _logError('read', e); _processQueue(); return; }

  if (newMessages.length > 0) {
    // 从消息中提取 agentId（每条消息自带，不再依赖全局变量）
    let broadcastAgentId = '';
    for (let mi = newMessages.length - 1; mi >= 0; mi--) {
      if (newMessages[mi].agentId) {
        broadcastAgentId = newMessages[mi].agentId;
        break;
      }
    }
    // main session 的 announce 不应带子 agent 标签
    if (sessionKey && sessionKey.indexOf('agent:main:') === 0) {
      broadcastAgentId = '';
    }
    debugTrace.trace('announce-result-broadcast', { agentId: broadcastAgentId, sessionId: frontendSessionId, msgCount: newMessages.length, lastMsgPreview: (newMessages[newMessages.length - 1].content || '').substring(0, 100) });
    let delivered = false;
    if (_broadcastSSE) {
      delivered = _broadcastSSE({ type: 'announce-result', messages: newMessages, agentId: broadcastAgentId, sessionId: frontendSessionId, offset: readOffset });
    }
    if (delivered) {
      _fileOffsets[targetFile] = statSize; // broadcast 成功，推进 offset
    }
    // 无论是否 delivered，都继续处理队列（delivered=false 时 offset 不推进，等重连重读，前端靠 _announcedOffsets 去重）
    _processQueue();
  } else {
    // 没有新 assistant 消息，推进 offset（跳过非 assistant 内容），避免反复读取
    _fileOffsets[targetFile] = statSize;
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
  } else {
    // retry 超限，继续处理队列中的其他 sessionKey
    _processQueue(); // _processQueue 内会重置 _retryCount
  }
}

function stopSync() {
  if (_retryTimer) {
    clearTimeout(_retryTimer);
    _retryTimer = null;
  }
  _pendingReads.clear();
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

function _resolveStateDir() {
  if (process.env.OPENCLAW_STATE_DIR) return process.env.OPENCLAW_STATE_DIR;
  return store.getDataDir ? store.getDataDir() : '';
}

function _findTargetFile(sessionKey) {
  try {
    const stateDir = _resolveStateDir();
    if (!stateDir) return null;

    // 从 sessionKey 第二段提取 agentId，定位正确的 agent sessions 目录
    // agent:main:webui:xxx → main → agents/main/sessions
    // agent:ppt:subagent:xxx → ppt → agents/ppt/sessions
    let sessionsDir;
    if (sessionKey) {
      const parts = sessionKey.split(':');
      const agentId = (parts.length >= 2 && parts[1]) ? parts[1] : 'main';
      sessionsDir = path.join(stateDir, 'agents', agentId, 'sessions');
    } else {
      // startSync 空 sessionKey 走主目录
      sessionsDir = path.join(stateDir, MAIN_AGENT_SESSIONS_SUBDIR);
    }

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

    // 同目录内 fallback：取最近修改的非心跳文件
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
          // 从 JSONL 行的 sessionKey 中提取 agentId，每条消息自带正确的归属
          const agentId = _extractAgentIdFromKey(item.sessionKey || '');
          result.messages.push({ role: 'assistant', content: text, agentId: agentId });
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
