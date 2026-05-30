/**
 * debug-trace.js — 后端调试追踪模块
 *
 * 职责：
 *   1. 记录后端关键事件到日志文件
 *   2. 接收前端日志并写入同一文件
 *   3. 提供日志读取接口
 *
 * 用法：
 *   const debugTrace = require('./debug-trace');
 *   debugTrace.trace('gateway-event', { event: 'session.tool', sessionKey: '...' });
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'debug-events.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

function _timestamp() {
  return new Date().toISOString();
}

function _writeLine(line) {
  try {
    var stat;
    try { stat = fs.statSync(LOG_FILE); } catch (e) { stat = null; }
    if (stat && stat.size > MAX_LOG_SIZE) {
      var content = fs.readFileSync(LOG_FILE, 'utf8');
      var lines = content.split('\n');
      var keep = lines.slice(Math.floor(lines.length / 2));
      fs.writeFileSync(LOG_FILE, keep.join('\n'), 'utf8');
    }
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (e) {
    console.error('[DebugTrace] write error:', e.message);
  }
}

function trace(type, data) {
  var entry = {
    ts: _timestamp(),
    src: 'backend',
    type: type,
    data: data
  };
  _writeLine(JSON.stringify(entry));
}

function traceFrontend(type, data) {
  var entry = {
    ts: _timestamp(),
    src: 'frontend',
    type: type,
    data: data
  };
  _writeLine(JSON.stringify(entry));
}

function getLogs() {
  try {
    if (!fs.existsSync(LOG_FILE)) return '';
    return fs.readFileSync(LOG_FILE, 'utf8');
  } catch (e) {
    return '';
  }
}

function clearLogs() {
  try {
    if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
  } catch (e) {}
}

function handlePostLog(req, res, collectBody) {
  collectBody(req, function (body) {
    if (body && body.type) {
      traceFrontend(body.type, body.data || {});
    }
    res.writeHead(204);
    res.end();
  });
}

function handleGetLogs(req, res) {
  var logs = getLogs();
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache'
  });
  res.end(logs);
}

function handleClearLogs(req, res) {
  clearLogs();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

module.exports = {
  trace: trace,
  traceFrontend: traceFrontend,
  getLogs: getLogs,
  clearLogs: clearLogs,
  handlePostLog: handlePostLog,
  handleGetLogs: handleGetLogs,
  handleClearLogs: handleClearLogs,
};
