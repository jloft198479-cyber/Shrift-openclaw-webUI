/* ── model-switcher.js — 模型切换 UI + API 调度 ────── */

const ModelSwitcher = {

  updateBar: function () {
    const bar = document.querySelector('.model-bar');
    if (!bar) return;
    const models = State.models || [];
    if (models.length === 0) { bar.innerHTML = ''; return; }

    const agentId = State.currentAgent;
    let currentModel = '';
    if (agentId) {
      const agent = State.findAgent(agentId);
      currentModel = (agent && agent.model) || '';
    }
    if (!currentModel) currentModel = State.defaultModel || '';

    let html = '<select id="model-select" class="model-select">';
    models.forEach(function (m) {
      html += '<option value="' + escapeHtml(m.id) + '"' + (m.id === currentModel ? ' selected' : '') + '>' + escapeHtml(m.name) + '</option>';
    });
    html += '</select>';

    // workspace 指示器
    var wsPath = State.workspace.path;
    var wsExists = State.workspace.exists;
    var wsName = wsPath ? wsPath.split(/[/\\]/).pop() : '未设置';
    var wsBtn = wsPath ? '改' : '选';
    var wsClass = wsPath && !wsExists ? ' workspace-warning' : '';
    html += '<span class="bar-separator">·</span>';
    html += '<span class="workspace-indicator' + wsClass + '">';
    html += '<span class="workspace-icon">📂</span>';
    html += '<span class="workspace-name">' + escapeHtml(wsName) + '</span>';
    html += '<button class="workspace-btn" id="workspace-change-btn">' + wsBtn + '</button>';
    html += '</span>';

    bar.innerHTML = html;

    bar.querySelector('#model-select')?.addEventListener('change', function (e) {
      ModelSwitcher.onModelChange(e.target.value);
    });

    var wsBtnEl = bar.querySelector('#workspace-change-btn');
    if (wsBtnEl) {
      wsBtnEl.addEventListener('click', function () {
        WorkspacePicker.toggle();
      });
    }

    // 目录丢失警告
    if (wsPath && !wsExists) {
      var wsNameEl = bar.querySelector('.workspace-name');
      if (wsNameEl) wsNameEl.title = '目录不可访问';
    }
  },

  onModelChange: function (modelId) {
    const agentId = State.currentAgent;
    if (agentId) {
      Api.updateAgent(agentId, { model: modelId }).catch(function (err) {
        showToast('模型切换失败: ' + (err.message || ''));
      });
      const agents = State.agents.slice();
      const idx = agents.findIndex(function (a) { return a.id === agentId; });
      if (idx >= 0) {
        agents[idx] = Object.assign({}, agents[idx], { model: modelId });
        State.setState({ agents: normalizeAgents(agents) });
      }
    } else {
      Api.updateDefaultModel(modelId).catch(function (err) {
        showToast('模型切换失败: ' + (err.message || ''));
      });
    }
    ModelSwitcher.updateBar();
  },
};

// workspace 状态变更时刷新底栏
State.on('workspace', function () {
  ModelSwitcher.updateBar();
});
