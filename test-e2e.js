var http = require('http');

var sseData = [];

var req = http.request({
  hostname: 'localhost',
  port: 3001,
  path: '/api/events',
  method: 'GET',
  headers: { 'Accept': 'text/event-stream' }
}, function (res) {
  var buf = '';
  res.on('data', function (chunk) {
    buf += chunk.toString();
    var parts = buf.split('\n\n');
    buf = parts.pop();
    for (var i = 0; i < parts.length; i++) {
      var eventBlock = parts[i].trim();
      var lines = eventBlock.split('\n');
      var eventType = '';
      var eventData = '';
      for (var j = 0; j < lines.length; j++) {
        if (lines[j].indexOf('event:') === 0) eventType = lines[j].slice(6).trim();
        if (lines[j].indexOf('data:') === 0) eventData = lines[j].slice(5).trim();
      }
      if (!eventType || !eventData) continue;
      try {
        var data = JSON.parse(eventData);
        if (eventType === 'gateway') {
          var inner = data.data || data;
          var eventName = inner.event || '';
          var payload = inner.payload || {};
          if (eventName === 'chat') {
            var sk = payload.sessionKey || '';
            var state = payload.state || '';
            if (sk.indexOf(':subagent:') >= 0) {
              console.log('[E2E] SUB-CHAT:', sk.slice(0, 50), 'state=' + state);
              sseData.push({ type: 'sub-chat', sessionKey: sk, state: state });
            }
          }
          if (eventName === 'sessions.changed') {
            var reason = payload.reason || '';
            var status = payload.status || '';
            console.log('[E2E] SESS-CHG: key=' + (payload.sessionKey || '').slice(0, 40) + ' reason=' + reason + ' status=' + status);
            sseData.push({ type: 'sess-chg', reason: reason, status: status, sessionKey: payload.sessionKey });
          }
        }
        if (eventType === 'subagent-progress') {
          console.log('[E2E] PROGRESS:', JSON.stringify(data.progress || {}).slice(0, 200));
          sseData.push({ type: 'progress', progress: data.progress });
        }
        if (eventType === 'chat-sync') {
          var msgCount = data.messages ? data.messages.length : 0;
          console.log('[E2E] CHAT-SYNC: msgs=' + msgCount + ' hasProgress=' + !!data.progress);
          sseData.push({ type: 'chat-sync', msgCount: msgCount, hasProgress: !!data.progress });
        }
      } catch (e) {}
    }
  });
  res.on('end', function () { console.log('SSE closed'); });
});

req.on('error', function (e) { console.error('SSE error:', e.message); });
req.end();

setTimeout(function () {
  console.log('\n--- Sending chat message ---');
  var body = JSON.stringify({
    model: 'openclaw:main',
    messages: [{ role: 'user', content: '请让小李子搜索一下最新AI编程工具排名' }],
    stream: false
  });
  var chatReq = http.request({
    hostname: 'localhost',
    port: 3001,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-openclaw-session-key': 'agent:main:webui'
    }
  }, function (res) {
    var data = '';
    res.on('data', function (c) { data += c; });
    res.on('end', function () {
      console.log('[E2E] Chat response status:', res.statusCode);
    });
  });
  chatReq.on('error', function (e) { console.error('Chat error:', e.message); });
  chatReq.end(body);
}, 3000);

setTimeout(function () {
  console.log('\n--- Final Results ---');
  console.log('Total SSE events:', sseData.length);
  var subChats = sseData.filter(function (d) { return d.type === 'sub-chat'; });
  var progs = sseData.filter(function (d) { return d.type === 'progress'; });
  var syncs = sseData.filter(function (d) { return d.type === 'chat-sync'; });
  var sessChgs = sseData.filter(function (d) { return d.type === 'sess-chg'; });
  console.log('Sub-agent chat events:', subChats.length);
  console.log('Progress events:', progs.length);
  console.log('Chat-sync events:', syncs.length);
  console.log('Session-changed events:', sessChgs.length);
  if (subChats.length > 0) {
    console.log('First sub-chat sessionKey:', subChats[0].sessionKey.slice(0, 60));
    console.log('Has final state:', subChats.some(function (d) { return d.state === 'final'; }));
  }
  if (progs.length > 0) {
    console.log('Progress sample:', JSON.stringify(progs[0].progress).slice(0, 200));
  }
  req.destroy();
  process.exit(0);
}, 90000);
