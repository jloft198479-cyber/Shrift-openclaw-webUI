/**
 * chat-view.js — 聊天视图（纯视图层）
 *
 * 职责：视图操作、附件处理、初始化
 *
 * 业务逻辑已迁移到 ChatController
 *
 * 依赖（必须在此前加载）：
 *   State, ChatController
 *   MessageRenderer, StreamRenderer, AttachmentBar
 *   WelcomeView, ModelSwitcher, SessionInteraction
 */

const ChatView = {

  /**
   * 初始化聊天视图
   */
  init: function () {
    MessageRenderer.init();
    StreamRenderer.init();
    AttachmentBar.pendingAttachments = [];
    WelcomeView.updateAgentModeBar();
    ModelSwitcher.updateBar();
    State.on('model-list', ModelSwitcher.updateBar);
    State.on('model-switch', ModelSwitcher.updateBar);
  },

  /**
   * 显示欢迎页
   * @param {Object} [opts] - 选项
   */
  showWelcome: function (opts) {
    WelcomeView.showWelcome(opts);
  },

  /**
   * 隐藏欢迎页
   */
  hideWelcome: function () {
    WelcomeView.hideWelcome();
  },

  /**
   * 清空消息
   */
  clearMessages: function () {
    AttachmentBar.clear();
    MessageRenderer.clearMessages();
    ChatController._clearDispatchState();
  },

  /**
   * 追加消息
   * @param {string} role - 角色（user/assistant）
   * @param {string} content - 内容
   * @param {boolean} streaming - 是否流式
   * @param {string} thinking - 思考内容
   * @param {string} agentId - Agent ID
   * @param {Array} [attachmentMeta] - 附件元数据
   * @returns {HTMLElement|null} 消息元素
   */
  appendMessage: function (role, content, streaming, thinking, agentId, attachmentMeta) {
    return MessageRenderer.appendMessage(role, content, streaming, thinking, agentId, attachmentMeta);
  },

  // ═══ 附件处理（委托给 AttachmentBar）═══

  /**
   * 处理文件
   * @param {File[]} files - 文件列表
   */
  handleFiles: function (files) {
    AttachmentBar.handleFiles(files);
  },

  /**
   * 渲染附件栏
   */
  renderAttachmentBar: function () {
    AttachmentBar.render();
  },

  /**
   * 清空附件
   */
  clearAttachments: function () {
    AttachmentBar.clear();
  },

  /**
   * 上传所有附件
   * @returns {Promise<Array>} 附件路径列表
   */
  uploadAttachments: async function () {
    return await AttachmentBar.uploadAll();
  },

  // ═══ 业务逻辑委托给 ChatController ═══

  /**
   * 发送消息
   * @returns {Promise<void>}
   */
  sendMessage: async function () {
    return await ChatController.sendMessage();
  },

  /**
   * 停止生成
   */
  stopGeneration: function () {
    ChatController.stopGeneration();
  },
};
