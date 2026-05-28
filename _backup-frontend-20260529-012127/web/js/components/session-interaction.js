/* ── session-interaction.js — 会话创建/查找（纯数据逻辑）──── */

var SessionInteraction = {

  ensureSession: function (text) {
    var isNewSession = !State.currentSessionId;
    var sessionId = State.currentSessionId;
    var session = null;

    if (isNewSession) {
      sessionId = uid();
      localStorage.setItem('lastSessionId', sessionId);
      var cleanName = text.replace(/\n/g, ' ').trim().slice(0, 40);
      if (!cleanName) {
        var now = new Date();
        cleanName = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2) + ' 对话';
      }
      var newSession = {
        id: sessionId,
        name: cleanName,
        agent: State.currentAgent || '',
        created_at: Date.now(),
        updated_at: Date.now(),
        messages: [],
      };
      SessionStore.save(newSession);
      State.setState({
        currentSessionId: sessionId,
        sessions: [newSession].concat(State.sessions),
        streaming: true,
      });
      session = newSession;
    } else {
      session = SessionStore.get(sessionId);
    }

    return { sessionId: sessionId, session: session };
  },

  saveUserMessage: function (session, displayText, attachmentPaths) {
    if (!session) return;
    var msgObj = { role: 'user', content: displayText };
    if (attachmentPaths && attachmentPaths.length > 0) {
      msgObj.attachments = attachmentPaths.map(function (a) {
        var att = { name: a.name, path: a.path, type: a.type };
        if (a.dataUrl && a.dataUrl.length < 512000) att.dataUrl = a.dataUrl;
        return att;
      });
    }
    session.messages.push(msgObj);
    SessionStore.save(session);
  },
};
