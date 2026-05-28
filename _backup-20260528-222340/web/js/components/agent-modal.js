const AVATAR_SOURCES = {
  packs: [
    { path: 'avatars/', files: [
      'male-james', 'male-michael', 'male-david', 'male-thomas',
      'male-daniel', 'male-alex', 'male-sam', 'male-leo',
      'female-emma', 'female-sophia', 'female-olivia', 'female-isabella',
      'female-mia', 'female-charlotte', 'female-amelia', 'female-harper',
    ]},
  ],
};

const DEFAULT_AVATAR = AVATAR_SOURCES.packs[0].path + AVATAR_SOURCES.packs[0].files[0] + '.svg';

const AgentModal = {
  _unsub: null,

  init: function() {
    this._unsub = State.on('modal', function() { AgentModal.render(); });
  },

  render: function() {
    const modal = State.activeModal;
    if (!modal) {
      this._close();
      return;
    }
    if (modal === 'create-agent') this._showCreate();
    else if (modal === 'edit-agent') this._showEdit();
  },

  _close: function() {
    const el = document.querySelector('.modal-overlay');
    if (el) el.remove();
  },

  _showCreate: function() {
    this._renderForm({
      title: '新建助手',
      data: { name: '', description: '', prompt: '', avatar: DEFAULT_AVATAR, skills: [] },
      onSave: function(data) {
        return Api.createAgent(data).then(function() {
          State.setState({ activeModal: null });
          showToast('助手已创建');
        }).catch(function(err) {
          showToast('创建失败: ' + (err.message || '未知错误'));
        });
      },
    });
  },

  _showEdit: function() {
    const agentId = State.editingAgent;
    if (!agentId) return;
    const agent = State.findAgent(agentId);
    if (!agent) return;

    const self = this;
    Api.fetchAgentDetail(agentId).then(function(detail) {
      self._renderForm({
        title: '编辑助手',
        data: {
          name: agent.name || agent.id,
          description: agent.description || '',
          prompt: detail.agentsMd || '',
          avatar: agent.avatar || DEFAULT_AVATAR,
          skills: (agent.skills || []).map(function(s) { return s.id; }),
          model: detail.model || agent.model || '',
        },
        isEdit: true,
        agentId: agentId,
        teamMembers: detail.teamMembers || [],
        allowAgents: detail.allowAgents || [],
        onSave: function(data) {
          return Api.updateAgent(agentId, data).then(function() {
            State.setState({ activeModal: null, editingAgent: null });
            showToast('助手已更新');
          }).catch(function(err) {
            showToast('更新失败: ' + (err.message || '未知错误'));
          });
        },
      });
    }).catch(function(err) {
      showToast('加载失败: ' + (err.message || '未知错误'));
    });
  },

  _buildAvatarPicker: function(currentAvatar) {
    let html = '<div id="avatar-picker" class="avatar-picker-unified">';

    AVATAR_SOURCES.packs.forEach(function(pack) {
      html += '<div class="avatar-group"><div class="avatar-group-items avatar-grid">';
      pack.files.forEach(function(f) {
        const val = pack.path + f + '.svg';
        const sel = val === currentAvatar ? ' selected' : '';
        html += '<div class="avatar-option img-option' + sel + '" data-avatar="' + val + '">'
          + '<img src="' + val + '" alt="" loading="lazy">'
          + '</div>';
      });
      html += '</div></div>';
    });

    html += '</div>';
    return html;
  },

  _renderForm: function(opts) {
    const data = opts.data;
    const isEdit = opts.isEdit || false;

    function buildModelOptions(currentModel) {
      var models = State.models || [];
      var defModel = State.defaultModel || '';
      var selected = currentModel || defModel || '';
      var html = '<option value="">默认 (' + escapeHtml(defModel || '未配置') + ')</option>';
      models.forEach(function(m) {
        html += '<option value="' + escapeHtml(m.id) + '"' + (m.id === selected ? ' selected' : '') + '>' + escapeHtml(m.name) + '</option>';
      });
      return html;
    }

    const selectedSkills = data.skills || [];
    const availableSkills = State.skills || [];

    let skillsHtml = '';
    if (availableSkills.length > 0) {
      skillsHtml = '<div class="skills-grid">';
      availableSkills.forEach(function(sk) {
        const skId = sk.id || sk.name;
        const isSelected = selectedSkills.indexOf(skId) >= 0;
        skillsHtml += '<div class="skill-option' + (isSelected ? ' selected' : '') + '" data-skill="' + escapeHtml(skId) + '">'
          + '<span class="skill-option-icon">' + (sk.icon || '') + '</span>'
          + '<span class="skill-option-label">' + escapeHtml(sk.label || sk.name || skId) + '</span>'
          + '</div>';
      });
      skillsHtml += '</div>';
    } else {
      skillsHtml = '<div class="empty-state" style="padding:12px;font-size:12px;">暂无可用技能</div>';
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    overlay.innerHTML = ''
      + '<div class="modal-content agent-modal">'
      + '  <div class="modal-header">'
      + '    <h3>' + escapeHtml(opts.title) + '</h3>'
      + '    <button class="modal-close" data-action="close">×</button>'
      + '  </div>'
      + '  <div class="modal-body">'
      + '    <div class="form-section">'
      + '      <div class="form-row">'
      + '        <div class="form-field flex-1">'
      + '          <label>名称</label>'
      + '          <input type="text" id="agent-name" value="' + escapeHtml(data.name) + '" placeholder="助手名称" maxlength="20">'
      + '        </div>'
      + '        <div class="form-field flex-1">'
      + '          <label>简介</label>'
      + '          <input type="text" id="agent-desc" value="' + escapeHtml(data.description) + '" placeholder="一句话介绍" maxlength="40">'
      + '        </div>'
      + '      </div>'
      + '    </div>'
      + '    <div class="form-divider"></div>'
      + '    <div class="form-section">'
      + '      <label class="section-label">头像</label>'
      + this._buildAvatarPicker(data.avatar || DEFAULT_AVATAR)
      + '    </div>'
      + '    <div class="form-divider"></div>'
      + '    <div class="form-section">'
      + '      <label class="section-label">详情介绍</label>'
      + '      <div class="prompt-tags">'
      + '        <span class="prompt-tag" data-tag="#身份角色">#身份角色</span>'
      + '        <span class="prompt-tag" data-tag="#领域专业">#领域专业</span>'
      + '        <span class="prompt-tag" data-tag="#说话风格">#说话风格</span>'
      + '        <span class="prompt-tag" data-tag="#行为规范">#行为规范</span>'
      + '        <span class="prompt-tag" data-tag="#场景示例">#场景示例</span>'
      + '        <span class="prompt-tag" data-tag="#工作流程">#工作流程</span>'
      + '      </div>'
      + '      <textarea id="agent-prompt" placeholder="点击上方标签插入提示，自由组合…" rows="15">' + escapeHtml(data.prompt || '') + '</textarea>'
      + '    </div>'
      + '    <div class="form-divider"></div>'
      + '    <div class="form-section">'
      + '      <label class="section-label">技能</label>'
      + skillsHtml
      + '    </div>'
      + '    <div class="form-divider"></div>'
      + '    <div class="form-section">'
      + '      <label class="section-label">语言模型</label>'
      + '      <select id="agent-model" class="agent-model-select">'
      + buildModelOptions(data.model)
      + '      </select>'
      + '    </div>'
      + (opts.teamMembers && opts.teamMembers.length > 0 ? (
        '    <div class="form-divider"></div>'
        + '    <div class="form-section">'
        + '      <label class="section-label">团队成员</label>'
        + '      <div class="team-members-grid">'
        + opts.teamMembers.map(function(m) {
            return '<div class="team-member-card">'
              + '<span class="team-member-id">' + escapeHtml(m.display || m.id) + '</span>'
              + (m.summary ? '<span class="team-member-summary">' + escapeHtml(m.summary) + '</span>' : '')
              + '</div>';
          }).join('')
        + '      </div>'
        + '    </div>'
      ) : '')
      + '  </div>'
      + '  <div class="modal-footer">'
      + '    <button class="modal-btn secondary" data-action="close">取消</button>'
      + '    <button class="modal-btn primary" data-action="save">' + (isEdit ? '保存' : '创建') + '</button>'
      + '  </div>'
      + '</div>';

    document.body.appendChild(overlay);

    const self = this;
    this._currentOpts = opts;

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        State.setState({ activeModal: null, editingAgent: null });
        return;
      }

      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        if (actionBtn.dataset.action === 'close') {
          State.setState({ activeModal: null, editingAgent: null });
          return;
        }
        if (actionBtn.dataset.action === 'save') {
          self._collectAndSave();
          return;
        }
      }

      const avatarOpt = e.target.closest('.avatar-option');
      if (avatarOpt) {
        overlay.querySelectorAll('.avatar-option').forEach(function(el) { el.classList.remove('selected'); });
        avatarOpt.classList.add('selected');
        return;
      }

      const skillOpt = e.target.closest('.skill-option');
      if (skillOpt) {
        skillOpt.classList.toggle('selected');
        return;
      }

      const promptTag = e.target.closest('.prompt-tag');
      if (promptTag) {
        promptTag.classList.add('tag-clicked');
        setTimeout(function () { promptTag.classList.remove('tag-clicked'); }, 300);
        const textarea = document.getElementById('agent-prompt');
        if (textarea) {
          const tag = promptTag.dataset.tag;
          const tagLabel = tag.replace(/^#/, '');
          const templates = {
            '#身份角色': '\n## ' + tagLabel + '\n\n',
            '#领域专业': '\n## ' + tagLabel + '\n\n',
            '#说话风格': '\n## ' + tagLabel + '\n\n',
            '#行为规范': '\n## ' + tagLabel + '\n\n',
            '#场景示例': '\n## ' + tagLabel + '\n\n- \n\n',
            '#工作流程': '\n## ' + tagLabel + '\n\n1. \n2. \n3. \n\n',
          };
          const tagText = templates[tag] || ('\n## ' + tagLabel + '\n\n');
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const before = textarea.value.substring(0, start);
          const after = textarea.value.substring(end);
          var val = before + tagText + after;
          if (!val.endsWith('\n')) val += '\n';
          textarea.value = val;
          var cursorPos = start + tagText.length;
          textarea.selectionStart = textarea.selectionEnd = cursorPos;
          textarea.focus();
        }
      }
    });
  },

  _collectAndSave: function() {
    const name = document.getElementById('agent-name');
    const desc = document.getElementById('agent-desc');
    const prompt = document.getElementById('agent-prompt');

    const selOpt = document.querySelector('.avatar-option.selected');
    const selectedAvatar = selOpt ? selOpt.dataset.avatar : DEFAULT_AVATAR;

    const data = {
      name: name ? name.value.trim() : '',
      description: desc ? desc.value.trim() : '',
      prompt: prompt ? prompt.value.trim() : '',
      avatar: selectedAvatar,
      skills: [],
    };

    const selectedSkillNodes = document.querySelectorAll('.skill-option.selected');
    selectedSkillNodes.forEach(function(el) { data.skills.push(el.dataset.skill); });

    const modelSelect = document.getElementById('agent-model');
    if (modelSelect && modelSelect.value) {
      data.model = modelSelect.value;
    }

    if (!data.name) { showToast('请输入助手名称'); return; }
    this._currentOpts.onSave(data);
  },

  destroy: function() {
    if (this._unsub) this._unsub();
  },
};
