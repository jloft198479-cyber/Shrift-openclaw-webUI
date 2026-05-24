/* ── chat-view.js — 主控：发送调度 + 委托入口 ────────
        依赖模块（必须在此前加载）：
        welcome-view / model-switcher / session-interaction / message-builder
        stream-renderer / message-renderer / attachment-bar
*/

const ChatView = {
  MAX_FILE_SIZE: 10 * 1024 * 1024,

  // ═══ 初始化 ═══
  init: function () {
    StreamRenderer.init();
    AttachmentBar.pendingAttachments = [];
    WelcomeView.updateAgentModeBar();
    ModelSwitcher.updateBar();
    State.on('models', ModelSwitcher.updateBar);
  },

  showWelcome: function (opts) { WelcomeView.showWelcome(opts); },

  hideWelcome: function () { WelcomeView.hideWelcome(); },

  clearMessages: function () {
    AttachmentBar.clear();
    MessageRenderer.clearMessages();
  },

  appendMessage: function (role, content, streaming, thinking, agentId, attachmentMeta) {
    return MessageRenderer.appendMessage(role, content, streaming, thinking, agentId, attachmentMeta);
  },

  // ═══ 附件（委托给 AttachmentBar）═══
  handleFiles: function (files) {
    AttachmentBar.handleFiles(files);
  },
  renderAttachmentBar: function () {
    AttachmentBar.render();
  },
  clearAttachments: function () {
    AttachmentBar.clear();
  },
  uploadAttachments: async function () {
    return await AttachmentBar.uploadAll();
  },

  // ═══ 发送消息（主控调度）═══
  sendMessage: async function () {
    if (State.streaming) return;
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const thinkInd = document.getElementById('thinking-indicator');
    if (!input || !sendBtn) return;

    const text = input.value.trim();
    if (!text && AttachmentBar.pendingAttachments.length === 0) return;

    let attachmentPaths = [];
    if (AttachmentBar.pendingAttachments.length > 0) {
      try {
        attachmentPaths = await AttachmentBar.uploadAll();
      } catch (err) {
        showToast('文件上传失败: ' + err.message, 3000);
        return;
      }
      AttachmentBar.clear();
    }

    const delegation = State.pendingDelegation || null;
    let agentId = delegation ? delegation.agentId : (State.currentAgent || '');
    let actualAgentId = agentId;

    const sessionResult = SessionInteraction.ensureSession(text);
    const sessionId = sessionResult.sessionId;
    const session = sessionResult.session;

    StreamRenderer.beginStreaming(cleanupChat);
    input.value = '';
    autoResize();
    if (thinkInd) thinkInd.style.display = 'flex';

    WelcomeView.hideWelcome();

    let displayText = text;
    let apiText = text;
    if (delegation && delegation.agentName) {
      displayText = '@' + delegation.agentName + ' ' + text;
    }

    displayText = MessageBuilder.buildAttachmentDisplayText(displayText, attachmentPaths);
    apiText = MessageBuilder.buildAttachmentDisplayText(apiText, attachmentPaths);

    // 用户消息：传入 attachmentMeta 以渲染附件卡片
    MessageRenderer.appendMessage('user', displayText, false, '', '', attachmentPaths);
    scrollToBottom(document.getElementById('messages'));

    SessionInteraction.saveUserMessage(session, displayText, attachmentPaths);

    cancelDelegateMode();

    var isDirectChat = !!agentId;
    const assistantEl = MessageRenderer.appendMessage('assistant', '', true, '', agentId || '');

    StreamRenderer.initStreamState(assistantEl ? assistantEl.querySelector('.bubble') : null);
    const st = StreamRenderer.getStreamState();

    if (ChatView._activeChatCleanup) ChatView._activeChatCleanup();

    function cleanupChat() {
      ChatView._activeChatCleanup = null;
    };
    ChatView._activeChatCleanup = cleanupChat;

    const apiMessages = MessageBuilder.buildApiMessages(session, agentId, apiText, attachmentPaths);

    try {
      await Api.chat(apiMessages, agentId || '', {
        onDelta: function (text) {
          if (!text) return;
          st.began = true;
          st.preparing = false;
          st.text += text;
          StreamRenderer.setStreamState(st);
          StreamRenderer.scheduleRender();
          if (!State.userScrolledUp) {
            scrollToBottom(document.getElementById('messages'), false);
          }
        },
        onThinking: function (text) {
          if (!text) return;
          st.thinking += text;
          st.think = true;
          StreamRenderer.setStreamState(st);
          StreamRenderer.scheduleRender();
        },
        onAgentSwitch: function (switchedAgentId) {
          actualAgentId = switchedAgentId;
          MessageRenderer.updateMessageAgent(assistantEl, switchedAgentId);
        },
        onDone: function (resolvedAgentId) {
          if (resolvedAgentId && resolvedAgentId !== 'main') actualAgentId = resolvedAgentId;
          const finalText = st.text;
          StreamRenderer.endStreaming();
          if (session) {
            const msgObj = { role: 'assistant', content: finalText };
            if (actualAgentId && actualAgentId !== 'main') msgObj.agentId = actualAgentId;
            session.messages.push(msgObj);
            session.updated_at = Date.now();
            SessionStore.save(session);
          }
          State.setState({ sessions: SessionStore.getList() });
          cleanupChat();
        },
        onError: function (err) {
          MessageRenderer.showError(st.bubble, '错误', err.message || '请求失败');
          StreamRenderer.endStreaming();
          cleanupChat();
        },
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        StreamRenderer.endStreaming();
        cleanupChat();
        return;
      }
      MessageRenderer.showError(st.bubble, '发送失败', err.message);
      StreamRenderer.endStreaming();
      cleanupChat();
    }
  },

  _resolveAgentDisplay: function (agentId, delegation) {
    if (agentId) {
      const agent = State.findAgent(agentId);
      return agent ? agent.name : agentId;
    }
    return '';
  },

  // ═══ 停止生成 ═══
  stopGeneration: function () {
    StreamRenderer.stopGeneration();
  },
  _resetSendBtn: function () {
    StreamRenderer._resetSendBtn();
  },
};
