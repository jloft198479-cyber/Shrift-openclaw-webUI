/**
 * utils.js — 通用工具函数模块
 *
 * 职责：封装所有通用工具函数，避免全局污染
 *
 * 使用方式：
 *   Utils.escapeHtml(text)
 *   Utils.uid()
 *   Utils.fmtDate(ts)
 *
 * 向后兼容：保留全局函数别名，逐步迁移到 Utils.xxx
 */

const Utils = {
  /* ── 常量 ────────────────────────────────────────────── */
  APP_NAME: '虾指挥',
  LOGO_SRC: '/logo.svg',

  /* ── 字符串工具 ──────────────────────────────────────── */

  /**
   * HTML 转义（纯字符串替换，零 DOM 开销）
   * @param {string} str - 原始字符串
   * @returns {string} 转义后的字符串
   */
  escapeHtml: function (str) {
    if (!str) return '';
    const escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(str).replace(/[&<>"']/g, function (ch) { return escMap[ch]; });
  },

  /**
   * 生成唯一 ID
   * @returns {string} 唯一 ID
   */
  uid: function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  },

  /* ── 时间工具 ──────────────────────────────────────────── */

  /**
   * 相对时间格式化
   * @param {number} ts - 时间戳
   * @returns {string} 格式化后的时间字符串
   */
  fmtDate: function (ts) {
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
  },

  /* ── DOM 工具 ──────────────────────────────────────────── */

  /**
   * DOM 选择器简写
   * @param {string} sel - 选择器
   * @param {Element} [parent] - 父元素
   * @returns {Element|null}
   */
  $: function (sel, parent) {
    return (parent || document).querySelector(sel);
  },

  /**
   * DOM 选择器简写（多个）
   * @param {string} sel - 选择器
   * @param {Element} [parent] - 父元素
   * @returns {Element[]}
   */
  $$: function (sel, parent) {
    return Array.from((parent || document).querySelectorAll(sel));
  },

  /**
   * 创建 DOM 元素
   * @param {string} tag - 标签名
   * @param {Object} [attrs] - 属性
   * @param {Array} [children] - 子元素
   * @returns {Element}
   */
  createElement: function (tag, attrs, children) {
    attrs = attrs || {};
    children = children || [];
    const el = document.createElement(tag);
    const entries = Object.entries(attrs);
    for (let i = 0; i < entries.length; i++) {
      const k = entries[i][0];
      const v = entries[i][1];
      if (k === 'className') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'innerHTML') el.innerHTML = v;
      else el.setAttribute(k, v);
    }
    for (let j = 0; j < children.length; j++) {
      const child = children[j];
      if (child != null) el.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return el;
  },

  /* ── 滚动工具 ──────────────────────────────────────────── */

  _scrollRafId: null,

  /**
   * 滚动到底部（内置 rAF 节流，高频调用时合并）
   * @param {Element} el - 滚动容器
   * @param {boolean} [smooth=true] - 是否平滑滚动
   */
  scrollToBottom: function (el, smooth) {
    if (!el) return;
    if (smooth === undefined) smooth = true;
    if (!smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
      return;
    }
    if (this._scrollRafId) return;
    const self = this;
    this._scrollRafId = requestAnimationFrame(function () {
      self._scrollRafId = null;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
  },

  /**
   * 输入框自动调整高度
   */
  autoResize: function () {
    const el = document.getElementById('input');
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  },

  /* ── 附件工具 ──────────────────────────────────────────── */

  /**
   * MIME 类型 → 附件图标
   * @param {string} mimeType - MIME 类型
   * @returns {string} 图标字符
   */
  getAttachmentIcon: function (mimeType) {
    if (!mimeType) return '📎';
    if (mimeType.indexOf('image/') === 0) return '🖼';
    if (mimeType.indexOf('pdf') >= 0) return '📄';
    if (mimeType.indexOf('zip') >= 0 || mimeType.indexOf('rar') >= 0 || mimeType.indexOf('tar') >= 0 || mimeType.indexOf('7z') >= 0) return '📦';
    if (mimeType.indexOf('text') >= 0 || mimeType.indexOf('javascript') >= 0 || mimeType.indexOf('json') >= 0 || mimeType.indexOf('xml') >= 0 || mimeType.indexOf('html') >= 0 || mimeType.indexOf('css') >= 0) return '📝';
    if (mimeType.indexOf('sheet') >= 0 || mimeType.indexOf('excel') >= 0) return '📊';
    if (mimeType.indexOf('word') >= 0 || mimeType.indexOf('document') >= 0) return '📃';
    return '📎';
  },

  /* ── Agent 工具 ──────────────────────────────────────────── */

  /**
   * 判断是否为图片头像
   * @param {string} val - 头像值
   * @returns {boolean}
   */
  _isImageAvatar: function (val) {
    if (val.indexOf('://') > 0) return true;
    if (val.startsWith('avatars/')) return true;
    if (/\.(svg|png|jpg|jpeg|gif|webp)$/i.test(val)) return true;
    return false;
  },

  /**
   * 渲染 Agent 头像
   * @param {string} avatar - 头像值（URL 或 emoji）
   * @param {string} name - Agent 名称
   * @returns {string} HTML 字符串
   */
  renderAgentAvatar: function (avatar, name) {
    const icon = avatar || '🤖';
    if (typeof icon === 'string' && this._isImageAvatar(icon)) {
      return '<img src="' + icon + '" alt="" class="agent-avatar-img">';
    }
    return icon;
  },

  /**
   * 标准化 Agent 列表
   * @param {Array} rawList - 原始 Agent 列表
   * @returns {Array} 标准化后的列表
   */
  normalizeAgents: function (rawList) {
    const self = this;
    return (rawList || []).map(function (a) {
      return Object.assign({}, a, {
        displayName: a.id === 'main' ? self.APP_NAME : (a.name || a.id),
        avatar: a.id === 'main' ? self.LOGO_SRC : (a.avatar || '')
      });
    });
  },

  /* ── 提及工具 ──────────────────────────────────────────── */

  _MENTION_RE: /@([^\s@]+)/g,

  /**
   * 高亮 @提及
   * @param {string} text - 原始文本
   * @returns {string} 高亮后的 HTML
   */
  highlightMentions: function (text) {
    if (!text) return '';
    const safe = this.escapeHtml(text);
    return safe.replace(this._MENTION_RE, '<span class="mention-chip">@$1</span>');
  },

  /* ── Toast 通知 ──────────────────────────────────────────── */

  /**
   * 显示 Toast 通知
   * @param {string} msg - 消息内容
   * @param {number} [duration=2500] - 显示时长（毫秒）
   * @param {string} [type='default'] - 类型（default/info/error/success）
   */
  showToast: function (msg, duration, type) {
    let t = document.querySelector('.toast');
    if (!t) {
      t = this.createElement('div', { className: 'toast' });
      document.body.appendChild(t);
    }
    const typeClass = type ? 'toast-' + type : 'toast-default';
    t.className = 'toast ' + typeClass;
    t.textContent = msg;
    t.style.display = '';
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(t._hide);
    t._hide = setTimeout(function () {
      t.style.opacity = '0';
      t.style.transform = 'translateX(-50%) translateY(8px)';
      setTimeout(function () { t.style.display = 'none'; }, 300);
    }, duration || 2500);
  },

  /* ── 复制工具 ──────────────────────────────────────────── */

  /**
   * 复制文本到剪贴板
   * @param {string} text - 要复制的文本
   * @param {Function} [onSuccess] - 成功回调
   * @param {Function} [onError] - 失败回调
   */
  copyToClipboard: function (text, onSuccess, onError) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (onSuccess) onSuccess();
      }).catch(function () {
        Utils._fallbackCopy(text, onSuccess, onError);
      });
    } else {
      this._fallbackCopy(text, onSuccess, onError);
    }
  },

  /**
   * 降级复制方案
   * @private
   */
  _fallbackCopy: function (text, onSuccess, onError) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      if (onSuccess) onSuccess();
    } catch (ex) {
      if (onError) onError(ex);
    }
    document.body.removeChild(ta);
  },
};

// ── 向后兼容：保留全局函数别名 ──────────────────────────────
// 这些别名允许现有代码继续工作，逐步迁移到 Utils.xxx

const APP_NAME = Utils.APP_NAME;
const LOGO_SRC = Utils.LOGO_SRC;

function escapeHtml(str) { return Utils.escapeHtml(str); }
function uid() { return Utils.uid(); }
function fmtDate(ts) { return Utils.fmtDate(ts); }

const $ = Utils.$;
const $$ = Utils.$$;
function createElement(tag, attrs, children) { return Utils.createElement(tag, attrs, children); }

function scrollToBottom(el, smooth) { return Utils.scrollToBottom(el, smooth); }
function autoResize() { return Utils.autoResize(); }

function getAttachmentIcon(mimeType) { return Utils.getAttachmentIcon(mimeType); }

function _isImageAvatar(val) { return Utils._isImageAvatar(val); }
function renderAgentAvatar(avatar, name) { return Utils.renderAgentAvatar(avatar, name); }
function normalizeAgents(rawList) { return Utils.normalizeAgents(rawList); }

function highlightMentions(text) { return Utils.highlightMentions(text); }

function showToast(msg, duration, type) { return Utils.showToast(msg, duration, type); }
