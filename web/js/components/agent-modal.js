var AVATAR_SOURCES = {
  packs: [
    { path: 'avatars/', files: [
      'male-james', 'male-michael', 'male-david', 'male-thomas',
      'male-daniel', 'male-alex', 'male-sam', 'male-leo',
      'female-emma', 'female-sophia', 'female-olivia', 'female-isabella',
      'female-mia', 'female-charlotte', 'female-amelia', 'female-harper',
      'male-ethan', 'male-lucas', 'male-henry', 'male-owen',
      'male-ryan', 'male-nathan', 'male-jack', 'male-max',
      'female-lily', 'female-chloe', 'female-zoe', 'female-hazel',
      'female-ivy', 'female-luna', 'female-stella', 'female-nora',
    ]},
  ],
};

const DEFAULT_AVATAR = AVATAR_SOURCES.packs[0].path + AVATAR_SOURCES.packs[0].files[0] + '.svg';

var PROMPT_TEMPLATES = {
  '#身份角色': '身份角色',
  '#领域专业': '领域专业',
  '#说话风格': '说话风格',
  '#行为规范': '行为规范',
  '#场景示例': '场景示例',
  '#工作流程': '工作流程',
};

var TOOLS_TEMPLATES = {
  '#选择偏好': '选择偏好',
  '#环境信息': '环境信息',
  '#使用心得': '使用心得',
  '#设备别名': '设备别名',
};

var AgentModal = {
  _unsub: null,

  init: function() {
    this._unsub = State.on('modal', function() { AgentModal.render(); });
  },

  render: function() {
    var modal = State.activeModal;
    if (!modal) {
      this._close();
      return;
    }
    if (modal === 'create-agent') this._showCreate();
    else if (modal === 'edit-agent') this._showEdit();
  },

  _close: function() {
    var el = document.querySelector('.modal-overlay');
    if (el) el.remove();
  },

  _showCreate: function() {
    this._renderForm({
      title: '新建助手',
      data: { name: '', description: '', prompt: '', toolsMd: '', avatar: DEFAULT_AVATAR, skills: [] },
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
    var agentId = State.editingAgent;
    if (!agentId) return;
    var agent = State.findAgent(agentId);
    if (!agent) return;

    var self = this;
    Api.fetchAgentDetail(agentId).then(function(detail) {
      Api._fetch('/api/agents/' + encodeURIComponent(agentId) + '/tools-md').then(function(td) {
        var toolsMd = td ? td.content || '' : '';
        var sysPart = '';
        var userPart = toolsMd;
        var sysStart = '<!-- system-sync-start -->';
        var sysEnd = '<!-- system-sync-end -->';
        var si = toolsMd.indexOf(sysStart);
        var ei = toolsMd.indexOf(sysEnd);
        if (si >= 0 && ei > si) {
          sysPart = toolsMd.slice(si + sysStart.length, ei).trim();
          userPart = toolsMd.slice(0, si).trim();
        }
        self._renderEditForm(agent, agentId, detail, userPart, sysPart);
      }).catch(function() {
        self._renderEditForm(agent, agentId, detail, '', '');
      });
    }).catch(function(err) {
      showToast('加载失败: ' + (err.message || '未知错误'));
    });
  },

  _renderEditForm: function(agent, agentId, detail, toolsMd, sysPart) {
    var self = this;
    self._renderForm({
      title: '编辑助手',
      data: {
        name: agent.name || agent.id,
        description: agent.description || '',
        prompt: detail.agentsMd || '',
        toolsMd: toolsMd || '',
        sysPart: sysPart || '',
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
  },

  _buildAvatarPicker: function(currentAvatar) {
    var html = '<div id="avatar-picker" class="avatar-picker-unified">';
    AVATAR_SOURCES.packs.forEach(function(pack) {
      html += '<div class="avatar-group"><div class="avatar-group-items avatar-grid">';
      pack.files.forEach(function(f) {
        var val = pack.path + f + '.svg';
        var sel = val === currentAvatar ? ' selected' : '';
        html += '<div class="avatar-option img-option' + sel + '" data-avatar="' + val + '">'
          + '<img src="' + val + '" alt="" loading="lazy">'
          + '</div>';
      });
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  },

  _buildTagsHtml: function(tags) {
    var html = '<div class="prompt-tags">';
    tags.forEach(function(t) {
      html += '<span class="prompt-tag" data-tag="' + t + '">' + t + '</span>';
    });
    html += '</div>';
    return html;
  },

  _buildEditorHtml: function(id, markdown, placeholder) {
    var html = '<div class="md-editor" data-editor-id="' + id + '">'
      + '<div class="md-toolbar">'
      + '  <button class="md-btn" data-cmd="h2" title="标题">H</button>'
      + '  <button class="md-btn" data-cmd="bold" title="加粗">B</button>'
      + '  <button class="md-btn" data-cmd="italic" title="斜体">I</button>'
      + '  <span class="md-sep"></span>'
      + '  <button class="md-btn" data-cmd="ul" title="无序列表">•≡</button>'
      + '  <button class="md-btn" data-cmd="ol" title="有序列表">1.</button>'
      + '  <span class="md-sep"></span>'
      + '  <button class="md-btn" data-cmd="code" title="代码">⟨⟩</button>'
      + '  <button class="md-btn" data-cmd="link" title="链接">🔗</button>'
      + '</div>'
      + '<div class="md-content" contenteditable="true" data-placeholder="' + escapeHtml(placeholder) + '">'
      + '</div>'
      + '<textarea id="' + id + '" style="display:none">' + escapeHtml(markdown) + '</textarea>'
      + '</div>';
    return html;
  },

  _initEditor: function(editorEl) {
    var textarea = editorEl.querySelector('textarea');
    var content = editorEl.querySelector('.md-content');
    var md = textarea.value || '';
    if (md && typeof marked !== 'undefined') {
      content.innerHTML = marked.parse(md);
      content.querySelectorAll('strong').forEach(function(el) {
        var text = el.textContent.trim();
        var isTagLabel = Object.values(PROMPT_TEMPLATES).indexOf(text) >= 0
          || Object.values(TOOLS_TEMPLATES).indexOf(text) >= 0;
        if (isTagLabel) {
          var span = document.createElement('span');
          span.className = 'md-inline-tag';
          span.contentEditable = 'false';
          span.textContent = text;
          el.replaceWith(span);
        }
      });
    } else if (md) {
      content.textContent = md;
    }
    content.addEventListener('input', function() {
      if (typeof TurndownService !== 'undefined') {
        var td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
        td.addRule('inlineTag', {
          filter: function(node) { return node.nodeName === 'SPAN' && node.className === 'md-inline-tag'; },
          replacement: function(content) { return '**' + content + '**'; }
        });
        textarea.value = td.turndown(content.innerHTML);
      } else {
        textarea.value = content.innerText;
      }
    });
  },

  _execEditorCmd: function(contentEl, cmd) {
    contentEl.focus();
    var sel = window.getSelection();
    var range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    switch (cmd) {
      case 'bold':
        document.execCommand('bold', false, null);
        break;
      case 'italic':
        document.execCommand('italic', false, null);
        break;
      case 'h2':
        document.execCommand('formatBlock', false, '<h2>');
        break;
      case 'ul':
        document.execCommand('insertUnorderedList', false, null);
        break;
      case 'ol':
        document.execCommand('insertOrderedList', false, null);
        break;
      case 'code':
        var text = sel.toString();
        if (text) {
          document.execCommand('insertHTML', false, '<code>' + escapeHtml(text) + '</code>');
        }
        break;
      case 'link':
        var linkText = sel.toString() || '链接';
        document.execCommand('insertHTML', false, '<a href="#">' + escapeHtml(linkText) + '</a>');
        break;
    }
    contentEl.dispatchEvent(new Event('input'));
  },

  _renderForm: function(opts) {
    var data = opts.data;
    var isEdit = opts.isEdit || false;

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

    var selectedSkills = data.skills || [];
    var availableSkills = State.skills || [];

    var skillsHtml = '';
    if (availableSkills.length > 0) {
      skillsHtml = '<div class="skills-grid">';
      availableSkills.forEach(function(sk) {
        var skId = sk.id || sk.name;
        var isSelected = selectedSkills.indexOf(skId) >= 0;
        var isMissing = sk.missing === true;
        var cls = 'skill-option' + (isSelected ? ' selected' : '') + (isMissing ? ' skill-missing' : '');
        var label = isMissing ? '⚠ ' + escapeHtml(sk.label || sk.name || skId) + ' (未找到)' : (sk.icon || '') + escapeHtml(sk.label || sk.name || skId);
        skillsHtml += '<div class="' + cls + '" data-skill="' + escapeHtml(skId) + '" title="' + (isMissing ? '该技能文件不存在，请重新绑定或删除' : '') + '">'
          + '<span class="skill-option-label">' + label + '</span>'
          + '</div>';
      });
      skillsHtml += '</div>';
    } else {
      skillsHtml = '<div class="empty-state" style="padding:12px;font-size:12px;">暂无可用技能</div>';
    }

    var teamHtml = '';
    if (opts.teamMembers && opts.teamMembers.length > 0) {
      teamHtml = '<div class="form-section" style="margin-top:16px;">'
        + '<label class="section-label">团队成员</label>'
        + '<div class="team-members-grid">'
        + opts.teamMembers.map(function(m) {
            return '<div class="team-member-card">'
              + '<span class="team-member-id">' + escapeHtml(m.display || m.id) + '</span>'
              + (m.summary ? '<span class="team-member-summary">' + escapeHtml(m.summary) + '</span>' : '')
              + '</div>';
          }).join('')
        + '</div></div>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    overlay.innerHTML = ''
      + '<div class="modal-content agent-modal">'
      + '  <div class="modal-header">'
      + '    <h3>' + escapeHtml(opts.title) + '</h3>'
      + '    <button class="modal-close" data-action="close">×</button>'
      + '  </div>'
      + '  <div class="modal-tabs">'
      + '    <button class="modal-tab active" data-tab="basic">基本信息</button>'
      + '    <button class="modal-tab" data-tab="prompt">详情介绍</button>'
      + '    <button class="modal-tab" data-tab="tools">工具备忘录</button>'
      + '    <button class="modal-tab" data-tab="skills">技能与模型</button>'
      + '  </div>'
      + '  <div class="modal-body">'
      + '    <div class="tab-panel active" data-panel="basic">'
      + '      <div class="form-section">'
      + '        <div class="form-row">'
      + '          <div class="form-field flex-1">'
      + '            <label>名称</label>'
      + '            <input type="text" id="agent-name" value="' + escapeHtml(data.name) + '" placeholder="助手名称" maxlength="20">'
      + '          </div>'
      + '          <div class="form-field flex-1">'
      + '            <label>简介</label>'
      + '            <input type="text" id="agent-desc" value="' + escapeHtml(data.description) + '" placeholder="一句话介绍" maxlength="40">'
      + '          </div>'
      + '        </div>'
      + '      </div>'
      + '      <div class="form-divider"></div>'
      + '      <div class="form-section">'
      + '        <label class="section-label">头像</label>'
      + this._buildAvatarPicker(data.avatar || DEFAULT_AVATAR)
      + '      </div>'
      + '    </div>'
      + '    <div class="tab-panel" data-panel="prompt">'
      + '      <div class="form-section">'
      + '        <label class="section-label">详情介绍 <span class="section-hint">定义助手是谁、怎么说话、行为规范</span></label>'
      + this._buildTagsHtml(['#身份角色', '#领域专业', '#说话风格', '#行为规范', '#场景示例', '#工作流程'])
      + this._buildEditorHtml('agent-prompt', data.prompt || '', '点击上方标签插入提示，自由组合…')
      + '      </div>'
      + '    </div>'
      + '    <div class="tab-panel" data-panel="tools">'
      + '      <div class="form-section">'
      + '        <label class="section-label">工具备忘录 <span class="section-hint">环境信息、选择偏好、使用心得</span></label>'
      + this._buildTagsHtml(['#选择偏好', '#环境信息', '#使用心得', '#设备别名'])
      + this._buildEditorHtml('agent-tools', data.toolsMd || '', '记录工具的环境信息和选择偏好，比如"搜索知乎优先用 API"…')
      + '      </div>'
      + (data.sysPart ? '<div class="form-section" style="margin-top:12px;"><label class="section-label">自动同步信息 <span class="section-hint">由系统维护，修改技能或团队时自动更新</span></label><div class="sys-sync-preview">' + (typeof marked !== 'undefined' ? marked.parse(data.sysPart) : escapeHtml(data.sysPart)) + '</div></div>' : '')
      + '    </div>'
      + '    <div class="tab-panel" data-panel="skills">'
      + '      <div class="form-section">'
      + '        <label class="section-label">技能</label>'
      + skillsHtml
      + '      </div>'
      + '      <div class="form-divider"></div>'
      + '      <div class="form-section">'
      + '        <label class="section-label">语言模型</label>'
      + '        <select id="agent-model" class="agent-model-select">'
      + buildModelOptions(data.model)
      + '        </select>'
      + '      </div>'
      + teamHtml
      + '    </div>'
      + '  </div>'
      + '  <div class="modal-footer">'
      + '    <button class="modal-btn secondary" data-action="close">取消</button>'
      + '    <button class="modal-btn primary" data-action="save">' + (isEdit ? '保存' : '创建') + '</button>'
      + '  </div>'
      + '</div>';

    document.body.appendChild(overlay);

    var self = this;
    this._currentOpts = opts;

    overlay.querySelectorAll('.md-editor').forEach(function(el) {
      self._initEditor(el);
    });

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        State.setState({ activeModal: null, editingAgent: null });
        return;
      }

      var actionBtn = e.target.closest('[data-action]');
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

      var tabBtn = e.target.closest('.modal-tab');
      if (tabBtn) {
        var tabId = tabBtn.dataset.tab;
        overlay.querySelectorAll('.modal-tab').forEach(function(t) { t.classList.remove('active'); });
        overlay.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
        tabBtn.classList.add('active');
        var panel = overlay.querySelector('.tab-panel[data-panel="' + tabId + '"]');
        if (panel) panel.classList.add('active');
        return;
      }

      var avatarOpt = e.target.closest('.avatar-option');
      if (avatarOpt) {
        overlay.querySelectorAll('.avatar-option').forEach(function(el) { el.classList.remove('selected'); });
        avatarOpt.classList.add('selected');
        return;
      }

      var skillOpt = e.target.closest('.skill-option');
      if (skillOpt) {
        skillOpt.classList.toggle('selected');
        return;
      }

      var mdBtn = e.target.closest('.md-btn');
      if (mdBtn) {
        var cmd = mdBtn.dataset.cmd;
        var editor = mdBtn.closest('.md-editor');
        var contentEl = editor ? editor.querySelector('.md-content') : null;
        if (contentEl) self._execEditorCmd(contentEl, cmd);
        return;
      }

      var promptTag = e.target.closest('.prompt-tag');
      if (promptTag) {
        promptTag.classList.add('tag-clicked');
        setTimeout(function () { promptTag.classList.remove('tag-clicked'); }, 300);
        var tag = promptTag.dataset.tag;
        var tabPanel = promptTag.closest('.tab-panel');
        var editorEl = tabPanel ? tabPanel.querySelector('.md-editor') : null;
        var contentEl = editorEl ? editorEl.querySelector('.md-content') : null;
        var textarea = editorEl ? editorEl.querySelector('textarea') : null;
        var templates = tabPanel && tabPanel.dataset.panel === 'tools' ? TOOLS_TEMPLATES : PROMPT_TEMPLATES;
        if (contentEl && textarea) {
          var tagLabel = templates[tag] || tag.replace(/^#/, '');
          contentEl.focus();
          var sel = window.getSelection();
          if (sel.rangeCount > 0) {
            var range = sel.getRangeAt(0);
            range.deleteContents();
            var tagNode = document.createElement('span');
            tagNode.className = 'md-inline-tag';
            tagNode.contentEditable = 'false';
            tagNode.textContent = tagLabel;
            var spaceNode = document.createTextNode('\u00A0');
            var frag = document.createDocumentFragment();
            frag.appendChild(tagNode);
            frag.appendChild(spaceNode);
            range.insertNode(frag);
            range.setStartAfter(spaceNode);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          } else {
            contentEl.insertAdjacentHTML('beforeend',
              '<span class="md-inline-tag" contenteditable="false">' + escapeHtml(tagLabel) + '</span>&nbsp;');
          }
          contentEl.dispatchEvent(new Event('input'));
        }
      }
    });
  },

  _collectAndSave: function() {
    var name = document.getElementById('agent-name');
    var desc = document.getElementById('agent-desc');
    var prompt = document.getElementById('agent-prompt');
    var tools = document.getElementById('agent-tools');

    var selOpt = document.querySelector('.avatar-option.selected');
    var selectedAvatar = selOpt ? selOpt.dataset.avatar : DEFAULT_AVATAR;

    var data = {
      name: name ? name.value.trim() : '',
      description: desc ? desc.value.trim() : '',
      prompt: prompt ? prompt.value.trim() : '',
      toolsMd: tools ? tools.value.trim() : '',
      avatar: selectedAvatar,
      skills: [],
    };

    var selectedSkillNodes = document.querySelectorAll('.skill-option.selected');
    selectedSkillNodes.forEach(function(el) { data.skills.push(el.dataset.skill); });

    var modelSelect = document.getElementById('agent-model');
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
