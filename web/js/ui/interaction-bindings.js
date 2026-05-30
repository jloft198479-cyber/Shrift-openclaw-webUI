/**
 * interaction-bindings.js — 全局 UI 交互绑定
 *
 * 职责：绑定所有 DOM 事件监听器（按钮、快捷键、滚动、拖拽、拖放等）
 * 不包含业务逻辑，只做事件分发（调用 State.setState / SessionManager / ChatView 等）
 *
 * 支持清理：调用 InteractionBindings.destroy() 清理所有事件监听器
 */

const InteractionBindings = {
  /** 已绑定的事件处理器列表，用于清理 */
  _handlers: [],
  /** 已绑定的 State 订阅列表，用于清理 */
  _stateUnsubscribers: [],
  /** 是否已初始化 */
  _initialized: false,

  init: function () {
    if (this._initialized) return;
    this._initialized = true;

    InteractionBindings._bindButtons();
    InteractionBindings._bindInput();
    InteractionBindings._bindShortcuts();
    InteractionBindings._bindScrollDetection();
    InteractionBindings._bindAgentSection();
    InteractionBindings._bindAgentList();
    InteractionBindings._bindSidebar();
    InteractionBindings._bindDragDrop();
    InteractionBindings._bindSessionList();
    InteractionBindings._bindGlobalClicks();
  },

  /**
   * 清理所有事件监听器
   *
   * 调用此方法后，所有绑定的事件监听器将被移除
   * 可以重新调用 init() 重新绑定
   */
  destroy: function () {
    // 清理 DOM 事件监听器
    this._handlers.forEach(function (handler) {
      if (handler.element && handler.fn) {
        handler.element.removeEventListener(handler.event, handler.fn, handler.options);
      }
    });
    this._handlers = [];

    // 清理 State 订阅
    this._stateUnsubscribers.forEach(function (unsub) {
      if (typeof unsub === 'function') unsub();
    });
    this._stateUnsubscribers = [];

    this._initialized = false;
  },

  /**
   * 添加事件监听器并记录，便于清理
   * @param {Element} element - DOM 元素
   * @param {string} event - 事件名
   * @param {Function} fn - 事件处理函数
   * @param {Object} [options] - addEventListener 选项
   */
  _addListener: function (element, event, fn, options) {
    if (!element) return;
    element.addEventListener(event, fn, options);
    this._handlers.push({ element: element, event: event, fn: fn, options: options });
  },

  /**
   * 订阅 State 事件并记录，便于清理
   * @param {string} event - 事件名
   * @param {Function} callback - 回调函数
   */
  _onState: function (event, callback) {
    const unsub = State.on(event, callback);
    this._stateUnsubscribers.push(unsub);
  },

  _bindButtons: function () {
    const self = this;

    const newChatBtn = document.getElementById('new-chat-btn');
    self._addListener(newChatBtn, 'click', SessionManager.createSession);

    const newAgentBtn = document.getElementById('new-agent-btn');
    self._addListener(newAgentBtn, 'click', function (e) {
      e.stopPropagation();
      State.setState({ activeModal: 'create-agent', editingAgent: null });
    });

    const filterBar = document.getElementById('filter-bar');
    self._addListener(filterBar, 'click', function (e) {
      const btn = e.target.closest('.filter-btn');
      if (!btn || btn.classList.contains('active')) return;
      document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      State.setState({ filter: btn.dataset.filter || '' });
    });

    const restartBtn = document.getElementById('restart-server-btn');
    self._addListener(restartBtn, 'click', async function () {
      if (!confirm('确定要重启服务器吗？')) return;
      try {
        const res = await fetch('/api/restart', { method: 'POST' });
        const data = await res.json();
        showToast(data.message || '服务器正在重启…', Constants.TIMEOUT.TOAST_INFO, 'info');
        setTimeout(function () { location.reload(); }, Constants.TIMEOUT.RESTART_REFRESH_DELAY);
      } catch (err) {
        showToast('重启请求失败: ' + err.message, Constants.TIMEOUT.TOAST_ERROR, 'error');
      }
    });

    const attachBtn = document.getElementById('attach-btn');
    self._addListener(attachBtn, 'click', function () {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      fileInput.style.display = 'none';
      self._addListener(fileInput, 'change', function () {
        if (fileInput.files.length > 0) {
          ChatView.handleFiles(Array.from(fileInput.files));
        }
        fileInput.remove();
      });
      document.body.appendChild(fileInput);
      fileInput.click();
    });

    const sendBtn = document.getElementById('send-btn');
    self._addListener(sendBtn, 'click', function () {
      if (State.streaming) { ChatView.stopGeneration(); } else { ChatView.sendMessage(); }
    });
  },

  _bindInput: function () {
    const self = this;
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const charCount = document.getElementById('char-count');

    function _updateInputState() {
      const len = input.value.length;
      const hasContent = len > 0 || AttachmentBar.pendingAttachments.length > 0;
      const isStreaming = State.streaming;
      if (sendBtn) sendBtn.disabled = !hasContent && !isStreaming;
      if (charCount) {
        if (len > Constants.LIMIT.MAX_CHARS * Constants.LIMIT.CHAR_COUNT_SHOW_RATIO) {
          charCount.classList.add('visible');
          charCount.textContent = len + ' / ' + Constants.LIMIT.MAX_CHARS;
          charCount.classList.toggle('near-limit', len > Constants.LIMIT.MAX_CHARS * Constants.LIMIT.CHAR_COUNT_WARN_RATIO);
        } else {
          charCount.classList.remove('visible');
          charCount.textContent = '';
        }
      }
    }

    self._addListener(input, 'keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (State.streaming) { ChatView.stopGeneration(); } else { ChatView.sendMessage(); }
      }
      if (e.key === 'Escape') {
        if (State.activeModal) State.setState({ activeModal: null, editingAgent: null });
      }
    });
    self._addListener(input, 'input', autoResize);
    self._addListener(input, 'input', onAgentMentionInput);
    self._addListener(input, 'input', _updateInputState);
    self._onState('streaming', _updateInputState);
    _updateInputState();
  },

  _bindShortcuts: function () {
    const self = this;
    self._addListener(document, 'keydown', function (e) {
      const tag = e.target?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key === 'n' && !e.shiftKey) {
        e.preventDefault();
        if (!isInput) SessionManager.createSession();
      }
      if (mod && e.key === 'n' && e.shiftKey) {
        e.preventDefault();
        State.setState({ activeModal: 'create-agent' });
      }
      if (mod && e.key === '/') {
        e.preventDefault();
        if (!isInput) { const inp = document.getElementById('input'); if (inp) inp.focus(); }
      }
    });
  },

  _bindScrollDetection: function () {
    const self = this;
    let _scrollRaf = null;
    const messagesEl = document.getElementById('messages');
    self._addListener(messagesEl, 'scroll', function () {
      if (_scrollRaf) return;
      _scrollRaf = requestAnimationFrame(function () {
        _scrollRaf = null;
        const el = document.getElementById('messages');
        if (!el) return;
        const hasContent = el.querySelector('.message');
        if (!hasContent) {
          const btn = document.getElementById('scroll-bottom');
          if (btn) btn.style.display = 'none';
          return;
        }
        const overflow = el.scrollHeight - el.clientHeight;
        if (overflow <= Constants.SIZE.SCROLL_OVERFLOW_THRESHOLD) {
          const btn = document.getElementById('scroll-bottom');
          if (btn) btn.style.display = 'none';
          State.setState({ userScrolledUp: false });
          return;
        }
        const threshold = overflow - Constants.SIZE.SCROLL_UP_THRESHOLD;
        State.setState({ userScrolledUp: el.scrollTop < threshold });
        const btn = document.getElementById('scroll-bottom');
        if (btn) btn.style.display = el.scrollTop < threshold ? 'flex' : 'none';
      });
    });

    const scrollBottomBtn = document.getElementById('scroll-bottom');
    self._addListener(scrollBottomBtn, 'click', function () {
      scrollToBottom(document.getElementById('messages'), true);
      document.getElementById('input')?.focus();
    });
  },

  _bindAgentSection: function () {
    const self = this;
    let _agentSectionCollapsed = localStorage.getItem('agentSectionCollapsed') !== '0';
    function _syncAgentSectionCollapse() {
      const sec = document.getElementById('agent-section');
      if (!sec) return;
      if (_agentSectionCollapsed) {
        sec.classList.add('collapsed');
      } else {
        sec.classList.remove('collapsed');
      }
    }
    function _toggleAgentSection() {
      _agentSectionCollapsed = !_agentSectionCollapsed;
      localStorage.setItem('agentSectionCollapsed', _agentSectionCollapsed ? '1' : '0');
      _syncAgentSectionCollapse();
    }

    let _savedHeight = parseFloat(localStorage.getItem('agentSectionHeight')) || 0;
    function _syncAgentSectionHeight() {
      const sec = document.getElementById('agent-section');
      if (!sec) return;
      if (_savedHeight > Constants.SIZE.AGENT_MIN_HEIGHT) {
        sec.style.height = _savedHeight + 'px';
        sec.classList.add('has-custom-height');
        const list = document.getElementById('agent-list');
        if (list) list.style.maxHeight = '';
      } else {
        sec.style.height = '';
        sec.classList.remove('has-custom-height');
        const list = document.getElementById('agent-list');
        if (list) list.style.maxHeight = 'min(' + Constants.SIZE.AGENT_LIST_MAX_HEIGHT + 'px, calc(100vh - ' + Constants.SIZE.AGENT_LIST_HEIGHT_OFFSET + 'px))';
      }
    }

    let _divider = null;
    let _resizing = false;
    let _startY = 0;
    let _startH = 0;

    function _onResizeStart(e) {
      e.preventDefault();
      _resizing = true;
      _startY = e.clientY || (e.touches && e.touches[0].clientY);
      const sec = document.getElementById('agent-section');
      _startH = sec ? sec.offsetHeight : Constants.SIZE.AGENT_DEFAULT_HEIGHT;
      document.body.classList.add('resizing-agent-section');
      self._addListener(document, 'mousemove', _onResizeMove);
      self._addListener(document, 'mouseup', _onResizeEnd);
      self._addListener(document, 'touchmove', _onResizeMove, { passive: false });
      self._addListener(document, 'touchend', _onResizeEnd);
    }

    function _onResizeMove(e) {
      if (!_resizing) return;
      e.preventDefault();
      const cy = e.clientY || (e.touches && e.touches[0].clientY);
      const delta = _startY - cy;
      const newH = Math.max(Constants.SIZE.AGENT_MIN_HEIGHT, Math.min(_startH + delta, window.innerHeight * Constants.SIZE.AGENT_MAX_HEIGHT_RATIO));
      const sec = document.getElementById('agent-section');
      if (!sec) return;
      sec.style.height = newH + 'px';
      sec.classList.add('has-custom-height');
      const list = document.getElementById('agent-list');
      if (list) list.style.maxHeight = '';
    }

    function _onResizeEnd() {
      if (!_resizing) return;
      _resizing = false;
      document.body.classList.remove('resizing-agent-section');
      document.removeEventListener('mousemove', _onResizeMove);
      document.removeEventListener('mouseup', _onResizeEnd);
      document.removeEventListener('touchmove', _onResizeMove);
      document.removeEventListener('touchend', _onResizeEnd);
      const sec = document.getElementById('agent-section');
      if (sec && sec.offsetHeight >= Constants.SIZE.AGENT_MIN_HEIGHT) {
        _savedHeight = sec.offsetHeight;
        localStorage.setItem('agentSectionHeight', _savedHeight);
      }
    }

    function _initResizeDivider() {
      const sec = document.getElementById('agent-section');
      if (!sec) return;
      if (_divider) { _divider.remove(); _divider = null; }
      _divider = document.createElement('div');
      _divider.className = 'agent-resize-divider';
      _divider.title = '上下拖动调整高度';
      sec.parentNode.insertBefore(_divider, sec);
      self._addListener(_divider, 'mousedown', _onResizeStart);
      self._addListener(_divider, 'touchstart', _onResizeStart, { passive: false });
    }

    _initResizeDivider();
    _syncAgentSectionHeight();

    const agentSectionToggle = document.getElementById('agent-section-toggle');
    self._addListener(agentSectionToggle, 'click', function (e) {
      if (e.target.closest('.icon-btn')) return;
      e.stopPropagation();
      _toggleAgentSection();
    });
    self._addListener(agentSectionToggle, 'keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _toggleAgentSection(); }
    });

    _syncAgentSectionCollapse();
  },

  _bindAgentList: function () {
    const self = this;
    const agentList = document.getElementById('agent-list');

    self._addListener(agentList, 'contextmenu', function (e) {
      const item = e.target.closest('.agent-item');
      if (!item) return;
      e.preventDefault();
      const btn = item.querySelector('.agent-menu-btn');
      if (btn) toggleAgentMenu(btn);
    });

    self._addListener(agentList, 'click', function (e) {
      const menuBtn = e.target.closest('.agent-menu-btn');
      if (menuBtn) {
        e.stopPropagation();
        toggleAgentMenu(menuBtn);
        return;
      }

      const editBtn = e.target.closest('[data-agent-edit]');
      if (editBtn) {
        e.stopPropagation();
        const agentId = editBtn.dataset.agentEdit;
        if (agentId) State.setState({ activeModal: 'edit-agent', editingAgent: agentId });
        return;
      }

      const item = e.target.closest('.agent-item');
      if (item) {
        const agentId = item.dataset.agent;
        if (agentId) State.setState({ activeModal: 'edit-agent', editingAgent: agentId });
      }
    });
  },

  _bindSidebar: function () {
    const self = this;
    const hamburger = document.getElementById('hamburger');
    self._addListener(hamburger, 'click', function () {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebar-overlay').classList.toggle('open');
    });

    const sidebarOverlay = document.getElementById('sidebar-overlay');
    self._addListener(sidebarOverlay, 'click', SessionManager.closeSidebar);

    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      const handle = document.createElement('div');
      handle.id = 'sidebar-resize-handle';
      sidebar.appendChild(handle);

      let isResizing = false;
      let startX = 0;
      let startWidth = 0;

      self._addListener(handle, 'mousedown', function (e) {
        isResizing = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
      });
      self._addListener(document, 'mousemove', function (e) {
        if (!isResizing) return;
        const newWidth = Math.max(Constants.SIZE.SIDEBAR_MIN_WIDTH, Math.min(Constants.SIZE.SIDEBAR_MAX_WIDTH, startWidth + e.clientX - startX));
        sidebar.style.width = newWidth + 'px';
        sidebar.style.minWidth = newWidth + 'px';
      });
      self._addListener(document, 'mouseup', function () {
        if (!isResizing) return;
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      });
    }
  },

  _bindDragDrop: function () {
    const self = this;
    const inputArea = document.getElementById('input-area');
    const dropHint = document.querySelector('.drop-hint');

    let _dragCounter = 0;
    self._addListener(inputArea, 'dragenter', function (e) {
      e.preventDefault();
      e.stopPropagation();
      _dragCounter++;
      inputArea.classList.add('drag-over');
      if (dropHint) dropHint.style.display = '';
    });

    self._addListener(inputArea, 'dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
    });

    self._addListener(inputArea, 'dragleave', function (e) {
      e.preventDefault();
      e.stopPropagation();
      _dragCounter--;
      if (_dragCounter <= 0) {
        _dragCounter = 0;
        inputArea.classList.remove('drag-over');
        if (dropHint) dropHint.style.display = 'none';
      }
    });

    self._addListener(inputArea, 'drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      _dragCounter = 0;
      inputArea.classList.remove('drag-over');
      if (dropHint) dropHint.style.display = 'none';
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) ChatView.handleFiles(files);
    });

    const input = document.getElementById('input');
    self._addListener(input, 'paste', function (e) {
      const items = Array.from(e.clipboardData.items);
      const files = items.filter(function (i) { return i.kind === 'file'; }).map(function (i) { return i.getAsFile(); }).filter(Boolean);
      if (files.length > 0) {
        e.preventDefault();
        ChatView.handleFiles(files);
      }
    });
  },

  _bindSessionList: function () {
    const self = this;
    const sessionList = document.getElementById('session-list');
    self._addListener(sessionList, 'click', function (e) {
      const menuBtn = e.target.closest('.menu-btn');
      if (menuBtn) {
        e.stopPropagation();
        toggleMenu(menuBtn);
        return;
      }
      if (e.target.closest('.dropdown')) return;

      closeAllMenus();

      const item = e.target.closest('.session-item');
      if (!item) return;
      const id = item.dataset.id;
      if (id && id !== State.currentSessionId) SessionManager.selectSession(id);
      SessionManager.closeSidebar();
    });
  },

  _bindGlobalClicks: function () {
    const self = this;
    self._addListener(document, 'click', function (e) {
      if (e.target.closest('.menu-btn') || e.target.closest('.agent-menu-btn') || e.target.closest('.dropdown') || e.target.closest('.agent-dropdown')) return;
      closeAllMenus();
    });
  },

};
