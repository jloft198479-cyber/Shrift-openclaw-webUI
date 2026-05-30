/**
 * error-handler.js — 统一错误处理层
 *
 * 职责：统一处理所有错误，提供一致的用户体验
 *
 * 使用方式：
 *   ErrorHandler.handle(error, 'api');
 *   ErrorHandler.handle(error, 'chat', { bubble: bubbleEl });
 *   ErrorHandler.handle(error, 'upload');
 *
 * 错误上下文：
 *   api     — API 请求错误（Toast 提示）
 *   chat    — 聊天消息错误（气泡内显示）
 *   upload  — 文件上传错误（Toast 提示）
 *   config  — 配置错误（Modal 提示）
 *   network — 网络错误（Toast 提示）
 *   unknown — 未知错误（Toast 提示）
 */

var ErrorHandler = {
  /**
   * 处理错误
   *
   * @param {Error|string} error - 错误对象或消息
   * @param {string} context - 错误上下文
   * @param {Object} [options] - 选项
   * @param {HTMLElement} [options.bubble] - 气泡元素（chat 上下文）
   * @param {string} [options.prefix] - 错误前缀
   * @param {boolean} [options.silent] - 是否静默（不显示提示）
   */
  handle: function (error, context, options) {
    options = options || {};
    var message = this._extractMessage(error);
    var prefix = options.prefix || this._getDefaultPrefix(context);

    // 1. 记录日志
    this._log(error, context, message);

    // 2. 如果静默模式，只记录日志
    if (options.silent) return;

    // 3. 根据上下文选择提示方式
    switch (context) {
      case 'chat':
        this._showBubbleError(options.bubble, prefix, message);
        break;
      case 'api':
      case 'upload':
      case 'network':
      case 'unknown':
      default:
        this._showToastError(prefix, message);
        break;
    }
  },

  /**
   * 提取错误消息
   * @param {Error|string} error - 错误对象或消息
   * @returns {string} 错误消息
   * @private
   */
  _extractMessage: function (error) {
    if (typeof error === 'string') return error;
    if (error && error.message) return error.message;
    if (error && error.statusText) return error.statusText;
    return '未知错误';
  },

  /**
   * 获取默认前缀
   * @param {string} context - 错误上下文
   * @returns {string} 前缀
   * @private
   */
  _getDefaultPrefix: function (context) {
    var prefixes = {
      api: 'API 错误',
      chat: '错误',
      upload: '上传失败',
      config: '配置错误',
      network: '网络错误',
      unknown: '错误',
    };
    return prefixes[context] || '错误';
  },

  /**
   * 记录日志
   * @param {Error|string} error - 错误对象或消息
   * @param {string} context - 错误上下文
   * @param {string} message - 错误消息
   * @private
   */
  _log: function (error, context, message) {
    var logMessage = '[ErrorHandler][' + context + '] ' + message;
    if (error instanceof Error && error.stack) {
      console.error(logMessage, error.stack);
    } else {
      console.error(logMessage, error);
    }
  },

  /**
   * 显示 Toast 错误提示
   * @param {string} prefix - 错误前缀
   * @param {string} message - 错误消息
   * @private
   */
  _showToastError: function (prefix, message) {
    if (typeof showToast === 'function') {
      showToast(prefix + ': ' + message, 3000, 'error');
    } else {
      // fallback：如果 showToast 不可用，使用 alert
      alert(prefix + ': ' + message);
    }
  },

  /**
   * 在气泡中显示错误提示
   * @param {HTMLElement} bubble - 气泡元素
   * @param {string} prefix - 错误前缀
   * @param {string} message - 错误消息
   * @private
   */
  _showBubbleError: function (bubble, prefix, message) {
    if (!bubble) {
      // 如果没有气泡，降级到 Toast
      this._showToastError(prefix, message);
      return;
    }
    if (typeof MessageRenderer !== 'undefined' && MessageRenderer.showError) {
      MessageRenderer.showError(bubble, prefix, message);
    } else {
      // fallback：直接操作 DOM
      bubble.innerHTML = '<div class="chat-error">'
        + '<span class="chat-error-icon">⚠</span>'
        + '<span class="chat-error-label">[' + (prefix || '错误') + ']</span> '
        + (message || '请求失败')
        + '</div>';
      bubble.classList.remove('streaming-cursor');
    }
  },

  /**
   * 创建 API 错误包装器
   *
   * 使用方式：
   *   try {
   *     await ErrorHandler.wrapApi(apiCall(), '获取数据');
   *   } catch (err) {
   *     // err 已经被 ErrorHandler 处理过了
   *   }
   *
   * @param {Promise} promise - API Promise
   * @param {string} operation - 操作描述
   * @returns {Promise} 包装后的 Promise
   */
  wrapApi: async function (promise, operation) {
    try {
      return await promise;
    } catch (err) {
      this.handle(err, 'api', { prefix: operation + '失败' });
      throw err;
    }
  },
};
