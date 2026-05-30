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
  return _mdRenderer;
}

/* Markdown 渲染结果缓存（LRU，避免重复 marked.parse + DOMPurify） */
const _mdCache = new Map();
const _mdCacheMax = Constants.LIMIT.MD_CACHE_MAX;

/**
 * 渲染 Markdown 文本为 HTML
 * @param {string} text - Markdown 文本
 * @returns {string} HTML 字符串
 */
function renderMarkdown(text) {
  if (!text) return '';
  const cached = _mdCache.get(text);
  if (cached) return cached;
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
  _mdCache.set(text, html);
  if (_mdCache.size > _mdCacheMax) {
    const first = _mdCache.keys().next().value;
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
  Utils.copyToClipboard(text, done);
});
