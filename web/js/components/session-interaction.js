/* ── session-interaction.js — 会话创建/查找（纯数据逻辑）──── */

const SessionInteraction = {

  ensureSession: function (text) {
    const isNewSession = !State.currentSessionId;
    let sessionId = State.currentSessionId;
    let session = null;

    if (isNewSession) {
      sessionId = uid();
      localStorage.setItem('lastSessionId', sessionId);
      let cleanName = text.replace(/\n/g, ' ').trim().slice(0, 40);
      if (!cleanName) {
        const now = new Date();
        cleanName = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2) + ' 对话';
      }
      const newSession = {
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
    const msgObj = { role: 'user', content: displayText };
    if (attachmentPaths && attachmentPaths.length > 0) {
      msgObj.attachments = attachmentPaths.map(function (a) {
        const att = { name: a.name, path: a.path, type: a.type };
        if (a.dataUrl && a.dataUrl.length < 512000) att.dataUrl = a.dataUrl;
        return att;
      });
    }
    session.messages.push(msgObj);
    SessionStore.save(session);
  },

  /**
   * 更新 session 中最后一条 assistant 消息的内容
   * 用于 dispatch 模式的 announce 结果合并——不 push 新消息，复用最后一条
   * @param {Object} session - session 对象
   * @param {string} content - 新内容
   */
  updateLastAssistantMessage: function (session, content) {
    if (!session || !session.messages || session.messages.length === 0) return;
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'assistant') {
        session.messages[i].content = content;
        return;
      }
    }
    // 没有 assistant 消息，追加
    session.messages.push({ role: 'assistant', content: content });
  },
};
