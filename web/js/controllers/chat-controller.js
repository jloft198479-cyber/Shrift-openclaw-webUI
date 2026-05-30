/**
 * chat-controller.js — 聊天业务逻辑控制器
 *
 * 职责：消息发送、流式渲染调度、会话管理
 *
 * 依赖（必须在此前加载）：
 *   State, Api, SessionStore, SessionManager
 *   MessageBuilder, StreamRenderer, MessageRenderer
 *   AttachmentBar, WelcomeView, ModelSwitcher, SessionInteraction
 */

var ChatController = {
  _activeChatCleanup: null,
  _lastRenderedContent: '',
  _progressElements: {},
  _spawnDetected: false,
  _announceCheckTimer: null,

  /**
   * 发送消息（主控调度）
   *
   * 流程：
   * 1. 获取用户输入
   * 2. 上传附件（如果有）
   * 3. 确保会话存在
   * 4. 显示用户消息
   * 5. 创建助手消息气泡
   * 6. 调用 API 发送消息
   * 7. 处理流式响应
   * 8. 保存助手消息
   */
  sendMessage: async function () {
    if (State.streaming) return;
    if (this._activeChatCleanup) {
      this._activeChatCleanup();
      this._activeChatCleanup = null;
    }
    this._spawnDetected = false;
    var oldProgress = this._progressElements;
    this._progressElements = {};
    for (var aid in oldProgress) {
      if (oldProgress[aid] && oldProgress[aid].remove) oldProgress[aid].remove();
    }
    if (this._announceCheckTimer) {
      clearTimeout(this._announceCheckTimer);
      this._announceCheckTimer = null;
    }

    var input = document.getElementById('input');
    var sendBtn = document.getElementById('send-btn');
    var thinkInd = document.getElementById('thinking-indicator');
    if (!input || !sendBtn) return;

    var text = input.value.trim();
    if (!text && AttachmentBar.pendingAttachments.length === 0) return;

    // 1. 上传附件
    var attachmentPaths = [];
    if (AttachmentBar.pendingAttachments.length > 0) {
      try {
        attachmentPaths = await AttachmentBar.uploadAll();
      } catch (err) {
        showToast('文件上传失败: ' + err.message, 3000);
        return;
      }
      AttachmentBar.clear();
    }

    // 2. 确定 Agent
    var agentId = State.interactionMode === 'direct' ? (State.currentAgent || 'main') : 'main';
    var actualAgentId = agentId;
    DebugTrace.log('sendMessage', { text: text.substring(0, 80), interactionMode: State.interactionMode, agentId: agentId });

    // 3. 确保会话存在
    var sessionResult = SessionInteraction.ensureSession(text);
    var sessionId = sessionResult.sessionId;
    var session = sessionResult.session;

    // 4. 开始流式渲染
    StreamRenderer.beginStreaming(this._cleanupChat.bind(this));
    input.value = '';
    autoResize();
    sendBtn.disabled = true;
    if (thinkInd) thinkInd.style.display = 'flex';

    // 5. 隐藏欢迎页
    WelcomeView.hideWelcome();

    // 6. 构建显示文本
    var displayText = text;
    var apiText = text;
    displayText = MessageBuilder.buildAttachmentDisplayText(displayText, attachmentPaths);
    apiText = MessageBuilder.buildAttachmentDisplayText(apiText, attachmentPaths);

    // 7. 显示用户消息
    MessageRenderer.appendMessage('user', displayText, false, '', '', attachmentPaths);
    scrollToBottom(document.getElementById('messages'));

    // 8. 保存用户消息
    SessionInteraction.saveUserMessage(session, displayText, attachmentPaths);

    // 9. 创建助手消息气泡
    var assistantEl = MessageRenderer.appendMessage('assistant', '', true, '', agentId || '');
    StreamRenderer.initStreamState(assistantEl ? assistantEl.querySelector('.bubble') : null);
    var st = StreamRenderer.getStreamState();

    if (this._activeChatCleanup) this._activeChatCleanup();

    var self = this;
    function cleanupChat() {
      self._activeChatCleanup = null;
      sendBtn.disabled = false;
    }
    this._activeChatCleanup = cleanupChat;

    // 10. 构建 API 消息
    var apiMessages = MessageBuilder.buildApiMessages(session, agentId, apiText, attachmentPaths);

    // 11. 调用 API
    try {
      await Api.chat(apiMessages, agentId || '', {
        onDelta: function (text) {
          if (!text) return;
          st.began = true;
          st.preparing = false;
          st.text += text;
          if (st.text.indexOf('NO_REPLY') >= 0) {
            st.text = '';
            st.bubble.style.display = 'none';
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
          var finalText = st.text;
          StreamRenderer.endStreaming();
          self._lastRenderedContent = finalText || '';
          if (self._spawnDetected) {
            self._spawnDetected = false;
            self._scheduleAnnounceCheck();
          }
          if (session) {
            var msgObj = { role: 'assistant', content: finalText };
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

  /**
   * 停止生成
   */
  stopGeneration: function () {
    StreamRenderer.stopGeneration();
  },

  /**
   * 清理聊天状态
   * @private
   */
  _cleanupChat: function () {
    if (this._activeChatCleanup) {
      this._activeChatCleanup();
      this._activeChatCleanup = null;
    }
  },

  /**
   * 解析 Agent 显示名称
   * @param {string} agentId - Agent ID
   * @returns {string} 显示名称
   */
  resolveAgentDisplay: function (agentId) {
    if (agentId) {
      var agent = State.findAgent(agentId);
      return agent ? (agent.displayName || agent.name) : agentId;
    }
    return '';
  },

  handleAnnounceResult: function (messages, agentId) {
    DebugTrace.log('handleAnnounceResult', { agentId: agentId, msgCount: messages ? messages.length : 0, interactionMode: State.interactionMode, streaming: State.streaming });
    if (!messages || messages.length === 0) return;
    if (State.interactionMode === 'direct') return;
    if (State.streaming) return;

    var lastMsg = null;
    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].content
          && messages[i].content !== 'NO_REPLY' && messages[i].content !== 'no_reply') {
        lastMsg = messages[i];
        break;
      }
    }
    if (!lastMsg) return;
    if (lastMsg.content === this._lastRenderedContent) return;

    var resolvedAgentId = agentId || lastMsg.agentId || '';
    if (resolvedAgentId) { this._removeAgentProgress(resolvedAgentId); }
    else { this._removeAllProgress(); }

    MessageRenderer.appendMessage('assistant', lastMsg.content, false, '', 'main');

    var session = SessionStore.get(State.currentSessionId);
    if (session) {
      session.messages.push({ role: 'assistant', content: lastMsg.content });
      session.updated_at = Date.now();
      SessionStore.save(session);
    }

    scrollToBottom(document.getElementById('messages'), false);
    State.setState({ sessions: SessionStore.getList() });
    this._lastRenderedContent = lastMsg.content;
    if (this._announceCheckTimer) {
      clearTimeout(this._announceCheckTimer);
      this._announceCheckTimer = null;
    }
  },

  _scheduleAnnounceCheck: function () {
    if (this._announceCheckTimer) return;
    var self = this;
    this._announceCheckTimer = setTimeout(function () {
      self._announceCheckTimer = null;
      Api.fetchSessionMessages(State.currentSessionId, function (messages) {
        if (!messages || messages.length === 0) return;
        for (var i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant' && messages[i].content
              && messages[i].content !== 'NO_REPLY' && messages[i].content !== 'no_reply'
              && messages[i].content !== self._lastRenderedContent) {
            self.handleAnnounceResult([messages[i]]);
            return;
          }
        }
      });
    }, 12000);
  },

  handleSubagentProgress: function (progress) {
    DebugTrace.log('handleSubagentProgress', { progress: progress });
    if (!progress || typeof progress !== 'object') return;
    var keys = Object.keys(progress);
    if (keys.length === 0) return;
    for (var i = 0; i < keys.length; i++) {
      var agentId = keys[i];
      var toolName = progress[agentId].toolName || '';
      this._showAgentProgress(agentId, toolName);
    }
  },

  _showAgentProgress: function (agentId, toolName) {
    var el = this._progressElements[agentId];
    if (el) {
      var toolSpan = el.querySelector('.subagent-progress-tool');
      if (toolSpan && toolName) { toolSpan.textContent = toolName; }
      return;
    }

    var agent = State.findAgent(agentId);
    var name = agent ? (agent.displayName || agent.name) : agentId;

    el = document.createElement('div');
    el.className = 'subagent-progress-inline';
    el.innerHTML = '<span class="subagent-progress-spinner"></span>'
      + '<span class="subagent-progress-name">' + Utils.escapeHtml(name) + '</span>'
      + '<span class="subagent-progress-label">正在执行</span>'
      + (toolName ? '<span class="subagent-progress-tool">' + Utils.escapeHtml(toolName) + '</span>' : '');

    var inner = document.querySelector('.messages-inner');
    if (inner) inner.appendChild(el);

    this._progressElements[agentId] = el;
    scrollToBottom(document.getElementById('messages'), false);
  },

  _removeAgentProgress: function (agentId) {
    var el = this._progressElements[agentId];
    if (el) {
      el.remove();
      delete this._progressElements[agentId];
    }
  },

  _removeAllProgress: function () {
    for (var aid in this._progressElements) {
      if (this._progressElements[aid] && this._progressElements[aid].remove) {
        this._progressElements[aid].remove();
      }
    }
    this._progressElements = {};
  },
};
