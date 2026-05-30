/**
 * state.js — 全局状态管理
 *
 * 职责：管理应用状态、事件订阅/发布
 *
 * 状态分组：
 *   State.ui        — UI 状态（侧边栏、弹窗、筛选）
 *   State.chat      — 聊天状态（流式、滚动、消息）
 *   State.agent     — Agent 状态（列表、当前 Agent）
 *   State.connection — 连接状态
 *   State.model     — 模型状态
 *
 * 向后兼容：保留 State.xxx 直接访问，逐步迁移到 State.ui.xxx
 */

const State = {
  // ═══ 分组状态 ═══

  /** UI 相关状态 */
  ui: {
    sidebarOpen: false,
    activeModal: null,
    editingAgent: null,
    filter: '',
  },

  /** 聊天相关状态 */
  chat: {
    streaming: false,
    userScrolledUp: false,
    messages: [],
    currentSessionId: null,
    dispatching: false,
  },

  /** Agent 相关状态 */
  agent: {
    agents: [],
    skills: [],
    currentAgent: '',
    interactionMode: 'dispatch',
  },

  /** 连接状态 */
  connection: {
    connected: false,
  },

  /** 模型状态 */
  model: {
    models: [],
    defaultModel: '',
  },

  /** 会话列表 */
  sessions: [],

  // ═══ 事件系统 ═══

  _listeners: {},

  /**
   * 订阅事件
   * @param {string} event - 事件名
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  on: function (event, callback) {
    if (!this._listeners[event]) this._listeners[event] = new Set();
    this._listeners[event].add(callback);
    const self = this;
    return function () { self.off(event, callback); };
  },

  /**
   * 取消订阅事件
   * @param {string} event - 事件名
   * @param {Function} callback - 回调函数
   */
  off: function (event, callback) {
    if (this._listeners[event]) this._listeners[event].delete(callback);
  },

  /**
   * 触发事件
   * @param {string} event - 事件名
   * @param {*} data - 事件数据
   * @private
   */
  _emit: function (event, data) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(function (cb) {
        try { cb(data); } catch (e) { console.error('[State] Listener error on "' + event + '":', e); }
      });
    }
  },

  /**
   * 更新状态
   *
   * 支持两种调用方式：
   *   State.setState({ streaming: true })           — 向后兼容
   *   State.setState({ chat: { streaming: true } }) — 分组方式
   *
   * @param {Object} partial - 部分状态
   */
  setState: function (partial) {
    const events = new Set();
    const self = this;

    // 分组状态的 key 映射
    const groupKeyToEvent = {
      // UI 组
      'ui.activeModal': 'modal',
      'ui.editingAgent': 'modal',
      'ui.filter': 'filter',
      'ui.sidebarOpen': 'sidebar',
      // Chat 组
      'chat.streaming': 'streaming',
      'chat.userScrolledUp': 'scroll',
      'chat.messages': 'messages',
      'chat.currentSessionId': 'session-switch',
      'chat.dispatching': 'dispatching',
      // Agent 组
      'agent.agents': 'agent-list',
      'agent.skills': 'skills',
      'agent.currentAgent': 'agent-switch',
      'agent.interactionMode': 'mode-switch',
      // Connection 组
      'connection.connected': 'connection',
      // Model 组
      'model.models': 'model-list',
      'model.defaultModel': 'model-switch',
      // Sessions
      'sessions': 'session-list',
    };

    // 向后兼容：扁平 key 映射
    const flatKeyToEvent = {
      sessions: 'session-list',
      currentSessionId: 'session-switch',
      currentAgent: 'agent-switch',
      interactionMode: 'mode-switch',
      agents: 'agent-list',
      skills: 'skills',
      models: 'model-list',
      defaultModel: 'model-switch',
      messages: 'messages',
      connected: 'connection',
      streaming: 'streaming',
      dispatching: 'dispatching',
      userScrolledUp: 'scroll',
      activeModal: 'modal',
      editingAgent: 'modal',
      filter: 'filter',
    };

    // 向后兼容：扁平 key 到分组 key 的映射
    const flatToGroup = {
      currentSessionId: 'chat.currentSessionId',
      streaming: 'chat.streaming',
      dispatching: 'chat.dispatching',
      userScrolledUp: 'chat.userScrolledUp',
      messages: 'chat.messages',
      currentAgent: 'agent.currentAgent',
      interactionMode: 'agent.interactionMode',
      agents: 'agent.agents',
      skills: 'agent.skills',
      connected: 'connection.connected',
      models: 'model.models',
      defaultModel: 'model.defaultModel',
      activeModal: 'ui.activeModal',
      editingAgent: 'ui.editingAgent',
      filter: 'ui.filter',
    };

    for (const key in partial) {
      const value = partial[key];

      // 处理分组状态
      if (this[key] && typeof this[key] === 'object' && !Array.isArray(this[key]) && typeof value === 'object' && value !== null) {
        // 分组更新：State.setState({ chat: { streaming: true } })
        const group = this[key];
        for (const subKey in value) {
          if (group[subKey] !== value[subKey]) {
            group[subKey] = value[subKey];
            const groupEventKey = key + '.' + subKey;
            const ev = groupKeyToEvent[groupEventKey];
            if (ev) events.add(ev);
          }
        }
      }
      // 处理扁平 key（向后兼容）
      else if (flatToGroup[key]) {
        const groupPath = flatToGroup[key];
        const parts = groupPath.split('.');
        const groupObj = this[parts[0]];
        const subKey = parts[1];
        if (groupObj[subKey] !== value) {
          groupObj[subKey] = value;
          const ev = flatKeyToEvent[key];
          if (ev) events.add(ev);
        }
      }
      // 处理顶层 key（sessions）
      else if (this[key] !== value) {
        this[key] = value;
        const ev = flatKeyToEvent[key];
        if (ev) events.add(ev);
      }
    }

    events.forEach(function (e) { self._emit(e); });
  },

  /**
   * 查找 Agent
   * @param {string} nameOrId - Agent 名称或 ID
   * @returns {Object|null} Agent 对象
   */
  findAgent: function (nameOrId) {
    if (!nameOrId) return null;
    const agents = this.agent.agents;
    for (let i = 0; i < agents.length; i++) {
      if (agents[i].id === nameOrId || agents[i].name === nameOrId) return agents[i];
    }
    return null;
  },

  // ═══ 向后兼容：getter/setter ═══
  // 这些属性允许现有代码继续工作，逐步迁移到 State.xxx.yyy

  get currentSessionId() { return this.chat.currentSessionId; },
  set currentSessionId(val) { this.chat.currentSessionId = val; },

  get currentAgent() { return this.agent.currentAgent; },
  set currentAgent(val) { this.agent.currentAgent = val; },

  get interactionMode() { return this.agent.interactionMode; },
  set interactionMode(val) { this.agent.interactionMode = val; },

  get messages() { return this.chat.messages; },
  set messages(val) { this.chat.messages = val; },

  get streaming() { return this.chat.streaming; },
  set streaming(val) { this.chat.streaming = val; },

  get dispatching() { return this.chat.dispatching; },
  set dispatching(val) { this.chat.dispatching = val; },

  get connected() { return this.connection.connected; },
  set connected(val) { this.connection.connected = val; },

  get userScrolledUp() { return this.chat.userScrolledUp; },
  set userScrolledUp(val) { this.chat.userScrolledUp = val; },

  get agents() { return this.agent.agents; },
  set agents(val) { this.agent.agents = val; },

  get skills() { return this.agent.skills; },
  set skills(val) { this.agent.skills = val; },

  get models() { return this.model.models; },
  set models(val) { this.model.models = val; },

  get defaultModel() { return this.model.defaultModel; },
  set defaultModel(val) { this.model.defaultModel = val; },

  get editingAgent() { return this.ui.editingAgent; },
  set editingAgent(val) { this.ui.editingAgent = val; },

  get activeModal() { return this.ui.activeModal; },
  set activeModal(val) { this.ui.activeModal = val; },

  get filter() { return this.ui.filter; },
  set filter(val) { this.ui.filter = val; },
};
