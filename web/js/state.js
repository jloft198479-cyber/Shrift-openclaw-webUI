const State = {
  sessions: [],
  currentSessionId: null,
  currentAgent: "",
  messages: [],
  streaming: false,
  connected: false,
  userScrolledUp: false,
  agents: [],
  skills: [],
  models: [],
  defaultModel: '',
  editingAgent: null,
  activeModal: null,
  pendingDelegation: null,
  filter: "",
  lastMainSession: null,

  _listeners: {},

  on: function (event, callback) {
    if (!this._listeners[event]) this._listeners[event] = new Set();
    this._listeners[event].add(callback);
    const self = this;
    return function () { self.off(event, callback); };
  },

  off: function (event, callback) {
    if (this._listeners[event]) this._listeners[event].delete(callback);
  },

  _emit: function (event, data) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(function (cb) {
        try { cb(data); } catch (e) { console.error('[State] Listener error on "' + event + '":', e); }
      });
    }
  },

  setState: function (partial) {
    const events = new Set();
    const keyToEvent = {
      sessions: 'session-list',
      currentSessionId: 'session-switch',
      currentAgent: 'agent-switch',
      agents: 'agent-list',
      skills: 'skills',
      models: 'model-list',
      defaultModel: 'model-switch',
      messages: 'messages',
      connected: 'connection',
      streaming: 'streaming',
      userScrolledUp: 'scroll',
      activeModal: 'modal',
      editingAgent: 'modal',
      pendingDelegation: 'delegation',
      filter: 'filter',
      lastMainSession: 'session-list',
    };
    for (const key in partial) {
      if (this[key] !== partial[key]) {
        this[key] = partial[key];
        const ev = keyToEvent[key];
        if (ev) events.add(ev);
      }
    }
    const self = this;
    events.forEach(function (e) { self._emit(e); });
  },

  findAgent: function (nameOrId) {
    if (!nameOrId) return null;
    for (let i = 0; i < this.agents.length; i++) {
      if (this.agents[i].id === nameOrId || this.agents[i].name === nameOrId) return this.agents[i];
    }
    return null;
  },
};
