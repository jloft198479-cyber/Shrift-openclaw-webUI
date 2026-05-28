# 虾指挥 Web UI — P0~P3 改动汇总文档

> **版本**: v1.0
> **日期**: 2026-05-28
> **改动范围**: 前端视觉设计、交互体验、性能优化、代码质量
> **设计风格**: Claude 官网风（简约、克制、高信息密度、紧凑舒适）

---

## 一、改动总览

| 阶段 | 方向 | 涉及文件数 | 核心收益 |
|------|------|-----------|---------|
| **P0** | 视觉设计 | 3 | Claude 风格配色 + Inter 字体 + escapeHtml 零 DOM 开销 |
| **P1** | 交互增强 | 6 | 消息复制按钮 + 输入框状态联动 + 字符计数 |
| **P2** | 性能优化 | 2 | script defer + scrollToBottom 节流 + Markdown 缓存 |
| **P3** | 代码质量 | 6 | 函数去重 + 正则预编译 + 渲染 diff 缓存 + 历史消息上限 |

---

## 二、P0 — Claude 风格视觉重设计

### 2.1 配色改造 (`css/style.css`)

将原有「奶油白 + 赤陶色」暖色系替换为 Claude 标志性的「浅灰白 + 琥珀橙」中性色系：

```css
/* 之前 */
--accent: #C96442;           /* 赤陶色，饱和度偏高 */
--bg: #FAF9F7;               /* 奶油白，偏暖偏黄 */
--sidebar-bg: #F5F3EF;

/* 之后 */
--accent: #D97706;           /* 琥珀橙，更克制 */
--bg: #F9FAFB;               /* 纯净浅灰，中性 */
--sidebar-bg: #F3F4F6;
```

完整色彩变量对照：

| 变量 | 旧值 | 新值 | 说明 |
|------|------|------|------|
| `--accent` | `#C96442` | `#D97706` | 主强调色，琥珀橙 |
| `--accent-hover` | `#B55A38` | `#B45309` | hover 状态 |
| `--bg` | `#FAF9F7` | `#F9FAFB` | 页面背景 |
| `--sidebar-bg` | `#F5F3EF` | `#F3F4F6` | 侧边栏背景 |
| `--surface` | `#FFFFFF` | `#FFFFFF` | 卡片/气泡表面（不变） |
| `--text` | `#1C1917` | `#111827` | 主文字 |
| `--text-2` | `#78716C` | `#6B7280` | 次要文字 |
| `--text-3` | `#A8A29E` | `#9CA3AF` | 占位符/辅助文字 |
| `--border` | `#E7E5E4` | `#E5E7EB` | 边框 |
| `--border-light` | `#F5F5F4` | `#F3F4F6` | 浅边框 |
| `--user-bubble` | `#FFF7ED` | `#F0FDF4` | 用户气泡，从暖橙底改为清新绿底 |
| `--font-size-base` | `13px` | `14px` | 基础字号提升舒适度 |

同时将 CSS 中所有 **硬编码 rgba 颜色值**（如 `rgba(217, 100, 66, ...)`）替换为 `var(--accent)` 系变量引用，确保主题一致性。

delegate 模式和 agent 模式的暖色适配也一并更新。

### 2.2 字体引入 (`index.html`)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600&display=swap" rel="stylesheet">
```

- `Inter`：西文字体，Claude 官网同款
- `Noto Sans SC`：中文回退字体
- 均使用 `display=swap` 避免 FOIT

### 2.3 escapeHtml 零 DOM 开销 (`js/utils/render.js`)

```javascript
/* 之前：每次调用创建 div.textContent = str → innerHTML，有 DOM 开销和 GC 压力 */
function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* 之后：纯字符串替换，零 DOM 操作 */
const _escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const _escRe = /[&<>"']/g;
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(_escRe, function (ch) { return _escMap[ch]; });
}
```

---

## 三、P1 — 交互增强

### 3.1 消息复制按钮 (`message-renderer.js` + `stream-renderer.js` + `css/style.css`)

**功能**：assistant 消息气泡右上角悬停显示操作按钮组。

**CSS 要点**：
```css
.msg-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  opacity: 0;
  transition: opacity 150ms ease;
  pointer-events: none;
}
.message.assistant:hover .msg-actions {
  opacity: 1;
  pointer-events: auto;
}
```

**按钮清单**：
| 按钮 | 状态 | 说明 |
|------|------|------|
| 📋 复制 | ✅ 可用 | 复制消息纯文本，支持 clipboard API + execCommand fallback |
| 🔄 重新生成 | 🔒 disabled | 后端 API 待支持 |
| 🗑 删除 | 🔒 disabled | 后端 API 待支持 |

**JS 实现**：
- `MessageRenderer.init()` — 事件委托，在 `.messages-inner` 上监听 click
- `MessageRenderer._copyMessage()` — 获取 `.agent-content` 的 innerText 并复制
- `MessageRenderer._flashCopied()` — 复制成功后显示 ✓ 并 1.5s 后恢复
- `StreamRenderer.endStreaming()` — 流式结束后动态追加操作按钮到气泡
- `ChatView.init()` — 初始化时调用 `MessageRenderer.init()`

### 3.2 输入框状态联动 (`interaction-bindings.js` + `app-view.js` + `css/style.css`)

**发送按钮置灰**：
```css
#send-btn:disabled {
  background: var(--border);
  cursor: default;
  opacity: 0.5;
}
```

```javascript
// _updateInputState(): 监听 input 事件 + State.streaming 变化
// 输入框为空且无附件时 → disabled
// 流式进行中 → 不 disabled（作为停止按钮）
```

**字符计数器**：
```css
.char-count {
  font-size: var(--font-xs);
  color: var(--text-3);
  opacity: 0;
  transition: opacity var(--transition);
}
.char-count.visible { opacity: 1; }
.char-count.near-limit { color: var(--accent); }
```

- 超过 60%（4800 字符）时淡入显示
- 超过 85%（6800 字符）时变橙色警告
- DOM 位置：input-row 和 model-bar 之间

### 3.3 侧边栏折叠宽度 (`css/style.css`)

```css
/* 之前 */
#sidebar.collapsed { width: 56px; min-width: 56px; }
/* 之后 */
#sidebar.collapsed { width: 48px; min-width: 48px; }
```

### 3.4 State.setState diff — 无需修改

已有 `this[key] !== partial[key]` diff 逻辑，无需改动。

---

## 四、P2 — 性能优化

### 4.1 script defer (`index.html`)

**改动**：24 个外部 `<script>` 全部添加 `defer` 属性，1 个内联 script（onerror handler）保持不变。

**效果**：
- **之前**：24 个 JS 文件同步阻塞加载，浏览器必须逐个下载执行后才能继续解析 DOM → 首屏白屏时间长
- **之后**：JS 并行下载，DOM 解析不等待，DOMContentLoaded 后按文档顺序执行 → 首屏显著加速

**兼容性**：`defer` 按文档顺序执行，与原同步加载的执行顺序完全一致，所有依赖关系无需修改。

```html
<!-- 之前 -->
<script src="js/lib/purify.min.js?v=..."></script>

<!-- 之后 -->
<script defer src="js/lib/purify.min.js?v=..."></script>
```

### 4.2 scrollToBottom rAF 节流 (`js/utils/render.js`)

```javascript
/* 之前：每次调用都立即 scrollTo */
function scrollToBottom(el, smooth = true) {
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
}

/* 之后：smooth 模式用 rAF 合并高频调用 */
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
```

**效果**：流式渲染时每帧最多 1 次 scrollTo，减少重排次数。

### 4.3 renderMarkdown LRU 缓存 (`js/utils/render.js`)

```javascript
/* 新增：Map 实现 LRU 64 条缓存 */
var _mdCache = new Map();
var _mdCacheMax = 64;
function renderMarkdown(text) {
  if (!text) return '';
  var cached = _mdCache.get(text);
  if (cached) return cached;
  // ... marked.parse + DOMPurify.sanitize ...
  _mdCache.set(text, html);
  if (_mdCache.size > _mdCacheMax) {
    var first = _mdCache.keys().next().value;
    _mdCache.delete(first);
  }
  return html;
}
```

**效果**：相同文本跳过 `marked.parse` + `DOMPurify.sanitize`，流式渲染时大幅减少计算量。

### 4.4 代码块复制 fallback (`js/utils/render.js`)

`navigator.clipboard` 失败时降级到 `textarea + execCommand('copy')`，HTTP 环境和旧浏览器下也能正常复制代码。

---

## 五、P3 — 代码质量

### 5.1 合并重复 MIME 图标函数

| 文件 | 改动 |
|------|------|
| `js/utils/render.js` | 新增共享函数 `getAttachmentIcon(mimeType)` |
| `js/components/message-renderer.js` | 删除私有 `_getAttachmentIcon`，3 处调用改为 `getAttachmentIcon()` |
| `js/components/attachment-bar.js` | `_getFileIcon()` 委托给共享 `getAttachmentIcon()` |

### 5.2 提取 Agent 标签构建函数 (`message-renderer.js`)

```javascript
/* 新增：消除 appendMessage 和 updateMessageAgent 中 3 处重复代码 */
function _buildAgentLabelHtml(agent, resolvedAgentName) {
  var avatar = (agent && agent.avatar) || '';
  var displayName = (agent && agent.name) || resolvedAgentName;
  var desc = (agent && agent.description) || '';
  var agentAvatar = renderAgentAvatar(avatar || (resolvedAgentName ? resolvedAgentName.slice(0, 1) : ''), resolvedAgentName);
  var html = '<span class="agent-label-avatar">' + agentAvatar + '</span>';
  html += '<span class="agent-label-name">' + escapeHtml(displayName) + '</span>';
  if (desc) html += '<span class="agent-label-desc">' + escapeHtml(desc) + '</span>';
  return html;
}
```

### 5.3 正则预编译

| 文件 | 变量名 | 用途 |
|------|--------|------|
| `message-renderer.js` | `_ATTACHMENT_RE` | 匹配附件图标行（`/^[🖼📄📦📝📊📃📎]\s+(.+)$/`） |
| `message-builder.js` | `_ATT_LINE_RE` | 过滤附件行（`/^[🖼📄📦📝📊📃📎]\s/`） |

**效果**：每条消息解析时不再重复创建正则对象。

### 5.4 AgentList.render cacheKey diff (`agent-list.js`)

```javascript
_cacheKey: '',

render: function () {
  // ... 
  var key = agents.map(function(a) {
    return a.id + ':' + (a.model||'') + ':' + (a.name||'') + ':' + (a.avatar||'');
  }).join('|') + '|' + currentAgent;
  if (key === this._cacheKey) return;  // 数据指纹相同则跳过
  this._cacheKey = key;
  // ... innerHTML 渲染 ...
}
```

**效果**：与 SessionList 现有机制一致，避免相同数据重复渲染。

### 5.5 长会话历史消息渲染上限 (`session-manager.js`)

```javascript
const MAX_VISIBLE = 200;
const startIdx = Math.max(0, messages.length - MAX_VISIBLE);
if (startIdx > 0) {
  // 显示占位提示："... 早期消息（N 条）"
}
// 只渲染 startIdx 到末尾的消息
```

**效果**：超长会话避免创建数百个 DOM 节点导致卡顿。

---

## 六、完整文件变更清单

| 文件路径 | P0 | P1 | P2 | P3 | 改动摘要 |
|----------|----|----|----|----|---------|
| `css/style.css` | ✅ | ✅ | | | Claude 配色变量 + rgba 硬编码替换 + msg-actions 样式 + send-btn disabled + char-count + sidebar 48px |
| `index.html` | ✅ | | ✅ | | Inter 字体引入 + 24 个 script 加 defer + char-count DOM |
| `js/utils/render.js` | ✅ | | ✅ | ✅ | escapeHtml 纯字符串 + 共享 getAttachmentIcon + scrollToBottom rAF + Markdown LRU 缓存 + 代码块复制 fallback |
| `js/components/message-renderer.js` | | ✅ | | ✅ | msg-actions 事件委托 + 复制功能 + 去掉 _getAttachmentIcon + _buildAgentLabelHtml + _ATTACHMENT_RE 预编译 |
| `js/components/stream-renderer.js` | | ✅ | | | endStreaming 追加操作按钮 |
| `js/components/chat-view.js` | | ✅ | | | init 调用 MessageRenderer.init() |
| `js/ui/interaction-bindings.js` | | ✅ | | | _updateInputState + send-btn disabled 联动 + 字符计数 |
| `js/views/app-view.js` | | ✅ | | | char-count div DOM |
| `js/components/attachment-bar.js` | | | | ✅ | _getFileIcon 委托共享函数 |
| `js/components/agent-list.js` | | | | ✅ | _cacheKey diff 渲染 |
| `js/components/message-builder.js` | | | | ✅ | _ATT_LINE_RE 预编译 |
| `js/controllers/session-manager.js` | | | | ✅ | MAX_VISIBLE=200 历史消息上限 |

---

## 七、兼容性说明

| 项目 | 说明 |
|------|------|
| **script defer** | 按文档序执行，与原同步加载顺序一致，所有模块依赖无需调整 |
| **CSS 变量** | 使用标准 CSS 自定义属性，IE 不支持（本项目无需 IE） |
| **navigator.clipboard** | HTTPS 环境可用，HTTP 降级为 execCommand（已实现 fallback） |
| **requestAnimationFrame** | 广泛支持，IE9+ 不可用但本项目不涉及 |
| **Map / Set** | IE11+ 支持，本项目不涉及 IE |
| **Inter 字体** | Google Fonts CDN 加载，display=swap 确保字体加载期间不阻塞渲染 |

---

## 八、后续可选优化（未实施）

以下优化在方案中讨论过但未在本次实施，可按需排期：

1. **暗色模式**：CSS 变量体系已就绪，添加 `@media (prefers-color-scheme: dark)` 或手动切换即可
2. **虚拟滚动**：消息区 >100 条时考虑虚拟列表（如 react-window 思路），减少 DOM 节点
3. **消息重新生成/删除**：需后端新增 `/v1/chat/completions/regenerate` 和 `/api/messages/:id` DELETE API
4. **国际化 (i18n)**：当前所有文案硬编码中文，如需多语言需提取为 JSON 配置
5. **CSS 按组件拆分**：当前 style.css ~62KB 单文件，可拆分为 `base.css`、`sidebar.css`、`message.css`、`input.css` 等按需加载
6. **JS 模块化**：当前 24 个全局 script，可改为 ES Modules（需构建工具或原生 `<script type="module">`）
