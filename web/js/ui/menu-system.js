/**
 * 会话三点菜单
 * 功能：内联重命名、标记/取消待办、导出、删除
 */
function toggleMenu(btn) {
  closeAllMenus();
  const id = btn.dataset.menu;
  if (!id) return;

  // 查找 session（修复原 const session=null 不可重赋值 bug）
  const sessions = State.sessions;
  let session = null;
  for (let i = 0; i < sessions.length; i++) {
    if (sessions[i].id === id) { session = sessions[i]; break; }
  }
  const tag = session ? session.tag : '';
  const sessionName = session ? session.name : '新对话';

  const dd = document.createElement('div');
  dd.className = 'dropdown open';
  dd.innerHTML = ''
    + '<button class="dropdown-item" data-action="rename" data-id="' + escapeHtml(id) + '">✏️ 重命名</button>'
    + '<button class="dropdown-item" data-action="' + (tag === 'pending' ? 'unpending' : 'pending') + '" data-id="' + escapeHtml(id) + '">' + (tag === 'pending' ? '✅ 取消待办' : '📋 标记待办') + '</button>'
    + '<div class="dropdown-divider"></div>'
    + '<button class="dropdown-item" data-action="export" data-id="' + escapeHtml(id) + '">📥 导出</button>'
    + '<div class="dropdown-divider"></div>'
    + '<button class="dropdown-item danger" data-action="delete" data-id="' + escapeHtml(id) + '">🗑 删除</button>';

  _positionDropdown(dd, btn);

  dd.addEventListener('click', function (e) {
    const actionBtn = e.target.closest('.dropdown-item');
    if (!actionBtn) return;
    const action = actionBtn.dataset.action;
    const sid = actionBtn.dataset.id;

    if (action === 'delete') {
      SessionManager.deleteSession(sid, e);
    } else if (action === 'export') {
      SessionManager.exportSession(sid);
    } else if (action === 'rename') {
      _startInlineRename(sid, sessionName);
    } else if (action === 'pending' || action === 'unpending') {
      const s = SessionStore.get(sid);
      if (s) {
        if (action === 'pending') s.tag = 'pending'; else delete s.tag;
        SessionStore.save(s);
        SessionManager.loadSessions();
      }
    }
    dd.remove();
  });
}

/**
 * Agent 三点菜单
 * 功能：编辑、删除
 */
function toggleAgentMenu(btn) {
  closeAllMenus();
  const agentId = btn ? btn.dataset.agent : '';
  if (!agentId) return;

  const agent = State.findAgent(agentId);
  const displayName = agent ? agent.name : agentId;

  const dd = document.createElement('div');
  dd.className = 'agent-dropdown open';
  dd.innerHTML = ''
    + '<button class="dropdown-item" data-action="edit" data-agent="' + escapeHtml(agentId) + '">✏️ 编辑</button>'
    + '<div class="dropdown-divider"></div>'
    + '<button class="dropdown-item danger" data-action="delete-agent" data-agent="' + escapeHtml(agentId) + '">🗑 删除</button>';

  _positionDropdown(dd, btn);

  dd.addEventListener('click', async function (e) {
    const actionBtn = e.target.closest('.dropdown-item');
    if (!actionBtn) return;
    const action = actionBtn.dataset.action;
    const aname = actionBtn.dataset.agent;

    if (action === 'edit') {
      State.setState({ editingAgent: aname, activeModal: 'edit-agent' });
    } else if (action === 'delete-agent') {
      if (confirm('确定删除助手「' + displayName + '」吗？')) {
        try {
          await Api._fetch('/api/agents/' + encodeURIComponent(aname), { method: 'DELETE' });
          if (State.currentAgent === aname) SessionManager.exitAgentMode();
          await Api.fetchAgents();
          showToast('助手已删除', 2000, 'info');
        } catch (err) {
          showToast('删除失败: ' + err.message, 3000, 'error');
        }
      }
    }
    dd.remove();
  });
}

/**
 * 定位下拉菜单（提取公共逻辑）
 */
function _positionDropdown(dd, btn) {
  document.body.appendChild(dd);
  const btnRect = btn.getBoundingClientRect();
  dd.style.position = 'fixed';
  dd.style.right = (window.innerWidth - btnRect.right) + 'px';
  dd.style.top = (btnRect.bottom + 4) + 'px';

  requestAnimationFrame(function () {
    const ddRect = dd.getBoundingClientRect();
    if (ddRect.bottom > window.innerHeight - 10) {
      dd.style.top = (btnRect.top - ddRect.height - 4) + 'px';
    }
  });
}

/**
 * 内联重命名：将 session-item 的 .name 变为 input
 */
function _startInlineRename(sessionId, currentName) {
  const item = document.querySelector('.session-item[data-id="' + sessionId + '"]');
  if (!item) return;
  const nameEl = item.querySelector('.name');
  if (!nameEl) return;

  const originalHtml = nameEl.innerHTML;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentName;
  input.className = 'inline-rename-input';
  input.style.cssText = 'width:100%;border:1px solid var(--accent);border-radius:4px;padding:2px 6px;font:inherit;font-size:13px;background:#fff;outline:none;';

  nameEl.innerHTML = '';
  nameEl.appendChild(input);
  input.focus();
  input.select();

  function commit() {
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      const s = SessionStore.get(sessionId);
      if (s) {
        s.name = newName;
        SessionStore.save(s);
        SessionManager.loadSessions();
      }
    } else {
      nameEl.innerHTML = originalHtml;
    }
  }

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { nameEl.innerHTML = originalHtml; }
  });
  input.addEventListener('blur', commit);
}

/**
 * 复制会话（深拷贝消息）
 */
function _duplicateSession(sid) {
  const original = SessionStore.get(sid);
  if (!original) return;

  const newId = uid();
  const copy = JSON.parse(JSON.stringify(original));
  copy.id = newId;
  copy.name = original.name + ' (副本)';
  copy.created_at = Date.now();
  copy.updated_at = Date.now();

  SessionStore.save(copy);
  SessionManager.loadSessions();
  showToast('对话已复制', 2000, 'info');
}

function closeAllMenus() {
  document.querySelectorAll('.dropdown.open, .agent-dropdown.open').forEach(function (el) { el.remove(); });
  // 也关闭内联重命名
  const renameInput = document.querySelector('.inline-rename-input');
  if (renameInput) renameInput.blur();
}
