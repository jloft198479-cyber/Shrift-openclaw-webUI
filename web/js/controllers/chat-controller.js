/**
 * chat-controller.js — 聊天业务逻辑控制器
 *
 * 职责：消息发送、流式渲染调度、会话管理、智能调度状态管理
 *
 * 依赖（必须在此前加载）：
 *   State, Api, SessionStore, SessionManager
 *   MessageBuilder, StreamRenderer, MessageRenderer
 *   AttachmentBar, WelcomeView, ModelSwitcher, SessionInteraction
 */

const ChatController = {
  _activeChatCleanup: null,
  _progressElements: {},
  _spawnDetected: false,
  _activeSubagents: new Set(),
  _completedSubagents: new Set(),
  _announcedFingerprints: new Set(),
  _dispatchSafetyTimer: null,
  _dispatchLongTimer: null,

  sendMessage: async function () {
    if (State.streaming) return;
    if (State.dispatching) return;

    this._clearDispatchState();

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

    const agentId = State.interactionMode === 'direct' ? (State.currentAgent || 'main') : 'main';
    const actualAgentId = agentId;
    DebugTrace.log('sendMessage', { text: text.substring(0, 80), interactionMode: State.interactionMode, agentId: agentId });

    const sessionResult = SessionInteraction.ensureSession(text);
    const sessionId = sessionResult.sessionId;
    const session = sessionResult.session;

    StreamRenderer.beginStreaming(this._cleanupChat.bind(this));
    input.value = '';
    autoResize();
    sendBtn.disabled = true;
    if (thinkInd) thinkInd.style.display = 'flex';

    WelcomeView.hideWelcome();

    let displayText = text;
    let apiText = text;
    displayText = MessageBuilder.buildAttachmentDisplayText(displayText, attachmentPaths);
    apiText = MessageBuilder.buildAttachmentDisplayText(apiText, attachmentPaths);

    MessageRenderer.appendMessage('user', displayText, false, '', '', attachmentPaths);
    scrollToBottom(document.getElementById('messages'));

    SessionInteraction.saveUserMessage(session, displayText, attachmentPaths);

    const assistantEl = MessageRenderer.appendMessage('assistant', '', true, '', agentId || '');
    StreamRenderer.initStreamState(assistantEl ? assistantEl.querySelector('.bubble') : null);
    const st = StreamRenderer.getStreamState();

    if (this._activeChatCleanup) this._activeChatCleanup();

    const self = this;
    function cleanupChat() {
      self._activeChatCleanup = null;
      if (!State.dispatching) sendBtn.disabled = false;
    }
    this._activeChatCleanup = cleanupChat;

    const apiMessages = MessageBuilder.buildApiMessages(session, agentId, apiText, attachmentPaths);

    try {
      await Api.chat(apiMessages, agentId || '', {
        onDelta: function (text) {
          if (!text) return;
          st.began = true;
          st.preparing = false;
          st.text += text;
          if (st.text.indexOf('NO_REPLY') >= 0) {
            st.text = '';
            return;
          }
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
          DebugTrace.log('onAgentSwitch', { switchedAgentId: switchedAgentId, interactionMode: State.interactionMode, blocked: State.interactionMode === 'dispatch' });
          if (State.interactionMode !== 'dispatch') {
            actualAgentId = switchedAgentId;
            MessageRenderer.updateMessageAgent(assistantEl, switchedAgentId);
          }
        },
        onToolCall: function (fnName, fnArgs, callId) {
          DebugTrace.log('onToolCall', { fnName: fnName, isSpawn: fnName === 'sessions_spawn' });
          if (fnName === 'sessions_spawn') {
            self._spawnDetected = true;
          }
        },
        onDone: function (resolvedAgentId) {
          DebugTrace.log('onDone', { resolvedAgentId: resolvedAgentId, actualAgentId: actualAgentId, interactionMode: State.interactionMode, spawnDetected: self._spawnDetected });
          if (State.interactionMode !== 'dispatch' && resolvedAgentId && resolvedAgentId !== 'main') actualAgentId = resolvedAgentId;
          const finalText = st.text;
          if (finalText) {
            var fp = finalText.substring(0, 200).replace(/\s/g, '');
            self._announcedFingerprints.add(fp);
          }
          if (self._spawnDetected) {
            self._spawnDetected = false;
            State.setState({ dispatching: true });
            self._updateDispatchStatusBar();
            self._dispatchSafetyTimer = setTimeout(function () {
              if (State.dispatching) {
                DebugTrace.log('dispatch-safety-timeout', { active: self._activeSubagents.size, completed: self._completedSubagents.size });
                if (self._activeSubagents.size > 0 && self._completedSubagents.size >= self._activeSubagents.size) {
                  self._checkDispatchComplete();
                } else if (self._activeSubagents.size === 0) {
                  DebugTrace.log('dispatch-safety-timeout-no-progress', {});
                  State.setState({ dispatching: false });
                  self._hideDispatchStatusBar();
                  StreamRenderer._resetSendBtn();
                }
              }
            }, 15000);
            self._dispatchLongTimer = setTimeout(function () {
              if (State.dispatching) {
                DebugTrace.log('dispatch-safety-timeout-long', {});
                self._clearDispatchState();
                StreamRenderer._resetSendBtn();
              }
            }, 120000);
          }
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

  stopGeneration: function () {
    StreamRenderer.stopGeneration();
  },

  _cleanupChat: function () {
    if (this._activeChatCleanup) {
      this._activeChatCleanup();
      this._activeChatCleanup = null;
    }
  },

  resolveAgentDisplay: function (agentId) {
    if (agentId) {
      const agent = State.findAgent(agentId);
      return agent ? (agent.displayName || agent.name) : agentId;
    }
    return '';
  },

  handleAnnounceResult: function (messages, agentId, sessionId) {
    DebugTrace.log('handleAnnounceResult', { agentId: agentId, sessionId: sessionId || '', msgCount: messages ? messages.length : 0, interactionMode: State.interactionMode, streaming: State.streaming, dispatching: State.dispatching });
    if (!messages || messages.length === 0) return;
    if (State.interactionMode === 'direct') return;
    if (State.streaming) return;

    let lastMsg = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].content
          && messages[i].content !== 'NO_REPLY' && messages[i].content !== 'no_reply') {
        lastMsg = messages[i];
        break;
      }
    }
    if (!lastMsg) return;

    var fp = (lastMsg.content || '').substring(0, 200).replace(/\s/g, '');
    if (this._announcedFingerprints.has(fp)) return;
    this._announcedFingerprints.add(fp);

    const resolvedAgentId = agentId || lastMsg.agentId || '';

    if (sessionId && sessionId !== State.currentSessionId) {
      DebugTrace.log('announce-route-to-other-session', { sessionId: sessionId, currentSessionId: State.currentSessionId });
      const targetSession = SessionStore.get(sessionId);
      if (targetSession) {
        SessionInteraction.appendToLastAssistantMessage(targetSession, lastMsg.content, resolvedAgentId);
        targetSession.updated_at = Date.now();
        SessionStore.save(targetSession);
        State.setState({ sessions: SessionStore.getList() });
      }
      return;
    }

    if (resolvedAgentId) {
      if (!this._completedSubagents.has(resolvedAgentId)) {
        this._activeSubagents.add(resolvedAgentId);
        this._completedSubagents.add(resolvedAgentId);
      }
      MessageRenderer.updateProgressBlock(resolvedAgentId, 'done');
    }

    MessageRenderer.appendToLastAssistantMessage(lastMsg.content, resolvedAgentId || 'main');

    const session = SessionStore.get(State.currentSessionId);
    if (session) {
      SessionInteraction.appendToLastAssistantMessage(session, lastMsg.content, resolvedAgentId);
      session.updated_at = Date.now();
      SessionStore.save(session);
    }

    scrollToBottom(document.getElementById('messages'), false);
    State.setState({ sessions: SessionStore.getList() });

    this._updateDispatchStatusBar();
    this._checkDispatchComplete();
  },

  handleSubagentProgress: function (progress) {
    if (State.interactionMode !== 'dispatch') return;
    DebugTrace.log('handleSubagentProgress', { progress: progress });
    if (!progress || typeof progress !== 'object') return;
    const keys = Object.keys(progress);
    if (keys.length === 0) return;
    for (let i = 0; i < keys.length; i++) {
      const agentId = keys[i];
      const toolName = progress[agentId].toolName || '';
      this._activeSubagents.add(agentId);

      if (this._progressElements[agentId]) {
        MessageRenderer.updateProgressBlock(agentId, 'running', toolName);
      } else {
        const agent = State.findAgent(agentId);
        const name = agent ? (agent.displayName || agent.name) : agentId;
        const el = MessageRenderer.addProgressBlock(agentId, name, toolName);
        this._progressElements[agentId] = el;
        scrollToBottom(document.getElementById('messages'), false);
      }
    }
    this._updateDispatchStatusBar();
  },

  handleSubagentDone: function (agentId, sessionId) {
    if (State.interactionMode !== 'dispatch') return;
    DebugTrace.log('handleSubagentDone', { agentId: agentId, sessionId: sessionId || '' });
    if (!agentId) return;
    this._activeSubagents.add(agentId);
    this._completedSubagents.add(agentId);

    if (!this._progressElements[agentId]) {
      const agent = State.findAgent(agentId);
      const name = agent ? (agent.displayName || agent.name) : agentId;
      const el = MessageRenderer.addProgressBlock(agentId, name, '');
      this._progressElements[agentId] = el;
    }

    MessageRenderer.updateProgressBlock(agentId, 'done');
    this._updateDispatchStatusBar();
    this._checkDispatchComplete();
  },

  _checkDispatchComplete: function () {
    if (!State.dispatching) return;
    if (this._activeSubagents.size === 0) return;
    if (this._completedSubagents.size < this._activeSubagents.size) return;

    DebugTrace.log('dispatch-complete', { active: this._activeSubagents.size, completed: this._completedSubagents.size });
    State.setState({ dispatching: false });
    this._hideDispatchStatusBar();
    StreamRenderer._resetSendBtn();

    if (this._dispatchSafetyTimer) {
      clearTimeout(this._dispatchSafetyTimer);
      this._dispatchSafetyTimer = null;
    }
    if (this._dispatchLongTimer) {
      clearTimeout(this._dispatchLongTimer);
      this._dispatchLongTimer = null;
    }

    const self = this;
    setTimeout(function () {
      self._activeSubagents.clear();
      self._completedSubagents.clear();
      self._announcedFingerprints.clear();
      self._progressElements = {};
    }, 2000);
  },

  _updateDispatchStatusBar: function () {
  },

  _hideDispatchStatusBar: function () {
  },

  _clearDispatchState: function () {
    if (State.dispatching) {
      State.setState({ dispatching: false });
    }
    if (this._dispatchSafetyTimer) {
      clearTimeout(this._dispatchSafetyTimer);
      this._dispatchSafetyTimer = null;
    }
    if (this._dispatchLongTimer) {
      clearTimeout(this._dispatchLongTimer);
      this._dispatchLongTimer = null;
    }
    this._activeSubagents.clear();
    this._completedSubagents.clear();
    this._announcedFingerprints.clear();
    this._progressElements = {};
    this._spawnDetected = false;
    this._hideDispatchStatusBar();
  },
};
