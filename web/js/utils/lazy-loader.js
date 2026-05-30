/**
 * lazy-loader.js — 懒加载工具
 *
 * 职责：按需加载 JS 文件，减少首屏加载时间
 *
 * 使用方式：
 *   LazyLoader.load('js/components/agent-modal.js').then(function () {
 *     // agent-modal.js 已加载
 *   });
 *
 *   // 或者使用 async/await
 *   await LazyLoader.load('js/components/agent-modal.js');
 */

var LazyLoader = {
  /** 已加载的脚本缓存 */
  _loaded: new Map(),

  /** 正在加载的脚本 Promise */
  _loading: new Map(),

  /**
   * 加载 JS 文件
   * @param {string} url - 脚本 URL
   * @param {Object} [options] - 选项
   * @param {boolean} [options.cache=true] - 是否缓存
   * @returns {Promise<void>} 加载完成的 Promise
   */
  load: function (url, options) {
    options = options || {};
    var cache = options.cache !== false;

    // 如果已加载，直接返回
    if (cache && this._loaded.has(url)) {
      return Promise.resolve();
    }

    // 如果正在加载，返回现有的 Promise
    if (this._loading.has(url)) {
      return this._loading.get(url);
    }

    // 创建新的加载 Promise
    var self = this;
    var promise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = url;
      script.async = true;

      script.onload = function () {
        if (cache) {
          self._loaded.set(url, true);
        }
        self._loading.delete(url);
        resolve();
      };

      script.onerror = function () {
        self._loading.delete(url);
        reject(new Error('Failed to load script: ' + url));
      };

      document.head.appendChild(script);
    });

    this._loading.set(url, promise);
    return promise;
  },

  /**
   * 批量加载 JS 文件
   * @param {string[]} urls - 脚本 URL 列表
   * @returns {Promise<void[]>} 加载完成的 Promise
   */
  loadAll: function (urls) {
    var promises = [];
    for (var i = 0; i < urls.length; i++) {
      promises.push(this.load(urls[i]));
    }
    return Promise.all(promises);
  },

  /**
   * 预加载 JS 文件（不执行）
   * @param {string} url - 脚本 URL
   */
  prefetch: function (url) {
    if (this._loaded.has(url) || this._loading.has(url)) {
      return;
    }

    var link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    link.as = 'script';
    document.head.appendChild(link);
  },

  /**
   * 检查脚本是否已加载
   * @param {string} url - 脚本 URL
   * @returns {boolean} 是否已加载
   */
  isLoaded: function (url) {
    return this._loaded.has(url);
  },
};
