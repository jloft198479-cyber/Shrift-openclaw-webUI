/**
 * event-router.js — 连接状态 UI
 *
 * 职责：Gateway 连接等待/重试界面
 * 全局 UI 交互绑定已迁移到 ui/interaction-bindings.js
 */

function showServerWaiting() {
  const welcome = document.getElementById('welcome');
  if (!welcome) return;
  welcome.classList.remove('hidden');
  welcome.innerHTML = '<h2>正在连接 ' + APP_NAME + ' Gateway…</h2>'
    + '<p style="color:var(--text-2)">请确保 ' + APP_NAME + ' Gateway 已启动</p>'
    + '<p style="margin-top:12px"><button onclick="retryConnection()" style="padding:8px 20px;border-radius:8px;border:1px solid var(--border);background:var(--surface);cursor:pointer;font-family:var(--font)">重试</button></p>';
}

async function retryConnection() {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.innerHTML = '<h2>正在重试…</h2>';
  try {
    const online = await Api.checkHealth();
    if (online) {
      ChatView.showWelcome();
    } else {
      showServerWaiting();
    }
  } catch (e) {
    setTimeout(showServerWaiting, 1000);
  }
}
