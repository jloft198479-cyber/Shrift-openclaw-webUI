// ── 模型选择器组件 ──────────────────────────────────────────
// 可复用：主对话底栏、Agent 编辑弹窗都用同一套 UI。
// 用法:
//   const picker = createModelPicker({
//     current: 'deepseek-v4-flash',
//     models: AppState.models,
//     onSelect: (modelId) => { /* 用户选了新模型 */ },
//     disabled: false,  // true 时展示静态提示，不响应点击
//   });
//   container.appendChild(picker.element);
//   picker.setModel('deepseek-v4-pro'); // 外部更新显示
//   picker.destroy(); // 清理
// ───────────────────────────────────────────────────────────

function createModelPicker({ current, models, onSelect, disabled }) {
  const isDisabled = disabled === true;
  let currentModel = current;
  let dd = null;
  let closeHandler = null;

  // ── 主体：药丸标签 ──────────────────────────────────────────
  const pill = document.createElement('span');
  pill.className = 'model-pill';

  function updatePill() {
    if (isDisabled) {
      const m = models.find(function(x) { return x.id === currentModel; });
      const label = m ? m.name : currentModel;
      pill.textContent = label + ' · 暂不支持切换';
      pill.title = '当前模型暂不支持切换';
      pill.classList.add('disabled');
    } else {
      pill.textContent = currentModel;
      pill.title = currentModel + '。点击切换';
      pill.classList.remove('disabled');
    }
  }

  // ── 下拉列表 ────────────────────────────────────────────────
  function showDropdown() {
    if (isDisabled) return;
    hideDropdown();
    dd = document.createElement('div');
    dd.className = 'model-dropdown';
    dd.innerHTML = models.map(function (m) {
      const active = m.id === currentModel;
      return '<div class="model-dd-item' + (active ? ' active' : '') + '" data-model="' + escapeHtml(m.id) + '">'
        + '<span class="model-dd-name">' + escapeHtml(m.id) + '</span>'
        + '<span class="model-dd-desc">' + escapeHtml(m.description || '') + '</span>'
        + (active ? '<span class="model-dd-check">✓</span>' : '')
        + '</div>';
    }).join('');

    pill.parentNode.appendChild(dd);

    dd.addEventListener('click', onItemClick);
    closeHandler = function (e) {
      if (dd && !dd.contains(e.target) && e.target !== pill) {
        hideDropdown();
      }
    };
    setTimeout(function () {
      document.addEventListener('click', closeHandler);
    }, 0);
  }

  function hideDropdown() {
    if (dd) {
      dd.removeEventListener('click', onItemClick);
      dd.remove();
      dd = null;
    }
    if (closeHandler) {
      document.removeEventListener('click', closeHandler);
      closeHandler = null;
    }
  }

  function onItemClick(e) {
    const item = e.target.closest('.model-dd-item');
    if (!item || item.classList.contains('active')) return;
    const modelId = item.dataset.model;
    currentModel = modelId;
    updatePill();
    hideDropdown();
    if (typeof onSelect === 'function') {
      onSelect(modelId);
    }
  }

  // ── 交互 ────────────────────────────────────────────────────
  pill.addEventListener('click', function (e) {
    e.stopPropagation();
    if (dd) { hideDropdown(); }
    else { showDropdown(); }
  });

  updatePill();

  // ── 公开 API ────────────────────────────────────────────────
  return {
    element: pill,
    setModel: function (modelId) {
      currentModel = modelId;
      updatePill();
    },
    getModel: function () { return currentModel; },
    destroy: function () {
      hideDropdown();
    },
  };
}
