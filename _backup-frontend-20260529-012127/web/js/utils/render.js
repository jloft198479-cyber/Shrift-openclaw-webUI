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

/* Markdown 渲染结果缓存（LRU 64 条，避免重复 marked.parse + DOMPurify） */
var _mdCache = new Map();
var _mdCacheMax = 64;
function renderMarkdown(text) {
  if (!text) return '';
  var cached = _mdCache.get(text);
  if (cached) return cached;
  var html;
  if (typeof marked !== 'undefined') {
    const raw = marked.parse(text, { breaks: true, gfm: true, renderer: _getMdRenderer() });
    if (typeof DOMPurify !== 'undefined') {
      html = DOMPurify.sanitize(raw, {
        ADD_TAGS: ['code', 'pre', 'span', 'button', 'img'],
        ADD_ATTR: ['class', 'id', 'data-cb-id', 'title', 'alt', 'loading'],
      });
    } else {
      html = raw;
    }
  } else {
    html = escapeHtml(text).replace(/\n/g, '<br>');
  }
  _mdCache.set(text, html);
  if (_mdCache.size > _mdCacheMax) {
    var first = _mdCache.keys().next().value;
    _mdCache.delete(first);
  }
  return html;
}

/* 复制按钮事件委托（含 execCommand fallback） */
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.cb-copy');
  if (!btn) return;
  const id = btn.getAttribute('data-cb-id');
  const codeEl = document.getElementById(id);
  if (!codeEl) return;
  const text = codeEl.textContent || codeEl.innerText;
  function done() {
    btn.textContent = '已复制 ✓';
    btn.classList.add('copied');
    setTimeout(function() {
      btn.textContent = '复制';
      btn.classList.remove('copied');
    }, 1500);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch(ex) {}
      document.body.removeChild(ta);
    });
  } else {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch(ex) {}
    document.body.removeChild(ta);
  }
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

/* 滚动到底部（内置 rAF 节流，高频调用时合并） */
var _scrollRafId = null;
function scrollToBottom(el, smooth) {
  if (!el) return;
  if (smooth === undefined) smooth = true;
  if (!smooth) {
    el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
    return;
  }
  if (_scrollRafId) return;
  _scrollRafId = requestAnimationFrame(function () {
    _scrollRafId = null;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  });
}

/* 输入框自动调整高度 */
function autoResize() {
  const el = document.getElementById('input');
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

/* HTML 转义（纯字符串替换，零 DOM 开销） */
const _escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const _escRe = /[&<>"']/g;
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(_escRe, function (ch) { return _escMap[ch]; });
}


/* MIME 类型 → 附件图标（共享函数） */
function getAttachmentIcon(mimeType) {
  if (!mimeType) return '📎';
  if (mimeType.indexOf('image/') === 0) return '🖼';
  if (mimeType.indexOf('pdf') >= 0) return '📄';
  if (mimeType.indexOf('zip') >= 0 || mimeType.indexOf('rar') >= 0 || mimeType.indexOf('tar') >= 0 || mimeType.indexOf('7z') >= 0) return '📦';
  if (mimeType.indexOf('text') >= 0 || mimeType.indexOf('javascript') >= 0 || mimeType.indexOf('json') >= 0 || mimeType.indexOf('xml') >= 0 || mimeType.indexOf('html') >= 0 || mimeType.indexOf('css') >= 0) return '📝';
  if (mimeType.indexOf('sheet') >= 0 || mimeType.indexOf('excel') >= 0) return '📊';
  if (mimeType.indexOf('word') >= 0 || mimeType.indexOf('document') >= 0) return '📃';
  return '📎';
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

function _isImageAvatar(val) {
  if (val.indexOf('://') > 0) return true;
  if (val.startsWith('avatars/')) return true;
  if (/\.(svg|png|jpg|jpeg|gif|webp)$/i.test(val)) return true;
  return false;
}

function renderAgentAvatar(avatar, name) {
  const icon = avatar || '🤖';
  if (typeof icon === 'string' && _isImageAvatar(icon)) {
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