/**
 * interaction-bindings.js — 全局 UI 交互绑定
 *
 * 职责：绑定所有 DOM 事件监听器（按钮、快捷键、滚动、拖拽、拖放等）
 * 不包含业务逻辑，只做事件分发（调用 State.setState / SessionManager / ChatView 等）
 *
 * 支持清理：调用 InteractionBindings.destroy() 清理所有事件监听器
 */

var InteractionBindings = {
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
    var unsub = State.on(event, callback);
    this._stateUnsubscribers.push(unsub);
  },

  _bindButtons: function () {
    var self = this;

    var newChatBtn = document.getElementById('new-chat-btn');
    self._addListener(newChatBtn, 'click', SessionManager.createSession);

    var newAgentBtn = document.getElementById('new-agent-btn');
    self._addListener(newAgentBtn, 'click', function (e) {
      e.stopPropagation();
      State.setState({ activeModal: 'create-agent', editingAgent: null });
    });

    var filterBar = document.getElementById('filter-bar');
    self._addListener(filterBar, 'click', function (e) {
      var btn = e.target.closest('.filter-btn');
      if (!btn || btn.classList.contains('active')) return;
      document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      State.setState({ filter: btn.dataset.filter || '' });
    });

    var restartBtn = document.getElementById('restart-server-btn');
    self._addListener(restartBtn, 'click', async function () {
      if (!confirm('确定要重启服务器吗？')) return;
      try {
        var res = await fetch('/api/restart', { method: 'POST' });
        var data = await res.json();
        showToast(data.message || '服务器正在重启…', Constants.TIMEOUT.TOAST_INFO, 'info');
        setTimeout(function () { location.reload(); }, Constants.TIMEOUT.RESTART_REFRESH_DELAY);
      } catch (err) {
        showToast('重启请求失败: ' + err.message, Constants.TIMEOUT.TOAST_ERROR, 'error');
      }
    });

    var attachBtn = document.getElementById('attach-btn');
    self._addListener(attachBtn, 'click', function () {
      var fileInput = document.createElement('input');
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

    var sendBtn = document.getElementById('send-btn');
    self._addListener(sendBtn, 'click', function () {
      if (State.streaming) { ChatView.stopGeneration(); } else { ChatView.sendMessage(); }
    });
  },

  _bindInput: function () {
    var self = this;
    var input = document.getElementById('input');
    var sendBtn = document.getElementById('send-btn');
    var charCount = document.getElementById('char-count');

    function _updateInputState() {
      var len = input.value.length;
      var hasContent = len > 0 || AttachmentBar.pendingAttachments.length > 0;
      var isStreaming = State.streaming;
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
    var self = this;
    self._addListener(document, 'keydown', function (e) {
      var tag = e.target?.tagName;
      var isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      var mod = e.ctrlKey || e.metaKey;

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
        if (!isInput) { var inp = document.getElementById('input'); if (inp) inp.focus(); }
      }
    });
  },

  _bindScrollDetection: function () {
    var self = this;
    var _scrollRaf = null;
    var messagesEl = document.getElementById('messages');
    self._addListener(messagesEl, 'scroll', function () {
      if (_scrollRaf) return;
      _scrollRaf = requestAnimationFrame(function () {
        _scrollRaf = null;
        var el = document.getElementById('messages');
        if (!el) return;
        var hasContent = el.querySelector('.message');
        if (!hasContent) {
          var btn = document.getElementById('scroll-bottom');
          if (btn) btn.style.display = 'none';
          return;
        }
        var overflow = el.scrollHeight - el.clientHeight;
        if (overflow <= Constants.SIZE.SCROLL_OVERFLOW_THRESHOLD) {
          var btn = document.getElementById('scroll-bottom');
          if (btn) btn.style.display = 'none';
          State.setState({ userScrolledUp: false });
          return;
        }
        var threshold = overflow - Constants.SIZE.SCROLL_UP_THRESHOLD;
        State.setState({ userScrolledUp: el.scrollTop < threshold });
        var btn = document.getElementById('scroll-bottom');
        if (btn) btn.style.display = el.scrollTop < threshold ? 'flex' : 'none';
      });
    });

    var scrollBottomBtn = document.getElementById('scroll-bottom');
    self._addListener(scrollBottomBtn, 'click', function () {
      scrollToBottom(document.getElementById('messages'), true);
      document.getElementById('input')?.focus();
    });
  },

  _bindAgentSection: function () {
    var self = this;
    var _agentSectionCollapsed = localStorage.getItem('agentSectionCollapsed') !== '0';
    function _syncAgentSectionCollapse() {
      var sec = document.getElementById('agent-section');
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

    var _savedHeight = parseFloat(localStorage.getItem('agentSectionHeight')) || 0;
    function _syncAgentSectionHeight() {
      var sec = document.getElementById('agent-section');
      if (!sec) return;
      if (_savedHeight > Constants.SIZE.AGENT_MIN_HEIGHT) {
        sec.style.height = _savedHeight + 'px';
        sec.classList.add('has-custom-height');
        var list = document.getElementById('agent-list');
        if (list) list.style.maxHeight = '';
      } else {
        sec.style.height = '';
        sec.classList.remove('has-custom-height');
        var list = document.getElementById('agent-list');
        if (list) list.style.maxHeight = 'min(' + Constants.SIZE.AGENT_LIST_MAX_HEIGHT + 'px, calc(100vh - ' + Constants.SIZE.AGENT_LIST_HEIGHT_OFFSET + 'px))';
      }
    }

    var _divider = null;
    var _resizing = false;
    var _startY = 0;
    var _startH = 0;

    function _onResizeStart(e) {
      e.preventDefault();
      _resizing = true;
      _startY = e.clientY || (e.touches && e.touches[0].clientY);
      var sec = document.getElementById('agent-section');
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
      var cy = e.clientY || (e.touches && e.touches[0].clientY);
      var delta = _startY - cy;
      var newH = Math.max(Constants.SIZE.AGENT_MIN_HEIGHT, Math.min(_startH + delta, window.innerHeight * Constants.SIZE.AGENT_MAX_HEIGHT_RATIO));
      var sec = document.getElementById('agent-section');
      if (!sec) return;
      sec.style.height = newH + 'px';
      sec.classList.add('has-custom-height');
      var list = document.getElementById('agent-list');
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
      var sec = document.getElementById('agent-section');
      if (sec && sec.offsetHeight >= Constants.SIZE.AGENT_MIN_HEIGHT) {
        _savedHeight = sec.offsetHeight;
        localStorage.setItem('agentSectionHeight', _savedHeight);
      }
    }

    function _initResizeDivider() {
      var sec = document.getElementById('agent-section');
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

    var agentSectionToggle = document.getElementById('agent-section-toggle');
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
    var self = this;
    var agentList = document.getElementById('agent-list');

    self._addListener(agentList, 'contextmenu', function (e) {
      var item = e.target.closest('.agent-item');
      if (!item) return;
      e.preventDefault();
      var btn = item.querySelector('.agent-menu-btn');
      if (btn) toggleAgentMenu(btn);
    });

    self._addListener(agentList, 'click', function (e) {
      var menuBtn = e.target.closest('.agent-menu-btn');
      if (menuBtn) {
        e.stopPropagation();
        toggleAgentMenu(menuBtn);
        return;
      }

      var editBtn = e.target.closest('[data-agent-edit]');
      if (editBtn) {
        e.stopPropagation();
        var agentId = editBtn.dataset.agentEdit;
        if (agentId) State.setState({ activeModal: 'edit-agent', editingAgent: agentId });
        return;
      }

      var item = e.target.closest('.agent-item');
      if (item) {
        var agentId = item.dataset.agent;
        if (agentId) State.setState({ activeModal: 'edit-agent', editingAgent: agentId });
      }
    });
  },

  _bindSidebar: function () {
    var self = this;
    var hamburger = document.getElementById('hamburger');
    self._addListener(hamburger, 'click', function () {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebar-overlay').classList.toggle('open');
    });

    var sidebarOverlay = document.getElementById('sidebar-overlay');
    self._addListener(sidebarOverlay, 'click', SessionManager.closeSidebar);

    var sidebar = document.getElementById('sidebar');
    if (sidebar) {
      var handle = document.createElement('div');
      handle.id = 'sidebar-resize-handle';
      sidebar.appendChild(handle);

      var isResizing = false;
      var startX = 0;
      var startWidth = 0;

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
        var newWidth = Math.max(Constants.SIZE.SIDEBAR_MIN_WIDTH, Math.min(Constants.SIZE.SIDEBAR_MAX_WIDTH, startWidth + e.clientX - startX));
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
    var self = this;
    var inputArea = document.getElementById('input-area');
    var dropHint = document.querySelector('.drop-hint');

    var _dragCounter = 0;
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
      var files = Array.from(e.dataTransfer.files);
      if (files.length > 0) ChatView.handleFiles(files);
    });

    var input = document.getElementById('input');
    self._addListener(input, 'paste', function (e) {
      var items = Array.from(e.clipboardData.items);
      var files = items.filter(function (i) { return i.kind === 'file'; }).map(function (i) { return i.getAsFile(); }).filter(Boolean);
      if (files.length > 0) {
        e.preventDefault();
        ChatView.handleFiles(files);
      }
    });
  },

  _bindSessionList: function () {
    var self = this;
    var sessionList = document.getElementById('session-list');
    self._addListener(sessionList, 'click', function (e) {
      var menuBtn = e.target.closest('.menu-btn');
      if (menuBtn) {
        e.stopPropagation();
        toggleMenu(menuBtn);
        return;
      }
      if (e.target.closest('.dropdown')) return;

      closeAllMenus();

      var item = e.target.closest('.session-item');
      if (!item) return;
      var id = item.dataset.id;
      if (id && id !== State.currentSessionId) SessionManager.selectSession(id);
      SessionManager.closeSidebar();
    });
  },

  _bindGlobalClicks: function () {
    var self = this;
    self._addListener(document, 'click', function (e) {
      if (e.target.closest('.menu-btn') || e.target.closest('.agent-menu-btn') || e.target.closest('.dropdown') || e.target.closest('.agent-dropdown')) return;
      closeAllMenus();
    });
  },

};
