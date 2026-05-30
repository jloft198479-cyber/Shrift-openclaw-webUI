/* ── welcome-view.js — 欢迎页 + Agent 模式顶栏（纯 UI 渲染）──── */

const WelcomeView = {

  showWelcome: function (opts) {
    const welcome = document.getElementById('welcome');
    const messages = document.getElementById('messages');
    if (!welcome) return;
    welcome.classList.remove('hidden');
    if (messages) messages.style.display = 'none';

    WelcomeView.updateAgentModeBar();

    if (opts && opts.agent) {
      const agent = opts.agent;
      const icon = agent.avatar || '🤖';
      const displayName = agent.displayName || agent.name || '';
      const desc = agent.description || '输入你的需求，该助手将为你处理';
      welcome.innerHTML = '<div class="welcome-logo" style="font-size:32px;line-height:1">' + renderAgentAvatar(icon, displayName) + '</div>'
        + '<h2>与 ' + escapeHtml(displayName) + ' 对话</h2>'
        + '<p>' + escapeHtml(desc) + '</p>'
        + '<p style="margin-top:8px"><a href="#" id="exit-agent-link" style="color:var(--muted);font-size:13px;text-decoration:none">← 返回主界面</a></p>';
      const exitLink = document.getElementById('exit-agent-link');
      if (exitLink) exitLink.addEventListener('click', function (e) { e.preventDefault(); SessionManager.exitAgentMode(); });
    } else {
      const suggestions = [
        { text: '帮我总结这篇文章的核心观点', icon: '📋' },
        { text: '写一段代码解决这个需求', icon: '💻' },
        { text: '解释一下这个概念', icon: '💡' }
      ];
      let chipsHtml = '<div class="welcome-suggestions">';
      suggestions.forEach(function (s) {
        chipsHtml += '<span class="welcome-suggestion" data-prompt="' + escapeHtml(s.text) + '">' + escapeHtml(s.icon) + ' ' + escapeHtml(s.text) + '</span>';
      });
      chipsHtml += '</div>';
      welcome.innerHTML = '<div class="welcome-logo" style="font-size:0;line-height:1"><img src="' + LOGO_SRC + '" alt="" style="width:auto;height:48px"></div>'
        + '<h2>开始新对话</h2>'
        + '<p>在下方输入你的问题，与 ' + APP_NAME + ' 助理展开交流</p>'
        + chipsHtml;
      welcome.querySelectorAll('.welcome-suggestion').forEach(function (el) {
        el.addEventListener('click', function () {
          const prompt = this.getAttribute('data-prompt');
          if (!prompt) return;
          const input = document.getElementById('input');
          if (!input) return;
          input.value = prompt;
          input.focus();
          input.dispatchEvent(new Event('input', { bubbles: true }));
          if (typeof ChatView !== 'undefined' && ChatView.sendMessage) {
            ChatView.sendMessage();
          }
        });
      });
    }
  },

  hideWelcome: function () {
    const welcome = document.getElementById('welcome');
    const messages = document.getElementById('messages');
    if (welcome) welcome.classList.add('hidden');
    if (messages) { messages.style.display = ''; messages.scrollTop = 0; }
    const sb = document.getElementById('scroll-bottom'); if (sb) sb.style.display = 'none';
    WelcomeView.updateAgentModeBar();
  },

  updateAgentModeBar: function () {
    const existing = document.getElementById('agent-mode-bar');
    const mainEl = document.getElementById('main');

    if (!State.currentAgent) {
      if (existing) existing.remove();
      return;
    }
    if (!mainEl) return;
    if (existing) existing.remove();

    const agent = State.findAgent(State.currentAgent);
    const avatar = (agent && agent.avatar) || '🤖';
    const displayName = (agent && agent.displayName) || (agent && agent.name) || State.currentAgent;

    const bar = document.createElement('div');
    bar.id = 'agent-mode-bar';
    bar.innerHTML = ''
      + '<span class="agent-mode-avatar">' + renderAgentAvatar(avatar, displayName) + '</span>'
      + '<span class="agent-mode-label">正在与 <strong>' + escapeHtml(displayName) + '</strong> 对话</span>'
      + '<button id="agent-mode-exit" title="返回主界面">✕</button>';

    mainEl.insertBefore(bar, mainEl.firstChild);
    document.getElementById('agent-mode-exit')?.addEventListener('click', function () {
      SessionManager.exitAgentMode();
    });
    ModelSwitcher.updateBar();
  },
};
