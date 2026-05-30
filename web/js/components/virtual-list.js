/**
 * virtual-list.js — 虚拟列表组件
 *
 * 职责：长列表性能优化，只渲染可见区域的消息
 *
 * 原理：
 * 1. 计算可见区域范围（scrollTop, clientHeight）
 * 2. 只渲染可见区域内的消息（+ 缓冲区）
 * 3. 滚动时动态更新渲染内容
 *
 * 使用方式：
 *   VirtualList.init(container, options);
 *   VirtualList.render(messages);
 *   VirtualList.appendMessage(message);
 *   VirtualList.scrollToBottom();
 */

var VirtualList = {
  /** 容器元素 */
  _container: null,
  /** 内容元素 */
  _content: null,
  /** 消息数据列表 */
  _messages: [],
  /** 消息高度缓存 */
  _heightCache: new Map(),
  /** 可见区域起始索引 */
  _startIndex: 0,
  /** 可见区域结束索引 */
  _endIndex: 0,
  /** 缓冲区大小（上下各渲染几条） */
  _bufferSize: 5,
  /** 预估消息高度（用于未测量的消息） */
  _estimatedHeight: 80,
  /** 是否启用虚拟滚动 */
  _enabled: false,
  /** 消息阈值（超过此数量启用虚拟滚动） */
  _threshold: 50,
  /** rAF 节流 ID */
  _rafId: null,
  /** 是否正在滚动 */
  _scrolling: false,
  /** 滚动结束定时器 */
  _scrollEndTimer: null,

  /**
   * 初始化虚拟列表
   * @param {HTMLElement} container - 滚动容器
   * @param {Object} [options] - 配置选项
   */
  init: function (container, options) {
    if (!container) return;

    this._container = container;
    this._bufferSize = (options && options.bufferSize) || 5;
    this._threshold = (options && options.threshold) || 50;
    this._estimatedHeight = (options && options.estimatedHeight) || 80;

    // 创建内容容器
    this._content = container.querySelector('.messages-inner');
    if (!this._content) {
      this._content = document.createElement('div');
      this._content.className = 'messages-inner';
      container.appendChild(this._content);
    }

    // 绑定滚动事件
    var self = this;
    container.addEventListener('scroll', function () {
      if (self._rafId) return;
      self._rafId = requestAnimationFrame(function () {
        self._rafId = null;
        self._onScroll();
      });
    });
  },

  /**
   * 渲染所有消息
   * @param {Array} messages - 消息列表
   */
  render: function (messages) {
    this._messages = messages || [];
    this._heightCache.clear();

    // 如果消息数量少于阈值，直接渲染所有消息
    if (this._messages.length < this._threshold) {
      this._enabled = false;
      this._renderAll();
      return;
    }

    // 启用虚拟滚动
    this._enabled = true;
    this._updateVisibleRange();
    this._renderVisible();
  },

  /**
   * 追加一条消息
   * @param {Object} message - 消息对象
   */
  appendMessage: function (message) {
    this._messages.push(message);

    // 如果消息数量少于阈值，直接追加
    if (!this._enabled) {
      if (this._messages.length >= this._threshold) {
        // 达到阈值，切换到虚拟滚动
        this._enabled = true;
        this._updateVisibleRange();
        this._renderVisible();
      } else {
        // 直接追加
        this._appendMessageToDOM(message);
      }
      return;
    }

    // 虚拟滚动模式：更新可见区域
    this._updateVisibleRange();
    this._renderVisible();
  },

  /**
   * 滚动到底部
   * @param {boolean} [smooth=true] - 是否平滑滚动
   */
  scrollToBottom: function (smooth) {
    if (!this._container) return;
    if (smooth === undefined) smooth = true;

    if (!smooth) {
      this._container.scrollTop = this._container.scrollHeight;
      return;
    }

    this._container.scrollTo({
      top: this._container.scrollHeight,
      behavior: 'smooth'
    });
  },

  /**
   * 获取消息数量
   * @returns {number} 消息数量
   */
  getCount: function () {
    return this._messages.length;
  },

  /**
   * 清空消息
   */
  clear: function () {
    this._messages = [];
    this._heightCache.clear();
    this._startIndex = 0;
    this._endIndex = 0;
    if (this._content) {
      this._content.innerHTML = '';
    }
  },

  /**
   * 更新消息（用于流式渲染）
   * @param {number} index - 消息索引
   * @param {Object} message - 新的消息对象
   */
  updateMessage: function (index, message) {
    if (index < 0 || index >= this._messages.length) return;
    this._messages[index] = message;

    // 如果在可见范围内，更新 DOM
    if (this._enabled && index >= this._startIndex && index <= this._endIndex) {
      this._renderVisible();
    }
  },

  /**
   * 滚动事件处理
   * @private
   */
  _onScroll: function () {
    if (!this._enabled) return;

    this._scrolling = true;
    clearTimeout(this._scrollEndTimer);

    var self = this;
    this._scrollEndTimer = setTimeout(function () {
      self._scrolling = false;
    }, 150);

    this._updateVisibleRange();
    this._renderVisible();
  },

  /**
   * 更新可见区域范围
   * @private
   */
  _updateVisibleRange: function () {
    if (!this._container || this._messages.length === 0) {
      this._startIndex = 0;
      this._endIndex = 0;
      return;
    }

    var scrollTop = this._container.scrollTop;
    var clientHeight = this._container.clientHeight;

    // 计算可见区域起始位置
    var startIndex = this._getIndexAtOffset(scrollTop);
    var endIndex = this._getIndexAtOffset(scrollTop + clientHeight);

    // 添加缓冲区
    this._startIndex = Math.max(0, startIndex - this._bufferSize);
    this._endIndex = Math.min(this._messages.length - 1, endIndex + this._bufferSize);
  },

  /**
   * 获取指定偏移量对应的消息索引（二分查找，O(log n)）
   * @param {number} offset - 偏移量（像素）
   * @returns {number} 消息索引
   * @private
   */
  _getIndexAtOffset: function (offset) {
    var low = 0;
    var high = this._messages.length - 1;
    var currentOffset = 0;
    var midOffset = 0;

    while (low <= high) {
      var mid = Math.floor((low + high) / 2);
      midOffset = 0;
      for (var i = 0; i < mid; i++) {
        midOffset += this._getMessageHeight(i);
      }
      var midHeight = this._getMessageHeight(mid);

      if (midOffset + midHeight <= offset) {
        low = mid + 1;
      } else if (midOffset > offset) {
        high = mid - 1;
      } else {
        return mid;
      }
    }
    return Math.max(0, Math.min(low, this._messages.length - 1));
  },

  /**
   * 获取消息高度（优先使用缓存，否则使用预估高度）
   * @param {number} index - 消息索引
   * @returns {number} 消息高度（像素）
   * @private
   */
  _getMessageHeight: function (index) {
    if (this._heightCache.has(index)) {
      return this._heightCache.get(index);
    }
    return this._estimatedHeight;
  },

  /**
   * 渲染所有消息（非虚拟模式）
   * @private
   */
  _renderAll: function () {
    if (!this._content) return;
    this._content.innerHTML = '';

    for (var i = 0; i < this._messages.length; i++) {
      var message = this._messages[i];
      var el = this._createMessageElement(message);
      if (el) {
        this._content.appendChild(el);
        // 缓存高度
        this._heightCache.set(i, el.offsetHeight);
      }
    }
  },

  /**
   * 渲染可见区域的消息（虚拟模式）
   * @private
   */
  _renderVisible: function () {
    if (!this._content || this._messages.length === 0) return;

    // 计算总高度
    var totalHeight = 0;
    for (var i = 0; i < this._messages.length; i++) {
      totalHeight += this._getMessageHeight(i);
    }

    // 计算可见区域上方的高度
    var topHeight = 0;
    for (var i = 0; i < this._startIndex; i++) {
      topHeight += this._getMessageHeight(i);
    }

    // 清空内容
    this._content.innerHTML = '';

    // 创建上方占位元素
    if (topHeight > 0) {
      var topSpacer = document.createElement('div');
      topSpacer.style.height = topHeight + 'px';
      this._content.appendChild(topSpacer);
    }

    // 渲染可见区域的消息
    for (var i = this._startIndex; i <= this._endIndex && i < this._messages.length; i++) {
      var message = this._messages[i];
      var el = this._createMessageElement(message);
      if (el) {
        this._content.appendChild(el);
        // 缓存高度
        this._heightCache.set(i, el.offsetHeight);
      }
    }

    // 创建下方占位元素
    var bottomHeight = totalHeight - topHeight;
    for (var i = this._startIndex; i <= this._endIndex && i < this._messages.length; i++) {
      bottomHeight -= this._getMessageHeight(i);
    }
    if (bottomHeight > 0) {
      var bottomSpacer = document.createElement('div');
      bottomSpacer.style.height = bottomHeight + 'px';
      this._content.appendChild(bottomSpacer);
    }
  },

  /**
   * 创建消息 DOM 元素
   * @param {Object} message - 消息对象
   * @returns {HTMLElement|null} 消息元素
   * @private
   */
  _createMessageElement: function (message) {
    if (!message) return null;

    // 调用 MessageRenderer 创建消息元素
    if (typeof MessageRenderer !== 'undefined' && MessageRenderer.createMessageElement) {
      return MessageRenderer.createMessageElement(
        message.role,
        message.content,
        message.streaming,
        message.thinking,
        message.agentId,
        message.attachmentMeta
      );
    }

    // 降级方案：简单创建消息元素
    var div = document.createElement('div');
    div.className = 'message ' + (message.role || 'assistant');

    var avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = message.role === 'user' ? '你' : 'AI';
    div.appendChild(avatar);

    var bubble = document.createElement('div');
    bubble.className = 'bubble';

    var contentEl = document.createElement('div');
    contentEl.className = 'agent-content';
    contentEl.textContent = message.content || '';
    bubble.appendChild(contentEl);

    div.appendChild(bubble);
    return div;
  },

  /**
   * 直接追加消息到 DOM（非虚拟模式）
   * @param {Object} message - 消息对象
   * @private
   */
  _appendMessageToDOM: function (message) {
    if (!this._content) return;

    var el = this._createMessageElement(message);
    if (el) {
      this._content.appendChild(el);
      // 缓存高度
      this._heightCache.set(this._messages.length - 1, el.offsetHeight);
    }
  },
};
