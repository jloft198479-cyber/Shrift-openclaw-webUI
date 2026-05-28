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
  _hideMentionPopup();
  var before = input.value.substring(0, atPos);
  var after = input.value.substring(input.selectionStart);
  input.value = before + '@' + agentName + ' ' + after;
  State.setState({ currentAgent: agentId, interactionMode: 'direct' });
  _updateDirectChatBadge(agentName);
  input.focus();
  var newPos = before.length + agentName.length + 2;
  input.setSelectionRange(newPos, newPos);
  autoResize();
}

function _updateDirectChatBadge(agentName) {
  var badge = document.getElementById('delegate-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'delegate-badge';
    var inputWrap = document.querySelector('.input-wrap');
    if (inputWrap && inputWrap.parentNode) {
      inputWrap.parentNode.insertBefore(badge, inputWrap);
    }
  }
  var agent = State.findAgent(State.currentAgent || '');
  var av = (agent && agent.avatar) || '';
  badge.innerHTML = '<span class="delegate-badge-avatar">' + renderAgentAvatar(av || agentName.slice(0, 1), agentName) + '</span>'
    + '<span class="delegate-badge-text">与 <strong>' + escapeHtml(agentName) + '</strong> 对话中</span>'
    + '<span class="delegate-badge-close" title="取消">&times;</span>';
  badge.style.display = 'flex';
  badge.querySelector('.delegate-badge-close').onclick = function () {
    cancelDirectChatMode();
  };
}

function cancelDirectChatMode() {
  State.setState({ currentAgent: '', interactionMode: 'dispatch' });
  var badge = document.getElementById('delegate-badge');
  if (badge) badge.style.display = 'none';
  var input = document.getElementById('input');
  if (input) input.focus();
}

document.addEventListener('click', function (e) {
  if (!e.target.closest('.mention-popup') && !e.target.closest('#input')) {
    _hideMentionPopup();
  }
});