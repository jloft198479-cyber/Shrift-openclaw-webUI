/**
 * interaction-bindings.js — 全局 UI 交互绑定
 *
 * 职责：绑定所有 DOM 事件监听器（按钮、快捷键、滚动、拖拽、拖放等）
 * 不包含业务逻辑，只做事件分发（调用 State.setState / SessionManager / ChatView 等）
 */

var InteractionBindings = {

  init: function () {
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

  _bindButtons: function () {
    document.getElementById('new-chat-btn')?.addEventListener('click', SessionManager.createSession);

    document.getElementById('new-agent-btn')?.addEventListener('click', function (e) {
      e.stopPropagation();
      State.setState({ activeModal: 'create-agent', editingAgent: null });
    });

    document.getElementById('filter-bar')?.addEventListener('click', function (e) {
      const btn = e.target.closest('.filter-btn');
      if (!btn || btn.classList.contains('active')) return;
      document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      State.setState({ filter: btn.dataset.filter || '' });
    });

    document.getElementById('restart-server-btn')?.addEventListener('click', async function () {
      if (!confirm('确定要重启服务器吗？')) return;
      try {
        const res = await fetch('/api/restart', { method: 'POST' });
        const data = await res.json();
        showToast(data.message || '服务器正在重启…', 3000, 'info');
        setTimeout(function () { location.reload(); }, 2500);
      } catch (err) {
        showToast('重启请求失败: ' + err.message, 3000, 'error');
      }
    });

    document.getElementById('attach-btn')?.addEventListener('click', function () {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', function () {
        if (fileInput.files.length > 0) {
          ChatView.handleFiles(Array.from(fileInput.files));
        }
        fileInput.remove();
      });
      document.body.appendChild(fileInput);
      fileInput.click();
    });

    document.getElementById('send-btn')?.addEventListener('click', function () {
      if (State.streaming) { ChatView.stopGeneration(); } else { ChatView.sendMessage(); }
    });
  },

  _bindInput: function () {
    const input = document.getElementById('input');
    input?.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (State.streaming) { ChatView.stopGeneration(); } else { ChatView.sendMessage(); }
      }
      if (e.key === 'Escape') {
        if (State.activeModal) State.setState({ activeModal: null, editingAgent: null });
      }
    });
    input?.addEventListener('input', autoResize);
    input?.addEventListener('input', onAgentMentionInput);
  },

  _bindShortcuts: function () {
    document.addEventListener('keydown', function (e) {
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
    let _scrollRaf = null;
    document.getElementById('messages')?.addEventListener('scroll', function () {
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
        if (overflow <= 60) {
          const btn = document.getElementById('scroll-bottom');
          if (btn) btn.style.display = 'none';
          State.setState({ userScrolledUp: false });
          return;
        }
        const threshold = overflow - 200;
        State.setState({ userScrolledUp: el.scrollTop < threshold });
        const btn = document.getElementById('scroll-bottom');
        if (btn) btn.style.display = el.scrollTop < threshold ? 'flex' : 'none';
      });
    });

    document.getElementById('scroll-bottom')?.addEventListener('click', function () {
      scrollToBottom(document.getElementById('messages'), true);
      document.getElementById('input')?.focus();
    });
  },

  _bindAgentSection: function () {
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
      if (_savedHeight > 80) {
        sec.style.height = _savedHeight + 'px';
        sec.classList.add('has-custom-height');
        const list = document.getElementById('agent-list');
        if (list) list.style.maxHeight = '';
      } else {
        sec.style.height = '';
        sec.classList.remove('has-custom-height');
        const list = document.getElementById('agent-list');
        if (list) list.style.maxHeight = 'min(240px, calc(100vh - 320px))';
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
      _startH = sec ? sec.offsetHeight : 200;
      document.body.classList.add('resizing-agent-section');
      document.addEventListener('mousemove', _onResizeMove);
      document.addEventListener('mouseup', _onResizeEnd);
      document.addEventListener('touchmove', _onResizeMove, { passive: false });
      document.addEventListener('touchend', _onResizeEnd);
    }

    function _onResizeMove(e) {
      if (!_resizing) return;
      e.preventDefault();
      const cy = e.clientY || (e.touches && e.touches[0].clientY);
      const delta = _startY - cy;
      const newH = Math.max(80, Math.min(_startH + delta, window.innerHeight * 0.7));
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
      if (sec && sec.offsetHeight >= 80) {
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
      _divider.addEventListener('mousedown', _onResizeStart);
      _divider.addEventListener('touchstart', _onResizeStart, { passive: false });
    }

    _initResizeDivider();
    _syncAgentSectionHeight();

    document.getElementById('agent-section-toggle')?.addEventListener('click', function (e) {
      if (e.target.closest('.icon-btn')) return;
      e.stopPropagation();
      _toggleAgentSection();
    });
    document.getElementById('agent-section-toggle')?.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _toggleAgentSection(); }
    });

    _syncAgentSectionCollapse();
  },

  _bindAgentList: function () {
    document.getElementById('agent-list')?.addEventListener('contextmenu', function (e) {
      const item = e.target.closest('.agent-item');
      if (!item) return;
      e.preventDefault();
      const btn = item.querySelector('.agent-menu-btn');
      if (btn) toggleAgentMenu(btn);
    });

    document.getElementById('agent-list')?.addEventListener('click', function (e) {
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
    document.getElementById('hamburger')?.addEventListener('click', function () {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebar-overlay').classList.toggle('open');
    });

    document.getElementById('sidebar-overlay')?.addEventListener('click', SessionManager.closeSidebar);

    const sidebar = document.getElementById('sidebar');
    const collapseBtn = document.getElementById('sidebar-collapse-btn');
    collapseBtn?.addEventListener('click', function () {
      sidebar.classList.toggle('collapsed');
      const isCollapsed = sidebar.classList.contains('collapsed');
      collapseBtn.textContent = isCollapsed ? '›' : '‹';
      collapseBtn.title = isCollapsed ? '展开侧边栏' : '折叠侧边栏';
    });
  },

  _bindDragDrop: function () {
    const inputArea = document.getElementById('input-area');
    const dropHint = document.querySelector('.drop-hint');

    let _dragCounter = 0;
    inputArea?.addEventListener('dragenter', function (e) {
      e.preventDefault();
      e.stopPropagation();
      _dragCounter++;
      inputArea.classList.add('drag-over');
      if (dropHint) dropHint.style.display = '';
    });

    inputArea?.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
    });

    inputArea?.addEventListener('dragleave', function (e) {
      e.preventDefault();
      e.stopPropagation();
      _dragCounter--;
      if (_dragCounter <= 0) {
        _dragCounter = 0;
        inputArea.classList.remove('drag-over');
        if (dropHint) dropHint.style.display = 'none';
      }
    });

    inputArea?.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      _dragCounter = 0;
      inputArea.classList.remove('drag-over');
      if (dropHint) dropHint.style.display = 'none';
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) ChatView.handleFiles(files);
    });

    document.getElementById('input')?.addEventListener('paste', function (e) {
      const items = Array.from(e.clipboardData.items);
      const files = items.filter(function (i) { return i.kind === 'file'; }).map(function (i) { return i.getAsFile(); }).filter(Boolean);
      if (files.length > 0) {
        e.preventDefault();
        ChatView.handleFiles(files);
      }
    });
  },

  _bindSessionList: function () {
    document.getElementById('session-list')?.addEventListener('click', function (e) {
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
    document.addEventListener('click', function (e) {
      if (e.target.closest('.menu-btn') || e.target.closest('.agent-menu-btn') || e.target.closest('.dropdown') || e.target.closest('.agent-dropdown')) return;
      closeAllMenus();
    });
  },

};
