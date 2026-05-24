let _mentionStart = -1;
let _mentionQuery = '';

function onAgentMentionInput() {
  const input = document.getElementById('input');
  if (!input) return;

  const val = input.value;
  const pos = input.selectionStart;

  const atPos = val.lastIndexOf('@', pos - 1);
  if (atPos >= 0) {
    const afterAt = val.substring(atPos + 1, pos);
    if (afterAt.indexOf(' ') < 0 && afterAt.indexOf('\n') < 0) {
      _mentionStart = atPos;
      _mentionQuery = afterAt.toLowerCase();
      _showMentionPopup(input, atPos);
      return;
    }
  }

  _hideMentionPopup();
}

function _showMentionPopup(input, atPos) {
  let popup = document.getElementById('mention-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'mention-popup';
    popup.className = 'mention-popup';
    document.body.appendChild(popup);
  }

  const agents = (State.agents || []).filter(function (a) { return a.id !== 'main' && !a.default; });
  const filtered = agents.filter(function (a) {
    const name = (a.name || a.id || '').toLowerCase();
    return name.indexOf(_mentionQuery) >= 0;
  });

  if (filtered.length === 0) {
    _hideMentionPopup();
    return;
  }

  popup.innerHTML = filtered.map(function (a) {
    return '<div class="mention-item" data-agent-id="' + escapeHtml(a.id) + '" data-agent-name="' + escapeHtml(a.name || a.id) + '">'
      + '<span class="mention-icon">' + renderAgentAvatar(a.avatar, a.name) + '</span>'
      + '<span class="mention-name">' + escapeHtml(a.name || a.id) + '</span>'
      + '</div>';
  }).join('');

  const rect = input.getBoundingClientRect();
  const inputArea = document.getElementById('input-area');
  const areaRect = inputArea ? inputArea.getBoundingClientRect() : rect;
  popup.style.left = (rect.left + Math.min(atPos * 8, rect.width - 200)) + 'px';
  popup.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
  popup.style.display = 'block';

  popup.onclick = function (e) {
    const item = e.target.closest('.mention-item');
    if (!item) return;
    const agentId = item.dataset.agentId;
    const agentName = item.dataset.agentName;
    _applyMention(input, atPos, agentId, agentName);
  };
}

function _hideMentionPopup() {
  const popup = document.getElementById('mention-popup');
  if (popup) popup.style.display = 'none';
  _mentionStart = -1;
  _mentionQuery = '';
}

function _applyMention(input, atPos, agentId, agentName) {
  const val = input.value;
  const after = val.substring(input.selectionStart);
  const before = val.substring(0, atPos).trimEnd();
  input.value = before + (after ? ' ' + after : '');
  input.focus();
  _hideMentionPopup();
  autoResize();

  State.setState({
    pendingDelegation: {
      agentId: agentId,
      agentName: agentName,
      mode: 'mention'
    }
  });
  showDelegateBadge(agentName, 'mention');
}

function showDelegateBadge(agentName, mode) {
  const existing = document.getElementById('delegate-badge');
  if (existing) existing.remove();

  const badge = document.createElement('div');
  badge.id = 'delegate-badge';
  let avatar = '🤖';
  const agent = State.findAgent(agentName);
  if (agent && agent.avatar) avatar = agent.avatar;

  badge.innerHTML = ''
    + '<span class="delegate-badge-avatar">' + renderAgentAvatar(avatar, agentName) + '</span>'
    + '<span class="delegate-badge-text">📨 提及 <strong>' + escapeHtml(agentName) + '</strong></span>'
    + '<button class="delegate-badge-close" title="取消">&times;</button>';

  const wrap = document.querySelector('.input-wrap');
  if (wrap) wrap.insertBefore(badge, wrap.querySelector('.input-row'));

  badge.querySelector('.delegate-badge-close').addEventListener('click', function() {
    cancelDelegateMode();
  });
}

function cancelDelegateMode() {
  State.setState({ pendingDelegation: null });
  const badge = document.getElementById('delegate-badge');
  if (badge) badge.remove();
  const input = document.getElementById('input');
  if (input) input.focus();
}

document.addEventListener('click', function (e) {
  if (!e.target.closest('.mention-popup') && !e.target.closest('#input')) {
    _hideMentionPopup();
  }
});