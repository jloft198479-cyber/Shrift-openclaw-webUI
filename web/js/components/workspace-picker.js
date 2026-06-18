/* ── workspace-picker.js — 工作目录选择 UI ────── */

var WorkspacePicker = {
  _panel: null,

  toggle: function () {
    if (this._panel) { this.hide(); return; }
    this.show();
  },

  show: function () {
    if (this._panel) return;
    var bar = document.querySelector('.model-bar');
    if (!bar) return;

    var panel = document.createElement('div');
    panel.className = 'workspace-panel';
    panel.innerHTML = this._renderPanel();
    bar.appendChild(panel);
    this._panel = panel;

    this._bindEvents();
  },

  hide: function () {
    if (this._panel) {
      document.removeEventListener('click', this._outsideClickHandler);
      this._panel.remove();
      this._panel = null;
    }
  },

  _renderPanel: function () {
    var ws = State.workspace;
    var currentPath = ws.path || '';
    var html = '';
    html += '<div class="ws-panel-row">';
    html += '<input type="text" class="ws-path-input" placeholder="输入或粘贴目录路径，如 D:\\projects\\myapp" value="' + escapeHtml(currentPath) + '">';
    html += '</div>';
    html += '<div class="ws-panel-actions">';
    html += '<button class="ws-confirm-btn">确认</button>';
    if (currentPath) {
      html += '<button class="ws-clear-btn">清除</button>';
    }
    html += '</div>';
    return html;
  },

  _bindEvents: function () {
    var self = this;
    var panel = this._panel;
    if (!panel) return;

    // 确认按钮
    var confirmBtn = panel.querySelector('.ws-confirm-btn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () { self._onConfirm(); });
    }

    // 清除按钮
    var clearBtn = panel.querySelector('.ws-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () { self._onClear(); });
    }

    // 输入框回车确认
    var input = panel.querySelector('.ws-path-input');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); self._onConfirm(); }
      });
    }

    // 点击面板外关闭
    setTimeout(function () {
      document.addEventListener('click', self._outsideClickHandler);
    }, 0);
  },

  _outsideClickHandler: function (e) {
    var panel = WorkspacePicker._panel;
    if (!panel) return;
    if (panel.contains(e.target)) return;
    var indicator = e.target.closest('.workspace-indicator');
    if (indicator) return;
    WorkspacePicker.hide();
  },

  _onConfirm: function () {
    var input = this._panel.querySelector('.ws-path-input');
    if (!input) return;
    var path = input.value.trim();
    if (!path) {
      showToast('请输入目录路径', 3000, 'error');
      return;
    }
    var self = this;
    Api.setWorkspace(path).then(function (result) {
      if (result.success) {
        State.setState({ workspace: { path: result.path, exists: true } });
        // per-session：把当前 workspace 写入当前会话，切换回来时自动恢复
        SessionInteraction.updateWorkspace(State.currentSessionId, result.path);
        showToast('已绑定到当前会话', 3000);
        self.hide();
      } else {
        showToast(result.reason || '设置失败', 3000, 'error');
      }
    }).catch(function (err) {
      showToast('设置失败: ' + (err.message || ''), 3000, 'error');
    });
  },

  _onClear: function () {
    var self = this;
    Api.clearWorkspace().then(function (result) {
      if (result.success) {
        State.setState({ workspace: { path: '', exists: false } });
        // per-session：清除当前会话的 workspace 绑定
        SessionInteraction.updateWorkspace(State.currentSessionId, '');
        showToast('已解除当前会话的工作目录绑定', 2000);
        self.hide();
      }
    }).catch(function (err) {
      showToast('清除失败: ' + (err.message || ''), 3000, 'error');
    });
  },
};
