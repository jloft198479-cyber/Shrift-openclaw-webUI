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

const ChatController = {
  _activeChatCleanup: null,
  _lastRenderedContent: '',
  _progressElements: {},
  _spawnDetected: false,
  _announceCheckTimers: {},  // ⚠️ Fix 3: 按 sessionId 区分的 timer 表

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
    const oldProgress = this._progressElements;
    this._progressElements = {};
    for (const aid in oldProgress) {
      if (oldProgress[aid] && oldProgress[aid].remove) oldProgress[aid].remove();
    }
    // ⚠️ Fix 3: 新消息开始时清除所有 announce timer
    for (const k in this._announceCheckTimers) {
      clearTimeout(this._announceCheckTimers[k]);
    }
    this._announceCheckTimers = {};

    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const thinkInd = document.getElementById('thinking-indicator');
    if (!input || !sendBtn) return;

    const text = input.value.trim();
    if (!text && AttachmentBar.pendingAttachments.length === 0) return;

    // 1. 上传附件
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

    // 2. 确定 Agent
    const agentId = State.interactionMode === 'direct' ? (State.currentAgent || 'main') : 'main';
    const actualAgentId = agentId;
    DebugTrace.log('sendMessage', { text: text.substring(0, 80), interactionMode: State.interactionMode, agentId: agentId });

    // 3. 确保会话存在
    const sessionResult = SessionInteraction.ensureSession(text);
    const sessionId = sessionResult.sessionId;
    const session = sessionResult.session;

    // 4. 开始流式渲染
    StreamRenderer.beginStreaming(this._cleanupChat.bind(this));
    input.value = '';
    autoResize();
    sendBtn.disabled = true;
    if (thinkInd) thinkInd.style.display = 'flex';

    // 5. 隐藏欢迎页
    WelcomeView.hideWelcome();

    // 6. 构建显示文本
    let displayText = text;
    let apiText = text;
    displayText = MessageBuilder.buildAttachmentDisplayText(displayText, attachmentPaths);
    apiText = MessageBuilder.buildAttachmentDisplayText(apiText, attachmentPaths);

    // 7. 显示用户消息
    MessageRenderer.appendMessage('user', displayText, false, '', '', attachmentPaths);
    scrollToBottom(document.getElementById('messages'));

    // 8. 保存用户消息
    SessionInteraction.saveUserMessage(session, displayText, attachmentPaths);

    // 9. 创建助手消息气泡
    const assistantEl = MessageRenderer.appendMessage('assistant', '', true, '', agentId || '');
    StreamRenderer.initStreamState(assistantEl ? assistantEl.querySelector('.bubble') : null);
    const st = StreamRenderer.getStreamState();

    if (this._activeChatCleanup) this._activeChatCleanup();

    const self = this;
    function cleanupChat() {
      self._activeChatCleanup = null;
      sendBtn.disabled = false;
    }
    this._activeChatCleanup = cleanupChat;

    // 10. 构建 API 消息
    const apiMessages = MessageBuilder.buildApiMessages(session, agentId, apiText, attachmentPaths);

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
          const finalText = st.text;
          StreamRenderer.endStreaming();
          self._lastRenderedContent = finalText || '';
          if (self._spawnDetected) {
            self._spawnDetected = false;
            self._scheduleAnnounceCheck(sessionId);
          }
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
      const agent = State.findAgent(agentId);
      return agent ? (agent.displayName || agent.name) : agentId;
    }
    return '';
  },

  handleAnnounceResult: function (messages, agentId, sessionId) {
    DebugTrace.log('handleAnnounceResult', { agentId: agentId, sessionId: sessionId || '', msgCount: messages ? messages.length : 0, interactionMode: State.interactionMode, streaming: State.streaming });
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
    if (lastMsg.content === this._lastRenderedContent) return;

    const resolvedAgentId = agentId || lastMsg.agentId || '';

    if (sessionId && sessionId !== State.currentSessionId) {
      DebugTrace.log('announce-route-to-other-session', { sessionId: sessionId, currentSessionId: State.currentSessionId });
      const targetSession = SessionStore.get(sessionId);
      if (targetSession) {
        // 合并到其他 session 的最后一条 assistant 消息
        SessionInteraction.updateLastAssistantMessage(targetSession, lastMsg.content);
        targetSession.updated_at = Date.now();
        SessionStore.save(targetSession);
        State.setState({ sessions: SessionStore.getList() });
      }
      return;
    }

    if (resolvedAgentId) { this._removeAgentProgress(resolvedAgentId); }
    else { this._removeAllProgress(); }

    // ⚠️ Fix 1: 不创建新气泡，更新最后一条 assistant 气泡的内容
    const updated = MessageRenderer.updateLastAssistantMessage(lastMsg.content, 'main');
    if (!updated) {
      // 没有最后一条 assistant 消息（首次），才创建新气泡
      MessageRenderer.appendMessage('assistant', lastMsg.content, false, '', 'main');
    }

    const session = SessionStore.get(State.currentSessionId);
    if (session) {
      // ⚠️ Fix 1: 合并到 session 数据中，不 push 新消息
      SessionInteraction.updateLastAssistantMessage(session, lastMsg.content);
      session.updated_at = Date.now();
      SessionStore.save(session);
    }

    scrollToBottom(document.getElementById('messages'), false);
    State.setState({ sessions: SessionStore.getList() });
    this._lastRenderedContent = lastMsg.content;
    // ⚠️ Fix 3: 按 sessionId 清理 timer
    if (sessionId && this._announceCheckTimers[sessionId]) {
      clearTimeout(this._announceCheckTimers[sessionId]);
      delete this._announceCheckTimers[sessionId];
    }
  },

  _scheduleAnnounceCheck: function (sessionId) {
    // ⚠️ Fix 3: 按 sessionId 区分，支持并发 spawn
    const sid = sessionId || State.currentSessionId || '_default';
    if (this._announceCheckTimers[sid]) return;
    const self = this;
    this._announceCheckTimers[sid] = setTimeout(function () {
      delete self._announceCheckTimers[sid];
      Api.fetchSessionMessages(sid, function (messages) {
        if (!messages || messages.length === 0) return;
        for (let i = messages.length - 1; i >= 0; i--) {
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
    const keys = Object.keys(progress);
    if (keys.length === 0) return;
    for (let i = 0; i < keys.length; i++) {
      const agentId = keys[i];
      const toolName = progress[agentId].toolName || '';
      this._showAgentProgress(agentId, toolName);
    }
  },

  handleSubagentDone: function (agentId, sessionId) {
    DebugTrace.log('handleSubagentDone', { agentId: agentId, sessionId: sessionId || '' });
    if (!agentId) return;
    // ⚠️ Fix 2: 不移除进度，改为"已完成"状态，等 announce-result 到达或新消息才清理
    const el = this._progressElements[agentId];
    if (el) {
      el.classList.add('done');
      const spinner = el.querySelector('.subagent-progress-spinner');
      if (spinner) spinner.textContent = '✓';
      const label = el.querySelector('.subagent-progress-label');
      if (label) label.textContent = '已完成';
    }
  },

  _showAgentProgress: function (agentId, toolName) {
    let el = this._progressElements[agentId];
    if (el) {
      const toolSpan = el.querySelector('.subagent-progress-tool');
      if (toolSpan && toolName) { toolSpan.textContent = toolName; }
      return;
    }

    const agent = State.findAgent(agentId);
    const name = agent ? (agent.displayName || agent.name) : agentId;

    el = document.createElement('div');
    el.className = 'subagent-progress-inline';
    el.innerHTML = '<span class="subagent-progress-spinner"></span>'
      + '<span class="subagent-progress-name">' + Utils.escapeHtml(name) + '</span>'
      + '<span class="subagent-progress-label">正在执行</span>'
      + (toolName ? '<span class="subagent-progress-tool">' + Utils.escapeHtml(toolName) + '</span>' : '');

    const inner = document.querySelector('.messages-inner');
    if (inner) inner.appendChild(el);

    this._progressElements[agentId] = el;
    scrollToBottom(document.getElementById('messages'), false);
  },

  _removeAgentProgress: function (agentId) {
    const el = this._progressElements[agentId];
    if (el) {
      el.remove();
      delete this._progressElements[agentId];
    }
  },

  _removeAllProgress: function () {
    for (const aid in this._progressElements) {
      if (this._progressElements[aid] && this._progressElements[aid].remove) {
        this._progressElements[aid].remove();
      }
    }
    this._progressElements = {};
  },
};
