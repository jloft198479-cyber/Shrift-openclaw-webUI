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
  var avatar = (agent && agent.avatar) || '';
  var desc = (agent && agent.description) || '';
  var agentAvatar = renderAgentAvatar(avatar || (resolvedAgentName ? resolvedAgentName.slice(0, 1) : ''), resolvedAgentName);
  var html = '<span class="agent-label-avatar">' + agentAvatar + '</span>';
  html += '<span class="agent-label-name">' + escapeHtml(resolvedAgentName) + '</span>';
  if (desc) {
    html += '<span class="agent-label-desc">' + escapeHtml(desc) + '</span>';
  }
  return html;
}

var _ATTACHMENT_RE = /^[\U0001f5bc\U0001f4c4\U0001f4e6\U0001f4dd\U0001f4ca\U0001f4c3\U0001f4ce]\s+(.+)$/;
function _parseAttachments(content) {
  if (!content) return { text: '', attachments: [] };
  const lines = content.split('\n');
  const textLines = [];
  const attachments = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(_ATTACHMENT_RE);
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

  const resolvedAgentId = (agentId !== undefined && agentId !== '') ? agentId : ((role === 'assistant' && State.currentAgent) || '');
  const agent = State.findAgent(resolvedAgentId);
  const resolvedAgentName = (agent && agent.displayName) || (role === 'assistant' ? APP_NAME : resolvedAgentId);
  if (resolvedAgentId) div.dataset.agentId = resolvedAgentId;

  if (role === 'assistant') {
    DebugTrace.log('buildMessageElement', { role: role, inputAgentId: agentId, resolvedAgentId: resolvedAgentId, resolvedAgentName: resolvedAgentName, currentAgent: State.currentAgent, interactionMode: State.interactionMode });
  }

  // ── 头像 ──
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  if (role === 'assistant' && resolvedAgentName) {
    const av = (agent && agent.avatar) || '';
    avatar.innerHTML = av ? renderAgentAvatar(av, resolvedAgentName) : '<img src="' + LOGO_SRC + '" alt="" class="avatar-logo-img">';
    const ac = _getAgentColor(resolvedAgentName);
    avatar.style.background = ac;
    div.style.setProperty('--agent-color', ac);
    div.classList.add('message-agent');
  } else if (role === 'assistant') {
    avatar.style.background = 'linear-gradient(135deg, var(--accent), var(--accent-hover))';
    avatar.innerHTML = '<img src="' + LOGO_SRC + '" alt="" class="avatar-logo-img">';
  } else {
    avatar.textContent = '你';
  }
  div.appendChild(avatar);

  // ── 气泡 ──
  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  // agent 标签
  if (role === 'assistant' && resolvedAgentName) {
    const label = document.createElement('div');
    label.className = 'agent-label';
    label.innerHTML = _buildAgentLabelHtml(agent, resolvedAgentName);
    bubble.appendChild(label);
  }

  // 内容
  if (streaming) {
    bubble.classList.add('streaming-cursor');
    const contentEl = document.createElement('div');
    contentEl.className = 'agent-content';
    bubble.appendChild(contentEl);
  } else {
    if (thinking) {
      const tb = document.createElement('div');
      tb.className = 'thinking-block';
      tb.innerHTML = '<div class="thinking-toggle" onclick="this.nextElementSibling.classList.toggle(\'open\')">💭 已深度思考</div>'
        + '<div class="thinking-content">' + escapeHtml(thinking) + '</div>';
      bubble.appendChild(tb);
    }

    // 用户消息：解析附件并渲染卡片
    if (role === 'user' && content) {
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
    } else if (content) {
      const contentEl = document.createElement('div');
      contentEl.className = 'agent-content';
      if (role === 'assistant') {
        contentEl.innerHTML = renderMarkdown(content);
      } else {
        contentEl.textContent = content;
      }
      bubble.appendChild(contentEl);
    }
  }

  // ── 操作按钮（仅 assistant，流式结束后可见） ──
  if (role === 'assistant' && !streaming) {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    actions.innerHTML = '<button class="msg-act-btn" data-action="copy" title="复制">📋</button>';
    bubble.appendChild(actions);
  }

  div.appendChild(bubble);
  return div;
}

const MessageRenderer = {
  _initialized: false,

  /** 初始化事件委托 */
  init: function () {
    if (this._initialized) return;
    this._initialized = true;
    document.querySelector('.messages-inner').addEventListener('click', function (e) {
      const btn = e.target.closest('.msg-act-btn');
      if (!btn) return;
      const action = btn.dataset.action;
      const messageEl = btn.closest('.message');
      if (!messageEl || action === 'copy') {
        MessageRenderer._copyMessage(btn, messageEl);
      }
    });
  },

  /** 复制消息纯文本内容 */
  _copyMessage: function (btn, messageEl) {
    const content = messageEl.querySelector('.agent-content');
    if (!content) return;
    const text = content.innerText || content.textContent || '';
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
    var contentEl = bubble.querySelector('.agent-content');
    if (contentEl) {
      contentEl.innerHTML = renderMarkdown(newContent);
    }
    if (!bubble.querySelector('.msg-actions')) {
      var actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.innerHTML = '<button class="msg-act-btn" data-action="copy" title="复制">📋</button>';
      bubble.appendChild(actions);
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
};
