/* ── 渲染工具函数 ──────────────────────────────────────────── */

var APP_NAME = '虾指挥';
var LOGO_SRC = 'logo.svg';

/* ── Markdown → HTML（基于 CDN 加载的 marked.js） ───────── */
/* 自定义 renderer：给代码块加语言标签 + 复制按钮 */
let _mdRenderer = null;
function _getMdRenderer() {
  if (_mdRenderer) return _mdRenderer;
  _mdRenderer = new marked.Renderer();
  _mdRenderer.code = function(obj) {
    // marked v12+ 传入 {text, lang, escaped} 对象
    const code = typeof obj === 'object' ? obj.text : obj;
    const lang = typeof obj === 'object' ? (obj.lang || '') : arguments[1] || '';
    const id = 'cb-' + uid();
    const langLabel = lang ? '<span class="cb-lang">' + escapeHtml(lang) + '</span>' : '<span class="cb-lang">code</span>';
    return '<div class="code-block">'
      + '<div class="code-header">'
      + langLabel
      + '<button class="cb-copy" data-cb-id="' + id + '" title="复制代码">复制</button>'
      + '</div>'
      + '<pre class="code-pre"><code id="' + id + '" class="' + (lang ? 'language-' + escapeHtml(lang) : '') + '">' + code + '</code></pre>'
      + '</div>';
  };
  return _mdRenderer;
}

function renderMarkdown(text) {
  if (!text) return '';
  if (typeof marked !== 'undefined') {
    const raw = marked.parse(text, { breaks: true, gfm: true, renderer: _getMdRenderer() });
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(raw, {
        ADD_TAGS: ['code', 'pre', 'span', 'button', 'img'],
        ADD_ATTR: ['class', 'id', 'data-cb-id', 'title', 'alt', 'loading'],
      });
    }
    return raw;
  }
  return escapeHtml(text).replace(/\n/g, '<br>');
}

/* 复制按钮事件委托 */
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.cb-copy');
  if (!btn) return;
  const id = btn.getAttribute('data-cb-id');
  const codeEl = document.getElementById(id);
  if (!codeEl) return;
  const text = codeEl.textContent || codeEl.innerText;
  navigator.clipboard.writeText(text).then(function() {
    btn.textContent = '已复制 ✓';
    btn.classList.add('copied');
    setTimeout(function() {
      btn.textContent = '复制';
      btn.classList.remove('copied');
    }, 1500);
  }).catch(function() {
    btn.textContent = '复制失败';
    setTimeout(function() { btn.textContent = '复制'; }, 1500);
  });
});

/* DOM 选择器简写 */
const $ = (sel, parent) => (parent || document).querySelector(sel);
const $$ = (sel, parent) => Array.from((parent || document).querySelectorAll(sel));

/* 创建 DOM 元素 */
function createElement(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'innerHTML') el.innerHTML = v;
    else el.setAttribute(k, v);
  }
  for (const child of children) {
    if (child != null) el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

/* 滚动到底部 */
function scrollToBottom(el, smooth = true) {
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
}

/* 输入框自动调整高度 */
function autoResize() {
  const el = document.getElementById('input');
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

/* HTML 转义 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* 生成唯一 ID */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}


/* 相对时间格式化 */
function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('zh-CN', opts);
}

/* Logo SVG — 官方 Claude 星芒标志 */
function logoSvg(size) {
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 28 28" fill="none">'
    + '<rect width="28" height="28" rx="7" fill="url(#lg' + size + ')"/>'
    + '<g transform="translate(2,2)">'
    + '<path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#fff" fill-rule="nonzero"/>'
    + '</g>'
    + '<defs><linearGradient id="lg' + size + '" x1="0" y1="0" x2="28" y2="28"><stop stop-color="#C96442"/><stop offset="1" stop-color="#B3573A"/></linearGradient></defs></svg>';
}

/* 获取默认 Agent 图标 */
function getAgentIcon(name) {
  const icons = { '小红书写手': '✏️', '公众号助手': '📝', '调研助手': '🔍', '代码助手': '💻', '翻译助手': '🌐' };
  return icons[name] || '🤖';
}

/* 渲染 Agent 头像：SVG 路径用 img，否则用 emoji 文本 */
function renderAgentAvatar(avatar, name) {
  const icon = avatar || getAgentIcon(name);
  if (typeof icon === 'string' && icon.startsWith('avatars/')) {
    return '<img src="' + icon + '" alt="" class="agent-avatar-img">';
  }
  return icon;
}

/* Toast 通知 */
function showToast(msg, duration, type) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = createElement('div', { className: 'toast' });
    document.body.appendChild(t);
  }
  const typeClass = type ? 'toast-' + type : 'toast-default';
  t.className = 'toast ' + typeClass;
  t.textContent = msg;
  t.style.display = '';
  t.style.opacity = '1';
  t.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(t._hide);
  t._hide = setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(8px)';
    setTimeout(() => { t.style.display = 'none'; }, 300);
  }, duration || 2500);
}
