/* ── attachment-bar.js — 文件附件 UI + 上传 ──────────────── */

const AttachmentBar = {
  pendingAttachments: [],
  MAX_FILE_SIZE: 10 * 1024 * 1024,

  /**
   * 添加文件到待上传列表
   */
  handleFiles: function (files) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > this.MAX_FILE_SIZE) {
        showToast('文件 "' + file.name + '" 超过 10MB 限制');
        continue;
      }
      const att = {
        id: 'att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        file: file,
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        previewUrl: null,
      };
      if (file.type && file.type.indexOf('image/') === 0) {
        att.previewUrl = URL.createObjectURL(file);
      }
      this.pendingAttachments.push(att);
    }
    this.render();
  },

  /**
   * 渲染附件栏
   */
  render: function () {
    let bar = document.getElementById('attachment-bar');
    if (this.pendingAttachments.length === 0) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'attachment-bar';
      const inputArea = document.getElementById('input-area');
      const wrap = inputArea ? inputArea.querySelector('.input-wrap') : null;
      if (inputArea && wrap) inputArea.insertBefore(bar, wrap);
    }

    const self = this;
    bar.innerHTML = this.pendingAttachments.map(function (att) {
      const icon = att.previewUrl
        ? '<img src="' + att.previewUrl + '" class="att-preview" alt="">'
        : self._getFileIcon(att.type);
      const shortName = att.name.length > 14 ? att.name.slice(0, 12) + '…' : att.name;
      const sizeStr = att.size < 1024 ? att.size + 'B'
        : att.size < 1048576 ? (att.size / 1024).toFixed(0) + 'K'
        : (att.size / 1048576).toFixed(1) + 'M';
      return '<div class="attachment-tag" data-id="' + att.id + '">'
        + icon
        + '<span class="att-info" title="' + escapeHtml(att.name) + '">'
        + '<span class="att-name">' + escapeHtml(shortName) + '</span>'
        + '<span class="att-size">' + sizeStr + '</span>'
        + '</span>'
        + '<button class="att-remove" data-id="' + att.id + '" title="移除">×</button>'
        + '</div>';
    }).join('');

    bar.querySelectorAll('.att-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.id;
        for (var j = 0; j < self.pendingAttachments.length; j++) {
          if (self.pendingAttachments[j].id === id) {
            if (self.pendingAttachments[j].previewUrl) URL.revokeObjectURL(self.pendingAttachments[j].previewUrl);
            self.pendingAttachments.splice(j, 1);
            break;
          }
        }
        self.render();
      });
    });
  },

  /**
   * 清空所有附件
   */
  clear: function () {
    for (let i = 0; i < this.pendingAttachments.length; i++) {
      if (this.pendingAttachments[i].previewUrl) URL.revokeObjectURL(this.pendingAttachments[i].previewUrl);
    }
    this.pendingAttachments = [];
    this.render();
  },

  /**
   * 上传所有附件到服务器
   * @returns {Promise<Array>} 上传结果数组
   */
  uploadAll: async function () {
    const results = [];
    for (let i = 0; i < this.pendingAttachments.length; i++) {
      const att = this.pendingAttachments[i];
      const reader = new FileReader();
      const dataUrl = await new Promise(function (resolve) {
        reader.onload = function () { resolve(reader.result); };
        reader.readAsDataURL(att.file);
      });
      const resp = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: att.name, type: att.type, data: dataUrl }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(function () { return {}; });
        throw new Error(err.error || '上传失败 (HTTP ' + resp.status + ')');
      }
      const result = await resp.json();
      // 保留 dataUrl 供 API 消息构建使用（图片用 data: URL 传给 Gateway，无需回调）
      result.dataUrl = dataUrl;
      results.push(result);
    }
    return results;
  },

  /**
   * 根据 MIME 类型返回文件图标
   */
  _getFileIcon: function (mimeType) { return '<span class="att-icon">' + getAttachmentIcon(mimeType) + '</span>'; },
};
