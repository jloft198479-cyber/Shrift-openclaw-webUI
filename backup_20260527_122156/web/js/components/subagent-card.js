var SubagentCard = {
  _cards: {},
  _pollTimers: {},
  _wsBridgeBound: false,

  create: function (spawnInfo) {
    var id = spawnInfo.childSessionKey || spawnInfo.runId;
    if (this._cards[id]) return this._cards[id];

    var agentName = spawnInfo.agentName || spawnInfo.agentId || id;
    var task = spawnInfo.task || '';
    var el = document.createElement('div');
    el.className = 'subagent-card';
    el.dataset.subagentId = id;
    el.innerHTML =
      '<div class="subagent-card-inner">' +
        '<span class="subagent-spinner"></span>' +
        '<span class="subagent-label">' + this._esc(agentName) + ' \u6B63\u5728\u6267\u884C' + (task ? '\uFF1A' + this._esc(task.slice(0, 60)) : '\u2026') + '</span>' +
        '<button class="subagent-stop-btn" title="\u505C\u6B62\u4EFB\u52A1">\u23F9 \u505C\u6B62</button>' +
      '</div>';

    var self = this;
    el.querySelector('.subagent-stop-btn').addEventListener('click', function () {
      self.stop(id);
    });

    var messagesEl = document.getElementById('messages');
    if (messagesEl) {
      messagesEl.appendChild(el);
      if (!State.userScrolledUp) {
        var container = document.getElementById('messages');
        container.scrollTop = container.scrollHeight;
      }
    }

    var isTempId = !spawnInfo.childSessionKey;
    var card = {
      el: el,
      id: id,
      startedAt: Date.now(),
      childSessionKey: spawnInfo.childSessionKey || '',
      agentId: spawnInfo.agentId || '',
      isTempId: isTempId,
      terminal: false
    };
    this._cards[id] = card;
    this._ensureWsBridge();
    this._startPolling(id);
    return card;
  },

  stop: function (id) {
    var card = this._cards[id];
    if (!card) return;
    var btn = card.el.querySelector('.subagent-stop-btn');
    if (btn) { btn.disabled = true; btn.textContent = '\u505C\u6B62\u4E2D\u2026'; }

    var childKey = card.childSessionKey;
    if (!childKey) {
      SubagentCard._markStopped(id, '\u65E0\u6CD5\u505C\u6B62');
      return;
    }
    Api.stopSubagent(childKey).then(function () {
      SubagentCard._markStopped(id, '\u5DF2\u505C\u6B62');
    }).catch(function (err) {
      SubagentCard._markStopped(id, '\u505C\u6B62\u5931\u8D25');
      console.error('[SubagentCard] Stop error:', err);
    });
  },

  updateChildSessionKey: function (cardId, realKey) {
    var card = this._cards[cardId];
    if (!card) return;
    if (card.childSessionKey && card.childSessionKey === realKey) return;
    card.childSessionKey = realKey;
    card.isTempId = false;
    this._cards[realKey] = card;
    delete this._cards[cardId];
    card.id = realKey;
    card.el.dataset.subagentId = realKey;
    var stopBtn = card.el.querySelector('.subagent-stop-btn');
    if (stopBtn) {
      var self = this;
      var newBtn = stopBtn.cloneNode(true);
      stopBtn.parentNode.replaceChild(newBtn, stopBtn);
      newBtn.addEventListener('click', function () {
        self.stop(realKey);
      });
    }
    if (this._pollTimers[cardId]) {
      clearInterval(this._pollTimers[cardId]);
      delete this._pollTimers[cardId];
      this._startPolling(realKey);
    }
    var list = State.activeSubagents || [];
    for (var i = 0; i < list.length; i++) {
      if ((list[i].childSessionKey || list[i].runId) === cardId) {
        list[i].childSessionKey = realKey;
        break;
      }
    }
    State.setState({ activeSubagents: list });
  },

  _ensureWsBridge: function () {
    if (this._wsBridgeBound) return;
    this._wsBridgeBound = true;
    var self = this;
    if (typeof WsBridge !== 'undefined') {
      WsBridge.on('sessions.changed', function (payload) {
        self._onSessionChanged(payload);
      });
    }
  },

  _onSessionChanged: function (payload) {
    if (!payload) return;
    var sessionKey = payload.sessionKey || '';
    var reason = payload.reason || '';

    if (reason === 'create') {
      var agentId = this._extractAgentId(sessionKey);
      if (!agentId) return;
      var matched = this._findCardByAgentId(agentId);
      if (matched && matched.isTempId) {
        this.updateChildSessionKey(matched.id, sessionKey);
      }
    }

    if (reason === 'ended' || reason === 'delete') {
      var card = this._cards[sessionKey];
      if (card) {
        this._markCompleted(sessionKey);
      }
    }
  },

  _extractAgentId: function (sessionKey) {
    if (!sessionKey) return '';
    var parts = sessionKey.split(':');
    if (parts.length >= 2 && parts[0] === 'agent') {
      return parts[1];
    }
    return '';
  },

  _findCardByAgentId: function (agentId) {
    var cards = this._cards;
    for (var id in cards) {
      if (cards[id].agentId === agentId && cards[id].isTempId) {
        return cards[id];
      }
    }
    return null;
  },

  _markStopped: function (id, label) {
    var card = this._cards[id];
    if (!card) return;
    card.terminal = true;
    this._stopPolling(id);
    var spinner = card.el.querySelector('.subagent-spinner');
    if (spinner) spinner.className = 'subagent-spinner stopped';
    var btn = card.el.querySelector('.subagent-stop-btn');
    if (btn) { btn.disabled = true; btn.textContent = label; }
    var labelEl = card.el.querySelector('.subagent-label');
    if (labelEl) {
      var agentName = labelEl.textContent.split(' ')[0] || '';
      labelEl.textContent = agentName + ' ' + label;
    }
    this._removeFromState(id);
  },

  _markCompleted: function (id) {
    var card = this._cards[id];
    if (!card || card.terminal) return;
    card.terminal = true;
    this._stopPolling(id);
    var spinner = card.el.querySelector('.subagent-spinner');
    if (spinner) spinner.className = 'subagent-spinner done';
    var btn = card.el.querySelector('.subagent-stop-btn');
    if (btn) { btn.disabled = true; btn.textContent = '\u5DF2\u5B8C\u6210'; }
    var labelEl = card.el.querySelector('.subagent-label');
    if (labelEl) {
      var agentName = labelEl.textContent.split(' ')[0] || '';
      labelEl.textContent = agentName + ' \u5DF2\u5B8C\u6210';
    }
    this._removeFromState(id);
  },

  _startPolling: function (id) {
    var self = this;
    this._pollTimers[id] = setInterval(function () {
      var card = self._cards[id];
      if (!card) { self._stopPolling(id); return; }
      var key = card.childSessionKey;
      if (!key) return;
      Api.getSubagentStatus(key).then(function (result) {
        if (!result || !result.sessions) return;
        for (var k in result.sessions) {
          if (result.sessions[k] && result.sessions[k].endedAt) {
            self._markCompleted(id);
            return;
          }
        }
      }).catch(function () {});
    }, 5000);
  },

  _stopPolling: function (id) {
    if (this._pollTimers[id]) {
      clearInterval(this._pollTimers[id]);
      delete this._pollTimers[id];
    }
  },

  _removeFromState: function (id) {
    var list = State.activeSubagents.filter(function (s) {
      return (s.childSessionKey || s.runId) !== id;
    });
    State.setState({ activeSubagents: list });
  },

  _esc: function (s) {
    var d = document.createElement('span');
    d.textContent = s;
    return d.innerHTML;
  },

  destroy: function () {
    var self = this;
    Object.keys(this._pollTimers).forEach(function (id) {
      self._stopPolling(id);
    });
    Object.keys(this._cards).forEach(function (id) {
      var el = self._cards[id].el;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    this._cards = {};
    this._wsBridgeBound = false;
  },
};
