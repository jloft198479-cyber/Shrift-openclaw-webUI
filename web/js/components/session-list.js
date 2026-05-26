const SessionList = {
  _cacheKey: '',
  _unsub: null,

  init: function () {
    this._unsub = [
      State.on('session-list', function () { SessionList.render(); }),
      State.on('session-switch', function () { SessionList.render(); }),
      State.on('filter', function () { SessionList.render(); })
    ];
    this.render();
  },

  _getAgentLabel: function (agentId) {
    if (!agentId) return '';
    const a = State.findAgent(agentId);
    if (!a) return agentId.slice(0,1);
    const av = a.avatar || '';
    if (av && typeof av === 'string' && av.indexOf('/') < 0 && av.indexOf('\\') < 0) {
      return av;
    }
    return (a.name || a.id).slice(0,1);
  },

  render: function () {
    const allSessions = State.sessions;
    const currentSessionId = State.currentSessionId;
    const filter = State.filter || '';
    const sessions = filter ? allSessions.filter(function (s) {
      if (filter === 'pending') return s.tag === 'pending';
      return true;
    }) : allSessions;
    const key = filter + '|' + currentSessionId + '|' + allSessions.map(function (s) {
      return s.id + ':' + s.name + ':' + (s.updated_at || '') + ':' + (s.tag || '');
    }).join(',');
    if (key === this._cacheKey) return;
    this._cacheKey = key;

    const list = document.getElementById('session-list');
    if (!list) return;

    if (sessions.length === 0) {
      list.innerHTML = '<div class="empty-state">' + (filter === 'pending' ? '暂无待办对话' : '暂无对话，开始新对话吧') + '</div>';
      return;
    }

    list.innerHTML = sessions.map(function (s) {
      const tagHtml = s.tag === 'pending' ? '<span class="tag-icon">📋</span>' : '';
      return '<div class="session-item' + (s.id === currentSessionId ? ' active' : '') + '"'
        + ' data-id="' + escapeHtml(s.id) + '"'
        + (s.agent ? ' data-agent="' + escapeHtml(s.agent) + '"' : '') + '>'
        + '<div class="info">'
        + '<div class="name">' + tagHtml
        + (s.agent ? ('<span class="session-agent-badge" title="' + escapeHtml(s.agent) + ' 功手对话">' + escapeHtml(SessionList._getAgentLabel(s.agent)) + '</span>') : '')
        + escapeHtml(s.name || '新对话') + '</div>'
        + '<div class="meta">' + fmtDate(s.updated_at) + '</div>'
        + '</div>'
        + '<button class="menu-btn" data-menu="' + escapeHtml(s.id) + '" title="更多操作">⋯</button>'
        + '</div>';
    }).join('');
  },
};
