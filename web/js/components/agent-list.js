const AgentList = {
  _unsub: null,

  init: function () {
    this._unsub = [
      State.on('agent-list', function () { AgentList.render(); }),
      State.on('agent-switch', function () { AgentList.render(); })
    ];
    this.render();
  },

  _cacheKey: '',

  render: function () {
    const list = document.getElementById('agent-list');
    if (!list) return;

    const agents = State.agents;
    const currentAgent = State.currentAgent;
    const key = agents.map(function(a) { return a.id + ':' + (a.model||'') + ':' + (a.name||'') + ':' + (a.avatar||''); }).join('|') + '|' + currentAgent;
    if (key === this._cacheKey) return;
    this._cacheKey = key;
    const visibleAgents = agents.filter(function (a) { return a.id !== 'main' && !a.default; });
    if (!visibleAgents || visibleAgents.length === 0) {
      list.innerHTML = '<div class="empty-state">暂无助手</div>';
      return;
    }

    list.innerHTML = visibleAgents.map(function (a) {
      const iconHtml = renderAgentAvatar(a.avatar, a.displayName || a.name || a.id);
      const displayName = a.displayName || a.name || a.id;
      const desc = a.description ? '<span class="agent-meta">' + escapeHtml(a.description) + '</span>' : '';
      const isActive = a.id === State.currentAgent;
      return '<div class="agent-item' + (isActive ? ' active' : '') + '" data-agent="' + escapeHtml(a.id) + '">'
        + '<span class="agent-icon">' + iconHtml + '</span>'
        + '<div class="agent-info">'
        + '<span class="agent-name">' + escapeHtml(displayName) + '</span>'
        + desc
        + '</div>'
        + '<button class="agent-menu-btn" data-agent="' + escapeHtml(a.id) + '" title="操作">⋮</button>'
        + '</div>';
    }).join('');

    const countEl = document.getElementById('agent-section-count');
    if (countEl) countEl.textContent = visibleAgents.length;
  },

  destroy: function () {
    if (this._unsub) this._unsub.forEach(function (fn) { fn(); });
  },
};
