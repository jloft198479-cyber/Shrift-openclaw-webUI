/* ── welcome-view.js — 欢迎页 + Agent 模式顶栏（纯 UI 渲染）──── */

var WelcomeView = {

  showWelcome: function (opts) {
    var welcome = document.getElementById('welcome');
    var messages = document.getElementById('messages');
    if (!welcome) return;
    welcome.classList.remove('hidden');
    if (messages) messages.style.display = 'none';

    WelcomeView.updateAgentModeBar();

    if (opts && opts.agent) {
      var agent = opts.agent;
      var icon = agent.avatar || '🤖';
      var displayName = agent.name || '';
      var desc = agent.description || '输入你的需求，该助手将为你处理';
      welcome.innerHTML = '<div class="welcome-logo" style="font-size:32px;line-height:1">' + renderAgentAvatar(icon, displayName) + '</div>'
        + '<h2>与 ' + escapeHtml(displayName) + ' 对话</h2>'
        + '<p>' + escapeHtml(desc) + '</p>'
        + '<p style="margin-top:8px"><a href="#" id="exit-agent-link" style="color:var(--text-3);font-size:13px;text-decoration:none">← 返回主界面</a></p>';
      var exitLink = document.getElementById('exit-agent-link');
      if (exitLink) exitLink.addEventListener('click', function (e) { e.preventDefault(); SessionManager.exitAgentMode(); });
    } else {
      welcome.innerHTML = '<div class="welcome-logo" style="font-size:0;line-height:1"><img src="' + LOGO_SRC + '" alt="" style="width:auto;height:48px"></div>'
        + '<h2>开始新对话</h2>'
        + '<p>在下方输入你的问题，与 ' + APP_NAME + ' 助理展开交流</p>';
    }
  },

  hideWelcome: function () {
    var welcome = document.getElementById('welcome');
    var messages = document.getElementById('messages');
    if (welcome) welcome.classList.add('hidden');
    if (messages) { messages.style.display = ''; messages.scrollTop = 0; }
    var sb = document.getElementById('scroll-bottom'); if (sb) sb.style.display = 'none';
    WelcomeView.updateAgentModeBar();
  },

  updateAgentModeBar: function () {
    var existing = document.getElementById('agent-mode-bar');
    var mainEl = document.getElementById('main');

    if (!State.currentAgent) {
      if (existing) existing.remove();
      return;
    }
    if (!mainEl) return;
    if (existing) existing.remove();

    var agent = State.findAgent(State.currentAgent);
    var avatar = (agent && agent.avatar) || '🤖';
    var displayName = (agent && agent.name) || State.currentAgent;

    var bar = document.createElement('div');
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
