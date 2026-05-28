var SubagentCard = {
  _cards: {},
  _pollTimers: {},
  _timerIntervals: {},
  _wsBridgeBound: false,

  create: function (spawnInfo) {
    var id = spawnInfo.childSessionKey || spawnInfo.runId || ('sub-' + Date.now());
    if (this._cards[id]) return this._cards[id];

    var agentName = spawnInfo.agentName || '';
    if (!agentName && spawnInfo.agentId && typeof State !== 'undefined' && State.agents) {
      for (var i = 0; i < State.agents.length; i++) {
        if (State.agents[i].id === spawnInfo.agentId) { agentName = State.agents[i].name || State.agents[i].id; break; }
      }
    }
    if (!agentName) agentName = spawnInfo.agentId || id;
    var task = spawnInfo.task || '';
    var anchorEl = spawnInfo.anchorEl || null;
    var showStop = spawnInfo.showStop !== false;

    var el = document.createElement('div');
    el.className = 'subagent-card subagent-card-mini';
    el.dataset.subagentId = id;
    var html = '<div class="subagent-card-inner">' +
        '<span class="subagent-spinner"></span>' +
        '<div class="subagent-text">' +
          '<span class="subagent-label">' + this._esc(agentName) + ' \u00B7 0\u79D2</span>' +
          (task ? '<span class="subagent-detail">' + this._esc(task.slice(0, 80)) + '</span>' : '<span class="subagent-detail"></span>') +
        '</div>';
    if (showStop) {
      html += '<button class="subagent-stop-btn" title="\u505C\u6B62">\u2715</button>';
    }
    html += '</div>';
    el.innerHTML = html;

    var self = this;
    if (showStop) {
      var stopBtn = el.querySelector('.subagent-stop-btn');
      if (stopBtn) {
        stopBtn.addEventListener('click', function () {
          self.stop(id);
        });
      }
    }

    if (anchorEl && anchorEl.parentNode) {
      anchorEl.parentNode.insertBefore(el, anchorEl.nextSibling);
    } else {
      var messagesEl = document.getElementById('messages');
      if (messagesEl) messagesEl.appendChild(el);
    }

    var isTempId = !spawnInfo.childSessionKey;
    var card = {
      el: el,
      id: id,
      startedAt: Date.now(),
      childSessionKey: spawnInfo.childSessionKey || '',
      agentId: spawnInfo.agentId || '',
      agentName: agentName,
      task: task,
      isTempId: isTempId,
      terminal: false,
      lastProgLine: ''
    };
    this._cards[id] = card;
    this._startCardTimer(id);
    return card;
  },

  hasActive: function () {
    for (var cid in this._cards) {
      if (!this._cards[cid].terminal) return true;
    }
    return false;
  },

  ensureActive: function (anchorEl, agentId) {
    for (var cid in this._cards) {
      if (!this._cards[cid].terminal) return this._cards[cid];
    }
    var agentName = agentId || '';
    if (typeof State !== 'undefined' && State.agents) {
      for (var i = 0; i < State.agents.length; i++) {
        var a = State.agents[i];
        if (a.id === agentId) { agentName = a.name || a.id; break; }
      }
    }
    if (!agentName) agentName = '\u5B50\u4EFB\u52A1';
    return this.create({
      anchorEl: anchorEl,
      agentId: agentId || '',
      agentName: agentName,
      task: ''
    });
  },

  completeAll: function () {
    for (var cid in this._cards) {
      if (!this._cards[cid].terminal) {
        this._markCompleted(cid);
      }
    }
  },

  stop: function (id) {
    var card = this._cards[id];
    if (!card) return;
    var btn = card.el.querySelector('.subagent-stop-btn');
    if (btn) { btn.disabled = true; btn.textContent = '\u2026'; }

    var childKey = card.childSessionKey;
    if (!childKey) {
      this._markStopped(id);
      return;
    }
    Api.stopSubagent(childKey).then(function () {
      SubagentCard._markStopped(id);
    }).catch(function () {
      SubagentCard._markStopped(id);
    });
  },

  updateProgress: function (progressMap) {
    if (!progressMap || typeof progressMap !== 'object') return;
    var toolNameMap = {
      'read': '读取文件',
      'write': '写入文件',
      'exec': '执行命令',
      'web_search': '搜索中',
      'search': '搜索中',
      'browser': '浏览网页',
      'edit': '编辑文件',
      'list': '列出目录',
      'bash': '执行命令',
      'agents_list': '查找Agent',
      'sessions_spawn': '启动子Agent',
      'announce': '汇报结果'
    };
    for (var agentId in progressMap) {
      var info = progressMap[agentId];
      var toolName = info && info.toolName ? info.toolName : '';
      var label = toolNameMap[toolName] || toolName || '';
      var matched = false;
      for (var cid in this._cards) {
        var card = this._cards[cid];
        if (card.terminal) continue;
        if (card.agentId === agentId || cid.indexOf(agentId) >= 0) {
          card.lastProgLine = label ? '\u6B63\u5728' + label + '\u2026' : '';
          var detailEl = card.el.querySelector('.subagent-detail');
          if (detailEl) {
            detailEl.textContent = card.lastProgLine.slice(0, 80);
          }
          matched = true;
        }
      }
      if (!matched) {
        for (var cid2 in this._cards) {
          var card2 = this._cards[cid2];
          if (card2.terminal) continue;
          card2.lastProgLine = label ? '\u6B63\u5728' + label + '\u2026' : '';
          var detailEl2 = card2.el.querySelector('.subagent-detail');
          if (detailEl2) {
            detailEl2.textContent = card2.lastProgLine.slice(0, 80);
          }
          break;
        }
      }
    }
  },

  _updateCardProgress: function (id, progressLine) {
    var card = this._cards[id];
    if (!card || card.terminal) return;
    card.lastProgLine = progressLine || '';
    var detailEl = card.el.querySelector('.subagent-detail');
    if (detailEl) {
      detailEl.textContent = card.lastProgLine.slice(0, 80);
    }
    this._ensureScrolled(id);
  },

  _startCardTimer: function (id) {
    var self = this;
    var card = this._cards[id];
    if (!card) return;
    this._timerIntervals[id] = setInterval(function () {
      card = self._cards[id];
      if (!card || card.terminal) { self._stopCardTimer(id); return; }
      var elapsed = Math.floor((Date.now() - card.startedAt) / 1000);
      var mins = Math.floor(elapsed / 60);
      var secs = elapsed % 60;
      var timeStr = mins > 0 ? (mins + '\u5206' + secs + '\u79D2') : (secs + '\u79D2');
      var labelEl = card.el.querySelector('.subagent-label');
      if (labelEl) {
        var name = card.agentName || '';
        labelEl.textContent = name + ' \u00B7 ' + timeStr;
      }
    }, 1000);
  },

  _stopCardTimer: function (id) {
    if (this._timerIntervals[id]) {
      clearInterval(this._timerIntervals[id]);
      delete this._timerIntervals[id];
    }
  },

  _ensureScrolled: function (id) {
    if (State.userScrolledUp) return;
    var card = this._cards[id];
    if (!card || !card.el) return;
    var container = document.getElementById('messages');
    if (container) container.scrollTop = container.scrollHeight;
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
      if (matched && matched.isTempId) this.updateChildSessionKey(matched.id, sessionKey);
    }
    if (reason === 'ended' || reason === 'delete') {
      var card = this._cards[sessionKey];
      if (card) this._markCompleted(sessionKey);
    }
  },

  _extractAgentId: function (sessionKey) {
    if (!sessionKey) return '';
    var parts = sessionKey.split(':');
    return parts.length >= 2 && parts[0] === 'agent' ? parts[1] : '';
  },

  _findCardByAgentId: function (agentId) {
    for (var id in this._cards) {
      if (this._cards[id].agentId === agentId && this._cards[id].isTempId) return this._cards[id];
    }
    return null;
  },

  _markStopped: function (id) {
    var card = this._cards[id];
    if (!card) return;
    card.terminal = true;
    this._stopCardTimer(id);
    var spinner = card.el.querySelector('.subagent-spinner');
    if (spinner) spinner.className = 'subagent-spinner stopped';
    var labelEl = card.el.querySelector('.subagent-label');
    if (labelEl) {
      var name = card.agentName || '';
      labelEl.textContent = name + ' \u5DF2\u505C\u6B62';
    }
    this._fadeOutCard(id, 2000);
  },

  _markCompleted: function (id) {
    var card = this._cards[id];
    if (!card || card.terminal) return;
    card.terminal = true;
    this._stopCardTimer(id);
    var spinner = card.el.querySelector('.subagent-spinner');
    if (spinner) spinner.className = 'subagent-spinner done';
    var labelEl = card.el.querySelector('.subagent-label');
    if (labelEl) {
      var name = card.agentName || '';
      labelEl.textContent = name + ' \u5DF2\u5B8C\u6210';
    }
    this._fadeOutCard(id, 3000);
  },

  _fadeOutCard: function (id, delay) {
    var card = this._cards[id];
    if (!card || !card.el) return;
    setTimeout(function () {
      try {
        card.el.style.opacity = '0';
        card.el.style.maxHeight = '0';
        card.el.style.margin = '0';
        card.el.style.padding = '0';
        card.el.style.overflow = 'hidden';
        card.el.style.transition = 'all 0.4s ease';
        setTimeout(function () {
          if (card.el && card.el.parentNode) card.el.parentNode.removeChild(card.el);
        }, 500);
      } catch (e) {}
    }, delay);
  },

  _esc: function (s) {
    var d = document.createElement('span');
    d.textContent = s;
    return d.innerHTML;
  },

  destroy: function () {
    var self = this;
    Object.keys(this._timerIntervals).forEach(function (id) { self._stopCardTimer(id); });
    Object.keys(this._cards).forEach(function (id) {
      var el = self._cards[id].el;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    this._cards = {};
  },
};
