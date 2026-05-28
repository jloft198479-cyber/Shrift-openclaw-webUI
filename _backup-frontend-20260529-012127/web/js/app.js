window.onerror = function (msg, url, line, col, err) {
  console.error('[Global]', msg, url, line, col, err);
  if (typeof showToast === 'function') showToast('页面发生错误，请刷新重试', 5000, 'error');
  return false;
};

window.addEventListener('unhandledrejection', function (e) {
  console.error('[Global] Unhandled rejection:', e.reason);
  if (typeof showToast === 'function') showToast('异步操作失败，请重试', 4000, 'error');
});

async function init() {
  if (typeof marked === 'undefined') {
    await new Promise(function (resolve) {
      const s = document.createElement('script');
      s.src = '/js/lib/marked.min.js';
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }

  buildApp();

  SessionList.init();
  AgentList.init();
  AgentModal.init();
  ChatView.init();
  WsBridge.init();
  InteractionBindings.init();

  try {
    await Api.fetchAgents();
  } catch (e) {
    console.error('[App] Failed to fetch agents:', e);
  }

  try {
    await Api.fetchAllSkills();
  } catch (e) {}

  try {
    await Api.fetchModels();
  } catch (e) {}

  SessionManager.loadSessions();

  const lastSessionId = localStorage.getItem('lastSessionId') || '';

  if (lastSessionId) {
    let sessionExists = false;
    for (let j = 0; j < State.sessions.length; j++) {
      if (State.sessions[j].id === lastSessionId) { sessionExists = true; break; }
    }
    if (sessionExists) {
      SessionManager.selectSession(lastSessionId);
      return;
    }
  }

  ChatView.showWelcome();
}

init().catch(function (e) {
  console.error('[App] 初始化失败:', e);
  showServerWaiting();
});
