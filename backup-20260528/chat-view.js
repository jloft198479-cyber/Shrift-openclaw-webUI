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
    State.on('model-list', ModelSwitcher.updateBar);
    State.on('model-switch', ModelSwitcher.updateBar);
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
    if (ChatView._activeChatCleanup) { ChatView._activeChatCleanup(); ChatView._activeChatCleanup = null; }
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

    let agentId = State.pendingDelegation ? State.pendingDelegation.agentId : (State.currentAgent || '');
    if (State.pendingDelegation) {
      State.setState({ pendingDelegation: null });
      var badge = document.getElementById('delegate-badge');
      if (badge) badge.style.display = 'none';
    }
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

    displayText = MessageBuilder.buildAttachmentDisplayText(displayText, attachmentPaths);
    apiText = MessageBuilder.buildAttachmentDisplayText(apiText, attachmentPaths);

    // 用户消息：传入 attachmentMeta 以渲染附件卡片
    MessageRenderer.appendMessage('user', displayText, false, '', '', attachmentPaths);
    scrollToBottom(document.getElementById('messages'));

    SessionInteraction.saveUserMessage(session, displayText, attachmentPaths);

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
        onToolCall: function (fnName, fnArgs, callId) {
          if (fnName !== 'sessions_spawn') return;
          try {
            var args = JSON.parse(fnArgs);
            var agentId = args.agentId || '';
            var agentName = '';
            var agent = State.findAgent(agentId);
            if (agent) agentName = agent.name || agentId;
            var list = State.activeSubagents || [];
            var entry = { agentId: agentId, agentName: agentName, task: args.task || '', callId: callId };
            list.push(entry);
            State.setState({ activeSubagents: list });
            SubagentCard.create({
              runId: callId,
              agentId: agentId,
              agentName: agentName,
              task: args.task || '',
              anchorEl: assistantEl
            });
          } catch (e) {
            console.error('[ChatView] sessions_spawn parse error:', e);
          }
        },
        onDone: function (resolvedAgentId) {
          if (resolvedAgentId && resolvedAgentId !== 'main') actualAgentId = resolvedAgentId;
          var finalText = st.text;
          StreamRenderer.endStreaming();
          if (session) {
            var msgObj = { role: 'assistant', content: finalText };
            if (actualAgentId && actualAgentId !== 'main') msgObj.agentId = actualAgentId;
            session.messages.push(msgObj);
            session.updated_at = Date.now();
            SessionStore.save(session);
          }
          State.setState({ sessions: SessionStore.getList() });
          _postStreamSyncCheck(sessionResult.sessionId);
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

  _resolveAgentDisplay: function (agentId) {
    if (agentId) {
      const agent = State.findAgent(agentId);
      return agent ? agent.name : agentId;
    }
    return '';
  },

  stopGeneration: function () {
    StreamRenderer.stopGeneration();
  },
  _resetSendBtn: function () {
    StreamRenderer._resetSendBtn();
  },
};

var _postStreamSyncId = 0;
function _postStreamSyncCheck(sessionId) {
  if (!sessionId) return;
  _postStreamSyncId++;
  var syncId = _postStreamSyncId;
  function doCheck() {
    if (syncId !== _postStreamSyncId) return;
    Api.startSync().catch(function (e) { console.warn('[ChatView] startSync failed:', e.message || e); });
  }
  setTimeout(doCheck, 1000);
}
