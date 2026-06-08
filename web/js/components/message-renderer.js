/* ── message-renderer.js — 消息气泡渲染 + Agent 颜色系统 + 附件卡片 + 错误提示 ──── */

const AGENT_COLORS = [
  '#C96442', '#4A7C59', '#5B7FA5', '#A05B8C',
  '#C97B3A', '#3A9B8F', '#8B6B4C', '#6B7B8B',
];

function _getAgentColor(name) {
  if (!name) return AGENT_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

/**
 * 解析消息中的附件信息，返回 { text, attachments }
 * 附件格式：行首 🖼 或 📄 开头的行，如 "🖼 文件名.png" 或 "📄 文档.pdf"
 */

/**
 * 构建 Agent 标签 HTML（消除重复代码）
 */
function _buildAgentLabelHtml(agent, resolvedAgentName) {
  const avatar = (agent && agent.avatar) || '';
  const desc = (agent && agent.description) || '';
  const avatarSrc = avatar || (resolvedAgentName === APP_NAME ? LOGO_SRC : (resolvedAgentName ? resolvedAgentName.slice(0, 1) : ''));
  const agentAvatar = renderAgentAvatar(avatarSrc, resolvedAgentName);
  let html = '<span class="agent-label-avatar">' + agentAvatar + '</span>';
  html += '<span class="agent-label-name">' + escapeHtml(resolvedAgentName) + '</span>';
  if (desc) {
    html += '<span class="agent-label-desc">' + escapeHtml(desc) + '</span>';
  }
  return html;
}

function _ensureActions(bubble) {
  if (bubble.querySelector('.msg-actions')) return;
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  actions.innerHTML = '<button class="msg-act-btn" data-action="copy" title="复制">📋</button>';
  bubble.appendChild(actions);
}

function _renderContent(el, raw) {
  el.innerHTML = renderMarkdown(raw);
  el.dataset.raw = raw;
}

function _buildAvatarEl(role, agent) {
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  const name = (agent && agent.displayName) || APP_NAME;
  if (role === 'assistant' && name) {
    const av = (agent && agent.avatar) || '';
    const ac = _getAgentColor(name);
    avatar.style.background = ac;
    avatar.innerHTML = av ? renderAgentAvatar(av, name) : '<img src="' + LOGO_SRC + '" alt="" class="avatar-logo-img">';
    return { el: avatar, color: ac };
  }
  if (role === 'assistant') {
    avatar.style.background = 'linear-gradient(135deg, var(--accent), var(--accent-hover))';
    avatar.innerHTML = '<img src="' + LOGO_SRC + '" alt="" class="avatar-logo-img">';
  } else {
    avatar.textContent = '你';
  }
  return { el: avatar, color: null };
}

function _parseAttachments(content) {
  if (!content) return { text: '', attachments: [] };
  const lines = content.split('\n');
  const textLines = [];
  const attachments = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(Constants.REGEX.ATTACHMENT_LINE);
    if (match) {
      const fileName = match[1].trim();
      const isImage = line.indexOf('🖼') === 0;
      attachments.push({
        name: fileName,
        type: isImage ? 'image/*' : 'application/octet-stream',
        icon: line.charAt(0),
      });
    } else {
      textLines.push(line);
    }
  }

  return { text: textLines.join('\n'), attachments: attachments };
}

/**
 * 构建附件卡片 HTML（用户消息气泡内）
 */
function _buildAttachmentCards(attachments) {
  if (!attachments || attachments.length === 0) return '';
  const cards = attachments.map(function (att) {
    const icon = getAttachmentIcon(att.type);
    const shortName = att.name.length > 20 ? att.name.slice(0, 18) + '…' : att.name;
    return '<div class="msg-attachment-card">'
      + '<span class="msg-att-icon">' + icon + '</span>'
      + '<span class="msg-att-name" title="' + escapeHtml(att.name) + '">' + escapeHtml(shortName) + '</span>'
      + '</div>';
  }).join('');
  return '<div class="msg-attachments">' + cards + '</div>';
}

function _resolveMessageAgent(role, agentId) {
  const resolvedAgentId = (agentId !== undefined && agentId !== '') ? agentId : ((role === 'assistant' && State.currentAgent) || '');
  const agent = State.findAgent(resolvedAgentId);
  const resolvedAgentName = (agent && agent.displayName) || (role === 'assistant' ? APP_NAME : resolvedAgentId);
  if (role === 'assistant') {
    DebugTrace.log('buildMessageElement', { role: role, inputAgentId: agentId, resolvedAgentId: resolvedAgentId, resolvedAgentName: resolvedAgentName, currentAgent: State.currentAgent, interactionMode: State.interactionMode });
  }
  return { resolvedAgentId: resolvedAgentId, agent: agent, resolvedAgentName: resolvedAgentName };
}

function _buildAgentLabel(bubble, agent, resolvedAgentName) {
  const label = document.createElement('div');
  label.className = 'agent-label';
  label.innerHTML = _buildAgentLabelHtml(agent, resolvedAgentName);
  bubble.appendChild(label);
}

function _buildUserContent(bubble, content, attachmentMeta) {
  if (!content) return;
  const parsed = _parseAttachments(content);

  if (attachmentMeta && attachmentMeta.length > 0) {
    if (parsed.text.trim()) {
      const contentEl = document.createElement('div');
      contentEl.className = 'agent-content';
      contentEl.innerHTML = highlightMentions(parsed.text);
      bubble.appendChild(contentEl);
    }
    const attContainer = document.createElement('div');
    attContainer.className = 'msg-attachments';
    for (let i = 0; i < attachmentMeta.length; i++) {
      const att = attachmentMeta[i];
      const icon = getAttachmentIcon(att.type);
      const shortName = att.name.length > 20 ? att.name.slice(0, 18) + '…' : att.name;
      const card = document.createElement('div');
      card.className = 'msg-attachment-card';
      card.innerHTML = '<span class="msg-att-icon">' + icon + '</span>'
        + '<span class="msg-att-name" title="' + escapeHtml(att.name) + '">' + escapeHtml(shortName) + '</span>';
      attContainer.appendChild(card);
    }
    bubble.appendChild(attContainer);
  } else if (parsed.attachments.length > 0) {
    if (parsed.text.trim()) {
      const contentEl = document.createElement('div');
      contentEl.className = 'agent-content';
      contentEl.innerHTML = highlightMentions(parsed.text);
      bubble.appendChild(contentEl);
    }
    bubble.insertAdjacentHTML('beforeend', _buildAttachmentCards(parsed.attachments));
  } else {
    const contentEl = document.createElement('div');
    contentEl.className = 'agent-content';
    contentEl.innerHTML = highlightMentions(content);
    bubble.appendChild(contentEl);
  }
}

function _buildAssistantContent(bubble, content, thinking, streaming) {
  if (streaming) {
    bubble.classList.add('streaming-cursor');
    const contentEl = document.createElement('div');
    contentEl.className = 'agent-content';
    bubble.appendChild(contentEl);
    return;
  }

  if (thinking) {
    const tb = document.createElement('div');
    tb.className = 'thinking-block';
    tb.innerHTML = '<div class="thinking-toggle" onclick="this.nextElementSibling.classList.toggle(\'open\')">💭 已深度思考</div>'
      + '<div class="thinking-content">' + escapeHtml(thinking) + '</div>';
    bubble.appendChild(tb);
  }

  if (content) {
    const contentEl = document.createElement('div');
    contentEl.className = 'agent-content';
    _renderContent(contentEl, content);
    bubble.appendChild(contentEl);
  }
}

/**
 * 构建消息 DOM 元素（私有方法，消除重复代码）
 * @param {string} role - 'user' | 'assistant'
 * @param {string} content - 消息文本
 * @param {boolean} streaming - 是否流式
 * @param {string} thinking - 思考内容
 * @param {string} agentId - Agent ID
 * @param {Array} [attachmentMeta] - 附件元数据
 * @returns {HTMLElement} 消息 div
 */
function _buildMessageElement(role, content, streaming, thinking, agentId, attachmentMeta) {
  const div = document.createElement('div');
  div.className = 'message ' + role;

  const { resolvedAgentId, agent, resolvedAgentName } = _resolveMessageAgent(role, agentId);
  if (resolvedAgentId) div.dataset.agentId = resolvedAgentId;

  const avResult = _buildAvatarEl(role, agent);
  div.appendChild(avResult.el);
  if (avResult.color) {
    div.style.setProperty('--agent-color', avResult.color);
    div.classList.add('message-agent');
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (role === 'assistant' && resolvedAgentName) {
    _buildAgentLabel(bubble, agent, resolvedAgentName);
  }

  if (role === 'user') {
    _buildUserContent(bubble, content, attachmentMeta);
  } else if (role === 'assistant') {
    _buildAssistantContent(bubble, content, thinking, streaming);
  }

  if (role === 'assistant' && !streaming) {
    _ensureActions(bubble);
  }

  div.appendChild(bubble);
  return div;
}

const MessageRenderer = {
  _initialized: false,

  /** 初始化事件委托 */
  init: function (containerEl) {
    if (this._initialized) return;
    this._initialized = true;
    if (!containerEl) return;
    containerEl.addEventListener('click', function (e) {
      const btn = e.target.closest('.msg-act-btn');
      if (!btn) return;
      const action = btn.dataset.action;
      const messageEl = btn.closest('.message');
      if (!messageEl || action === 'copy') {
        MessageRenderer._copyMessage(btn, messageEl);
      }
    });
  },

  /** 复制消息内容（优先原始 Markdown） */
  _copyMessage: function (btn, messageEl) {
    const content = messageEl.querySelector('.agent-content');
    if (!content) return;
    const text = content.dataset.raw || content.innerText || content.textContent || '';
    if (!text) return;
    Utils.copyToClipboard(text, function () {
      MessageRenderer._flashCopied(btn);
    });
  },

  _flashCopied: function (btn) {
    btn.textContent = '✓';
    btn.classList.add('copied');
    setTimeout(function () { btn.textContent = '📋'; btn.classList.remove('copied'); }, 1500);
  },

  /**
   * 创建一条消息 DOM 并追加到 .messages-inner
   * @param {string} role - 'user' | 'assistant'
   * @param {string} content - 消息文本
   * @param {boolean} streaming - 是否流式
   * @param {string} thinking - 思考内容
   * @param {string} agentId - Agent ID（用于查找 agent 对象）
   * @param {Array} [attachmentMeta] - 附件元数据 [{name,type,path}] 可选，用于渲染卡片
   * @returns {HTMLElement|null} 消息 div
   */
  appendMessage: function (role, content, streaming, thinking, agentId, attachmentMeta) {
    DebugTrace.log('appendMessage', { role: role, agentId: agentId, streaming: streaming, content: (content || '').substring(0, 60) });
    const inner = document.querySelector('.messages-inner');
    if (!inner) return null;
    const div = _buildMessageElement(role, content, streaming, thinking, agentId, attachmentMeta);
    inner.appendChild(div);
    return div;
  },

  /**
   * 在气泡中显示错误提示（替代硬编码 style="color:#DC2626"）
   * @param {HTMLElement} bubble - 气泡 DOM 元素
   * @param {string} prefix - 错误前缀，如 "错误" 或 "发送失败"
   * @param {string} message - 错误消息
   */
  showError: function (bubble, prefix, message) {
    if (!bubble) return;
    const errEl = document.createElement('div');
    errEl.className = 'chat-error';
    errEl.innerHTML = '<span class="chat-error-icon">⚠</span>'
      + '<span class="chat-error-label">[' + escapeHtml(prefix) + ']</span> '
      + escapeHtml(message || '请求失败');
    bubble.innerHTML = '';
    bubble.appendChild(errEl);
    bubble.classList.remove('streaming-cursor');
  },

  /**
   * 清空所有消息
   */
  clearMessages: function () {
    const inner = document.querySelector('.messages-inner');
    if (inner) inner.innerHTML = '';
  },

  updateMessageAgent: function (messageEl, newAgentId) {
    DebugTrace.log('updateMessageAgent', { newAgentId: newAgentId });
    if (!messageEl) return;
    const agent = State.findAgent(newAgentId);
    const displayName = (agent && agent.displayName) || APP_NAME;
    const av = (agent && agent.avatar) || '';
    const ac = _getAgentColor(displayName);

    messageEl.dataset.agentId = newAgentId;
    messageEl.style.setProperty('--agent-color', ac);

    const avatarDiv = messageEl.querySelector('.avatar');
    if (avatarDiv) {
      avatarDiv.style.background = ac;
      if (av) {
        avatarDiv.innerHTML = renderAgentAvatar(av, displayName);
      } else {
        avatarDiv.innerHTML = '<img src="' + LOGO_SRC + '" alt="" class="avatar-logo-img">';
      }
    }

    let label = messageEl.querySelector('.agent-label');
    if (label) {
      label.innerHTML = _buildAgentLabelHtml(agent, displayName);
    } else if (newAgentId) {
      const bubble = messageEl.querySelector('.bubble');
      if (bubble) {
        label = document.createElement('div');
        label.className = 'agent-label';
        label.innerHTML = _buildAgentLabelHtml(agent, displayName);
        const firstChild = bubble.firstChild;
        if (firstChild) {
          bubble.insertBefore(label, firstChild);
        } else {
          bubble.appendChild(label);
        }
      }
    }
  },

  updateBubbleContent: function (bubble, newContent) {
    if (!bubble) return;
    const contentEl = bubble.querySelector('.agent-content');
    if (contentEl) {
      _renderContent(contentEl, newContent);
    }
    _ensureActions(bubble);
  },

  appendToLastAssistantMessage: function (content, agentId) {
    const inner = document.querySelector('.messages-inner');
    if (!inner) return false;
    const messages = inner.querySelectorAll('.message.assistant');
    if (messages.length === 0) return false;
    const lastMsg = messages[messages.length - 1];
    const bubble = lastMsg.querySelector('.bubble');
    if (!bubble) return false;

    const resolvedAgentId = agentId || 'main';
    const agent = State.findAgent(resolvedAgentId);
    const displayName = (agent && agent.displayName) || APP_NAME;

    const separator = document.createElement('div');
    separator.className = 'bubble-separator';

    const block = document.createElement('div');
    block.className = 'bubble-content-block';
    block.dataset.agentId = resolvedAgentId;

    const label = document.createElement('div');
    label.className = 'agent-label';
    label.innerHTML = _buildAgentLabelHtml(agent, displayName);
    block.appendChild(label);

    const contentEl = document.createElement('div');
    contentEl.className = 'agent-content';
    _renderContent(contentEl, content);
    block.appendChild(contentEl);

    const actions = bubble.querySelector('.msg-actions');
    if (actions) {
      bubble.insertBefore(separator, actions);
      bubble.insertBefore(block, actions);
    } else {
      bubble.appendChild(separator);
      bubble.appendChild(block);
    }

    return true;
  },

  addProgressBlock: function (agentId, agentName, toolName) {
    const inner = document.querySelector('.messages-inner');
    if (!inner) return null;
    const messages = inner.querySelectorAll('.message.assistant');
    if (messages.length === 0) return null;
    const lastMsg = messages[messages.length - 1];
    const bubble = lastMsg.querySelector('.bubble');
    if (!bubble) return null;

    const el = document.createElement('div');
    el.className = 'bubble-progress';
    el.dataset.agentId = agentId;
    el.innerHTML = '<span class="bubble-progress-spinner"></span>'
      + '<span class="bubble-progress-name">' + escapeHtml(agentName) + '</span>'
      + '<span class="bubble-progress-label">正在执行</span>'
      + (toolName ? '<span class="bubble-progress-tool">' + escapeHtml(toolName) + '</span>' : '');

    const actions = bubble.querySelector('.msg-actions');
    if (actions) {
      bubble.insertBefore(el, actions);
    } else {
      bubble.appendChild(el);
    }

    return el;
  },

  updateProgressBlock: function (agentId, status, toolName) {
    const inner = document.querySelector('.messages-inner');
    if (!inner) return;
    const el = inner.querySelector('.bubble-progress[data-agent-id="' + agentId + '"]');
    if (!el) return;

    if (status === 'done') {
      el.classList.add('done');
      const spinner = el.querySelector('.bubble-progress-spinner');
      if (spinner) { spinner.textContent = ''; spinner.classList.add('done-icon'); }
      const label = el.querySelector('.bubble-progress-label');
      if (label) label.textContent = '已完成';
      const toolSpan = el.querySelector('.bubble-progress-tool');
      if (toolSpan) toolSpan.remove();
    } else if (status === 'error') {
      el.classList.add('error');
      const spinner = el.querySelector('.bubble-progress-spinner');
      if (spinner) { spinner.textContent = ''; spinner.classList.add('error-icon'); }
      const label = el.querySelector('.bubble-progress-label');
      if (label) label.textContent = '执行失败';
    } else if (status === 'running' && toolName) {
      let toolSpan = el.querySelector('.bubble-progress-tool');
      if (toolSpan) {
        toolSpan.textContent = toolName;
      } else {
        toolSpan = document.createElement('span');
        toolSpan.className = 'bubble-progress-tool';
        toolSpan.textContent = toolName;
        el.appendChild(toolSpan);
      }
    }
  },

  /**
   * 创建消息 DOM 元素（不追加到 DOM）
   * 用于虚拟列表等场景
   * @param {string} role - 'user' | 'assistant'
   * @param {string} content - 消息文本
   * @param {boolean} streaming - 是否流式
   * @param {string} thinking - 思考内容
   * @param {string} agentId - Agent ID
   * @param {Array} [attachmentMeta] - 附件元数据
   * @returns {HTMLElement|null} 消息 div
   */
  createMessageElement: function (role, content, streaming, thinking, agentId, attachmentMeta) {
    return _buildMessageElement(role, content, streaming, thinking, agentId, attachmentMeta);
  },

  /**
   * 更新最后一条 assistant 消息的内容
   * 用于 dispatch 模式 announce 结果合并——不创建新气泡，复用已有的最后一条
   * @param {string} content - 新内容（Markdown）
   * @param {string} agentId - Agent ID
   * @returns {boolean} 是否找到并更新成功
   */
  updateLastAssistantMessage: function (content, agentId) {
    const inner = document.querySelector('.messages-inner');
    if (!inner) return false;
    const messages = inner.querySelectorAll('.message.assistant');
    if (messages.length === 0) return false;
    const lastMsg = messages[messages.length - 1];
    const bubble = lastMsg.querySelector('.bubble');
    if (!bubble) return false;

    // 更新 agent 标签
    const resolvedAgentId = agentId || State.currentAgent || 'main';
    const agent = State.findAgent(resolvedAgentId);
    const displayName = (agent && agent.displayName) || APP_NAME;
    const av = (agent && agent.avatar) || '';

    // 更新头像颜色
    const ac = _getAgentColor(displayName);
    lastMsg.style.setProperty('--agent-color', ac);
    const avatarDiv = lastMsg.querySelector('.avatar');
    if (avatarDiv) {
      avatarDiv.style.background = ac;
      if (av) {
        avatarDiv.innerHTML = renderAgentAvatar(av, displayName);
      } else {
        avatarDiv.innerHTML = '<img src="' + LOGO_SRC + '" alt="" class="avatar-logo-img">';
      }
    }

    // 更新/添加 agent 标签
    let label = lastMsg.querySelector('.agent-label');
    if (label) {
      label.innerHTML = _buildAgentLabelHtml(agent, displayName);
    } else if (resolvedAgentId) {
      label = document.createElement('div');
      label.className = 'agent-label';
      label.innerHTML = _buildAgentLabelHtml(agent, displayName);
      bubble.insertBefore(label, bubble.firstChild);
    }

    // 更新内容
    let contentEl = bubble.querySelector('.agent-content');
    if (contentEl) {
      _renderContent(contentEl, content);
    } else {
      contentEl = document.createElement('div');
      contentEl.className = 'agent-content';
      _renderContent(contentEl, content);
      bubble.appendChild(contentEl);
    }

    _ensureActions(bubble);

    return true;
  },
};
