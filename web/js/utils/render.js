/**
 * render.js — Markdown 渲染模块
 *
 * 职责：Markdown → HTML 转换、代码块渲染、复制按钮事件
 *
 * 依赖：Utils（已通过 utils.js 加载）
 */

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
    const id = 'cb-' + Utils.uid();
    const langLabel = lang ? '<span class="cb-lang">' + Utils.escapeHtml(lang) + '</span>' : '<span class="cb-lang">code</span>';
    return '<div class="code-block">'
      + '<div class="code-header">'
      + langLabel
      + '<button class="cb-copy" data-cb-id="' + id + '" title="复制代码">复制</button>'
      + '</div>'
      + '<pre class="code-pre"><code id="' + id + '" class="' + (lang ? 'language-' + Utils.escapeHtml(lang) : '') + '">' + code + '</code></pre>'
      + '</div>';
  };
  /* 图片渲染：将本地绝对路径转换为 /api/file 代理 URL */
  _mdRenderer.image = function(obj) {
    var href = typeof obj === 'object' ? (obj.href || '') : (obj || '');
    var text = typeof obj === 'object' ? (obj.text || obj.title || '') : '';
    var title = typeof obj === 'object' ? (obj.title || '') : '';
    var src = href;

    // 检测本地绝对路径并转换
    // 1. /D:/... 或 /C:/... 格式（Unix 风格 Windows 路径）
    if (/^\/[A-Za-z]:\//.test(src)) {
      src = src.substring(1);
    }
    // 2. 已经是绝对路径（Windows 或 Unix）→ 转为 /api/file URL
    if (/^[A-Za-z]:[\\\/]/.test(src) || /^\//.test(src)) {
      src = '/api/file?path=' + encodeURIComponent(src);
    }

    var attrs = 'src="' + Utils.escapeHtml(src) + '"';
    if (text) attrs += ' alt="' + Utils.escapeHtml(text) + '"';
    if (title) attrs += ' title="' + Utils.escapeHtml(title) + '"';
    attrs += ' loading="lazy"';
    return '<img ' + attrs + '>';
  };
  return _mdRenderer;
}

/* Markdown 渲染结果缓存（LRU，避免重复 marked.parse + DOMPurify） */
const _mdCache = new Map();
const _mdCacheMax = Constants.LIMIT.MD_CACHE_MAX;

/**
 * 渲染 Markdown 为 HTML
 * @param {string} text - Markdown 文本
 * @param {boolean} [streaming=false] - 是否处于流式渲染中（流式期间不写缓存）
 * @returns {string} HTML 字符串
 */
function renderMarkdown(text, streaming) {
  if (!text) return '';
  const cached = _mdCache.get(text);
  if (cached) return cached;
  // 预处理：纯文本图片路径 → markdown 图片语法，让 _mdRenderer.image 接管渲染
  text = text.replace(/(?<!\]\()([A-Za-z]:[\\\/][^\s<>|*]+\.(png|jpg|jpeg|gif|svg|webp))(?!\()/gi, function(match, path) {
    var name = path.split(/[\\\/]/).pop();
    return '![' + name + '](' + path.replace(/\\/g, '/') + ')';
  });
  let html;
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
    html = Utils.escapeHtml(text).replace(/\n/g, '<br>');
  }
  // 流式期间不写缓存：中间结果永远不会命中，写缓存浪费内存和 CPU
  if (!streaming) {
    _mdCache.set(text, html);
    if (_mdCache.size > _mdCacheMax) {
      const first = _mdCache.keys().next().value;
      _mdCache.delete(first);
    }
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
  Utils.copyToClipboard(text, done);
});
