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
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        this._evictOldSessions();
        try {
          localStorage.setItem('openclaw_session_' + session.id, JSON.stringify(session));
        } catch (e2) {}
      }
    }
  },

  _evictOldSessions: function () {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.indexOf('openclaw_session_') === 0) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          keys.push({ key: key, updatedAt: data.updated_at || data.updatedAt || 0 });
        } catch (e) {
          keys.push({ key: key, updatedAt: 0 });
        }
      }
    }
    keys.sort(function (a, b) { return a.updatedAt - b.updatedAt; });
    const toRemove = Math.max(1, Math.floor(keys.length / 4));
    for (let j = 0; j < toRemove && j < keys.length; j++) {
      localStorage.removeItem(keys[j].key);
    }
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
    const self = this;
    fetch('/api/sessions/' + id, { method: 'DELETE' })
      .then(function () { self._refreshList(); })
      .catch(function (e) {
        console.warn('[SessionStore] Server delete failed:', e.message);
        self._refreshList();
      });
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

  _beforeSwitch: function () {
    // 会话切换前的统一清理：停止 agent run + 停止流式 + 清除调度状态 + 隐藏加载指示
    // 停止 Gateway 上的 agent run（无活跃 run 时无副作用）
    if (typeof Api !== 'undefined' && Api._currentSessionKey) {
      Api.stopAgent(Api._currentSessionKey);
      Api._currentSessionKey = '';
    }
    StreamRenderer.endStreaming();
    if (typeof ChatController !== 'undefined' && ChatController._clearDispatchState) {
      ChatController._clearDispatchState();
    }
    document.getElementById('thinking-indicator').style.display = 'none';
  },

  createSession: function () {
    SessionManager.closeSidebar();
    localStorage.removeItem('lastSessionId');
    SessionManager._beforeSwitch();
    State.setState({ currentSessionId: null, currentAgent: '', interactionMode: 'dispatch', messages: [] });
    ChatView.clearMessages();
    ChatView.showWelcome();
    document.getElementById('input')?.focus();
  },

  exitAgentMode: function () {
    SessionManager._beforeSwitch();
    State.setState({ currentAgent: '', interactionMode: 'dispatch' });
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
      SessionManager._beforeSwitch();
      localStorage.removeItem('lastSessionId');
      ChatView.showWelcome();
      return;
    }

    SessionManager._beforeSwitch();
    State.setState({ currentSessionId: session.id, currentAgent: '', interactionMode: 'dispatch' });

    ChatView.clearMessages();
    ChatView.hideWelcome();

    // 长会话只渲染最近 MAX_VISIBLE 条，避免大量 DOM 节点
    const messages = session.messages || [];
    const MAX_VISIBLE = 200;
    const startIdx = Math.max(0, messages.length - MAX_VISIBLE);
    if (startIdx > 0) {
      const placeholder = document.createElement('div');
      placeholder.className = 'message history-placeholder';
      placeholder.textContent = '... 还有 ' + startIdx + ' 条更早的消息';
      ChatView.appendMessage('system', '', false, '', '');
      const inner = document.querySelector('.messages-inner');
      const lastMsg = inner && inner.lastElementChild;
      if (lastMsg) {
        lastMsg.className = 'message history-placeholder';
        lastMsg.innerHTML = '<div class="bubble" style="text-align:center;color:var(--muted);font-size:12px;background:transparent;border:none;box-shadow:none">... 早期消息（' + startIdx + ' 条）</div>';
        lastMsg.dataset.placeholder = 'true';
      }
    }
    for (let i = startIdx; i < messages.length; i++) {
      const msg = messages[i];
      let msgAgentId = '';
      if (msg.role === 'assistant') {
        msgAgentId = msg.agentId || session.agent || '';
      }
      try {
        ChatView.appendMessage(msg.role, msg.content || '', false, msg.thinking || '', msgAgentId);
        if (msg.announces && msg.announces.length > 0) {
          for (let k = 0; k < msg.announces.length; k++) {
            MessageRenderer.appendToLastAssistantMessage(msg.announces[k].content, msg.announces[k].agentId || '');
          }
        }
      } catch (e) {
        console.error('[SessionManager] Failed to render history message:', e);
      }
    }

    scrollToBottom(document.getElementById('messages'), false);
    const sb = document.getElementById('scroll-bottom'); if (sb) sb.style.display = 'none';
    document.getElementById('input')?.focus();

    // per-session workspace：切换会话时自动切到该会话绑定的目录
    SessionManager._syncWorkspace(session);
  },

  /**
   * 同步当前会话绑定的 workspace 到全局
   * - session.workspace 非空 → 切到该目录
   * - session.workspace 为空 → 清除（回到默认）
   * - 与当前全局一致 → 不操作
   * 复用现有 Api.setWorkspace / clearWorkspace 链路
   */
  _syncWorkspace: function (session) {
    if (!session) return;
    var targetWs = session.workspace || '';
    var currentWs = (State.workspace && State.workspace.path) || '';
    // 归一化比较（斜杠统一 + 去尾斜杠 + 小写）
    var norm = function (p) { return (p || '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase(); };
    if (norm(targetWs) === norm(currentWs)) return;

    if (targetWs) {
      Api.setWorkspace(targetWs).then(function (result) {
        if (result && result.success) {
          State.setState({ workspace: { path: result.path, exists: true } });
        }
      }).catch(function (err) {
        console.warn('[Session] Failed to sync workspace:', err.message);
      });
    } else {
      Api.clearWorkspace().then(function (result) {
        if (result && result.success) {
          State.setState({ workspace: { path: '', exists: false } });
        }
      }).catch(function (err) {
        console.warn('[Session] Failed to clear workspace:', err.message);
      });
    }
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
        who = '**' + (agent ? (agent.displayName || agent.name) : msg.agentId) + '**';
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
    return SessionStore.fetchFromServer().then(function (list) {
      State.setState({ sessions: list });
    }).catch(function (e) {
      console.error('[SessionManager] loadSessions failed:', e);
      State.setState({ sessions: SessionStore.getList() });
    });
  },
};

function closeSidebar() { SessionManager.closeSidebar(); }
function createSession() { SessionManager.createSession(); }
function exitAgentMode() { SessionManager.exitAgentMode(); }
function selectSession(id) { SessionManager.selectSession(id); }
function deleteSession(id, e) { SessionManager.deleteSession(id, e); }
function renameSession(id, name) { SessionManager.renameSession(id, name); }
function exportSession(sid) { SessionManager.exportSession(sid); }
function loadSessions() { SessionManager.loadSessions(); }
