/* ── stream-renderer.js — 流式渲染 + 停止/重置按钮 ────── */

const StreamRenderer = {
  _streamState: null,
  _rafId: null,

  init: function () {
    this._streamState = { text: '', thinking: '', bubble: null, began: false, think: false, preparing: false };
  },

  getStreamState: function () {
    return this._streamState;
  },

  setStreamState: function (partial) {
    Object.assign(this._streamState, partial);
  },

  resetStreamState: function () {
    this._streamState = { text: '', thinking: '', bubble: null, began: false, think: false, preparing: false };
  },

  initStreamState: function (bubbleEl) {
    this._streamState = {
      bubble: bubbleEl,
      began: false,
      text: '',
      thinking: '',
      think: false,
      _thinkBlock: null,
      preparing: true,
    };
    this.scheduleRender();
  },

  /**
   * 根据当前 streamState 渲染气泡内容（增量更新）
   */
  renderBubble: function () {
    const st = this._streamState;
    if (!st.bubble) return;

    // 思考块
    if (st.thinking && !st._thinkBlock) {
      const tb = document.createElement('div');
      tb.className = 'thinking-block';
      tb.innerHTML = '<div class="thinking-toggle" onclick="this.nextElementSibling.classList.toggle(\'open\')">💭 思考中…</div>'
        + '<div class="thinking-content">' + escapeHtml(st.thinking) + '</div>';
      let contentEl = st.bubble.querySelector('.agent-content');
      if (contentEl) {
        st.bubble.insertBefore(tb, contentEl);
      } else {
        st.bubble.appendChild(tb);
      }
      st._thinkBlock = tb;
    } else if (st.thinking && st._thinkBlock) {
      const thinkContent = st._thinkBlock.querySelector('.thinking-content');
      if (thinkContent) thinkContent.textContent = st.thinking;
    }

    // 内容块
    if (st.text !== undefined) {
      let contentEl = st.bubble.querySelector('.agent-content');
      if (!contentEl) {
        contentEl = document.createElement('div');
        contentEl.className = 'agent-content';
        st.bubble.appendChild(contentEl);
      }
      if (st.text) {
        contentEl.innerHTML = renderMarkdown(st.text, true); // 流式期间不写缓存
      } else if (st.preparing) {
        contentEl.innerHTML = '<div class="preparing-indicator"><span class="preparing-dot"></span><span class="preparing-dot"></span><span class="preparing-dot"></span> 正在准备…</div>';
      } else {
        contentEl.innerHTML = '';
      }
    }
  },

  /**
   * 请求一帧渲染（去重，用 rAF 合并 + debounce 50ms）
   */
  scheduleRender: function () {
    if (this._rafId) return;
    const self = this;
    this._rafId = requestAnimationFrame(function () {
      self._rafId = null;
      clearTimeout(self._debounceTimer);
      self._debounceTimer = setTimeout(function () {
        self.renderBubble();
      }, 50);
    });
  },

  /**
   * 开始流：唯一入口，清残留后启动
   */
  beginStreaming: function (cleanupFn) {
    if (State.streaming) { this.endStreaming(); }
    if (ChatController._activeChatCleanup) {
      ChatController._activeChatCleanup();
      ChatController._activeChatCleanup = null;
    }
    State.setState({ streaming: true });
    this.showStopBtn();
    const ti = document.getElementById('thinking-indicator');
    if (ti) ti.style.display = 'flex';
    this._pendingCleanup = cleanupFn || null;
  },
  endStreaming: function (skipCleanup) {
    const st = this._streamState;

    // 最终渲染：写入缓存
    if (st && st.text && st.bubble) {
      const contentEl = st.bubble.querySelector('.agent-content');
      if (contentEl) {
        contentEl.innerHTML = renderMarkdown(st.text, false);
      }
    }

    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    if (!skipCleanup && this._pendingCleanup) {
      this._pendingCleanup();
      this._pendingCleanup = null;
    }

    State.setState({ streaming: false });
    // dispatching 期间保留 cancel 按钮，不重置为 send
    if (!State.dispatching) {
      this._resetSendBtn();
    }

    const thinkInd = document.getElementById('thinking-indicator');
    if (thinkInd) thinkInd.style.display = 'none';
    const input = document.getElementById('input');
    if (input) input.focus();

    if (st && st.bubble) {
      st.bubble.classList.remove('streaming-cursor');
      if (st._thinkBlock) {
        const toggle = st._thinkBlock.querySelector('.thinking-toggle');
        if (toggle) toggle.textContent = '💭 已深度思考';
      }
      // 流式结束后给气泡添加操作按钮（在 resetStreamState 之前，st 仍引用旧对象）
      if (st.bubble.querySelector('.agent-content') && !st.bubble.querySelector('.msg-actions')) {
        const actions = document.createElement('div');
        actions.className = 'msg-actions';
        actions.innerHTML = '<button class="msg-act-btn" data-action="copy" title="复制">📋</button>';
        st.bubble.appendChild(actions);
      }
    }

    this.resetStreamState();
  },

  /**
   * 停止生成
   */
  stopGeneration: function () {
    if (!State.streaming) return;
    Api.stopGeneration();  // handles both HTTP SSE and WS
    this.endStreaming();
  },

  showStopBtn: function () {
    const btn = document.getElementById('send-btn');
    if (!btn) return;
    btn.disabled = false;
    btn.classList.add('is-stop');
    btn.setAttribute('aria-label', '停止生成');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  },

  /**
   * dispatch 模式下显示取消按钮（send-btn 变为 × cancel 样式）
   */
  showCancelBtn: function () {
    const btn = document.getElementById('send-btn');
    if (!btn) return;
    btn.disabled = false;
    btn.classList.add('is-cancel');
    btn.classList.remove('is-stop');
    btn.setAttribute('aria-label', '取消调度');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  },

  _resetSendBtn: function () {
    const btn = document.getElementById('send-btn');
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove('is-stop');
    btn.classList.remove('is-cancel');
    btn.setAttribute('aria-label', '发送');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  },
};
