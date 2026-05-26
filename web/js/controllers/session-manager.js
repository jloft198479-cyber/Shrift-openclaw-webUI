const SessionStore = {
  _LIST_KEY: 'openclaw_session_list',
  _cache: {},

  getList: function () {
    try {
      const data = localStorage.getItem(this._LIST_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  _setLocalList: function (list) {
    try {
      localStorage.setItem(this._LIST_KEY, JSON.stringify(list));
    } catch (e) {}
  },

  get: function (id) {
    if (!id) return null;
    if (this._cache[id]) return this._cache[id];
    try {
      const data = localStorage.getItem('openclaw_session_' + id);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  },

  _setLocalCache: function (session) {
    if (!session || !session.id) return;
    this._cache[session.id] = session;
    try {
      localStorage.setItem('openclaw_session_' + session.id, JSON.stringify(session));
    } catch (e) {}
  },

  _removeLocalCache: function (id) {
    if (!id) return;
    delete this._cache[id];
    try { localStorage.removeItem('openclaw_session_' + id); } catch (e) {}
  },

  save: function (session) {
    if (!session || !session.id) return;
    this._setLocalCache(session);
    fetch('/api/sessions/' + session.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    }).catch(function (e) {
      console.warn('[SessionStore] Server save failed:', e.message);
    });
    this._refreshList();
  },

  remove: function (id) {
    if (!id) return;
    this._removeLocalCache(id);
    fetch('/api/sessions/' + id, { method: 'DELETE' }).catch(function (e) {
      console.warn('[SessionStore] Server delete failed:', e.message);
    });
    this._refreshList();
  },

  rename: function (id, name) {
    const session = this.get(id);
    if (!session) return;
    session.name = name;
    session.updated_at = Date.now();
    this.save(session);
  },

  _refreshList: function () {
    const self = this;
    fetch('/api/sessions')
      .then(function (r) { return r.json(); })
      .then(function (list) {
        self._setLocalList(list);
        State.setState({ sessions: list });
      })
      .catch(function () {});
  },

  fetchFromServer: function () {
    const self = this;
    return fetch('/api/sessions')
      .then(function (r) { return r.json(); })
      .then(function (list) {
        self._setLocalList(list);
        return list;
      })
      .catch(function () {
        return self.getList();
      });
  },

  fetchSession: function (id) {
    const self = this;
    return fetch('/api/sessions/' + id)
      .then(function (r) {
        if (!r.ok) return null;
        return r.json();
      })
      .then(function (session) {
        if (session) self._setLocalCache(session);
        return session;
      })
      .catch(function () {
        return self.get(id);
      });
  },
};

const SessionManager = {

  closeSidebar: function () {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('open');
  },

  createSession: function () {
    SessionManager.closeSidebar();
    localStorage.removeItem('lastSessionId');
    localStorage.removeItem('lastAgentName');
    StreamRenderer.endStreaming();
    State.setState({ currentSessionId: null, currentAgent: '', messages: [] });
    ChatView.clearMessages();
    ChatView.showWelcome();
    document.getElementById('thinking-indicator').style.display = 'none';
    document.getElementById('input')?.focus();
  },

  selectAgent: function (agentId) {
    SessionManager.closeSidebar();
    localStorage.removeItem('lastSessionId');
    StreamRenderer.endStreaming();
    State.setState({ currentSessionId: null, currentAgent: agentId, messages: [] });
    ChatView.clearMessages();

    const agent = State.findAgent(agentId);
    ChatView.showWelcome({ agent: agent });

    document.getElementById('messages').style.display = 'none';
    document.getElementById('thinking-indicator').style.display = 'none';
    document.getElementById('input')?.focus();
  },

  exitAgentMode: function () {
    State.setState({ currentAgent: '' });
    const sessions = State.sessions || [];
    if (sessions.length > 0 && sessions[0] && sessions[0].id) {
      SessionManager.selectSession(sessions[0].id);
    } else {
      ChatView.showWelcome();
    }
  },

  selectSession: function (id) {
    try { localStorage.setItem('lastSessionId', id); } catch (e) {}

    const localSession = SessionStore.get(id);
    SessionManager._renderSession(localSession);

    SessionStore.fetchSession(id).then(function (serverSession) {
      if (serverSession && State.currentSessionId === id) {
        SessionManager._renderSession(serverSession);
      }
    });
  },

  _renderSession: function (session) {
    if (!session) {
      localStorage.removeItem('lastSessionId');
      ChatView.showWelcome();
      return;
    }

    StreamRenderer.endStreaming();
    State.setState({ currentSessionId: session.id, currentAgent: (session && session.agent) || '' });
    document.getElementById('thinking-indicator').style.display = 'none';

    ChatView.clearMessages();
    ChatView.hideWelcome();

    const messages = session.messages || [];
    const sessionAgent = session.agent || '';
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      let msgAgentId = '';
      if (msg.role === 'assistant') {
        msgAgentId = msg.agentId || sessionAgent;
      }
      try {
        ChatView.appendMessage(msg.role, msg.content || '', false, msg.thinking || '', msgAgentId);
      } catch (e) {
        console.error('[SessionManager] Failed to render history message:', e);
      }
    }

    scrollToBottom(document.getElementById('messages'), false);
    const sb = document.getElementById('scroll-bottom'); if (sb) sb.style.display = 'none';
    document.getElementById('input')?.focus();
  },

  deleteSession: function (id, e) {
    if (e && e.stopPropagation) e.stopPropagation();

    SessionStore.remove(id);

    if (State.currentSessionId === id) {
      const sessions = SessionStore.getList();
      State.setState({ sessions: sessions });
      if (sessions.length > 0) {
        SessionManager.selectSession(sessions[0].id);
      } else {
        State.setState({ currentSessionId: null });
        ChatView.clearMessages();
        ChatView.showWelcome();
        document.getElementById('messages').style.display = 'none';
      }
    } else {
      State.setState({ sessions: SessionStore.getList() });
    }
  },

  renameSession: function (id, name) {
    SessionStore.rename(id, name);
    State.setState({ sessions: SessionStore.getList() });
  },

  exportSession: function (sid) {
    sid = sid || State.currentSessionId;
    if (!sid) return;

    const session = SessionStore.get(sid);
    if (!session) {
      showToast('导出失败：会话不存在');
      return;
    }

    const messages = session.messages || [];
    const lines = [
      '# ' + (session.name || '对话'),
      '',
      '> 导出时间：' + new Date().toLocaleString('zh-CN'),
      '',
      '---',
      '',
    ];
    messages.forEach(function (msg) {
      let who = msg.role === 'user' ? '**你**' : ('**' + APP_NAME + '**');
      if (msg.role === 'assistant' && msg.agentId) {
        const agent = State.findAgent(msg.agentId);
        who = '**' + (agent ? agent.name : msg.agentId) + '**';
      }
      lines.push('### ' + who, '', msg.content || '', '');
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (session.name || '对话').replace(/[\\/:*?"<>|]/g, '_') + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
  },

  loadSessions: function () {
    SessionStore.fetchFromServer().then(function (list) {
      State.setState({ sessions: list });
    }).catch(function (e) {
      console.error('[SessionManager] loadSessions failed:', e);
      State.setState({ sessions: SessionStore.getList() });
    });
  },
};

function closeSidebar() { SessionManager.closeSidebar(); }
function createSession() { SessionManager.createSession(); }
function selectAgent(agentId) { SessionManager.selectAgent(agentId); }
function exitAgentMode() { SessionManager.exitAgentMode(); }
function selectSession(id) { SessionManager.selectSession(id); }
function deleteSession(id, e) { SessionManager.deleteSession(id, e); }
function renameSession(id, name) { SessionManager.renameSession(id, name); }
function exportSession(sid) { SessionManager.exportSession(sid); }
function loadSessions() { SessionManager.loadSessions(); }
