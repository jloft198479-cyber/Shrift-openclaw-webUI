# 虾指挥 (OpenClaw Web UI) — Claude 风格设计与优化方案

> 版本：v1.0 | 目标风格：Claude 官网风（简约、克制、高信息密度、紧凑舒适）
> 要求：高标准 · 简约大方 · 布局合理 · 空间利用合理 · 紧凑感 · 字体舒适 · 配色合理 · 代码性能极好 · 反应快

---

## 一、现状诊断（基于代码分析）

### 1.1 已完成得不错的部分
- CSS 变量体系完整（8 级 `font-size`、4 级 `border-radius`、3 级 `shadow`）
- 已使用 `contain: strict` 优化消息区滚动性能
- 流式渲染用 `requestAnimationFrame` 合并帧，避免 DOM 抖动
- `marked.Renderer()` 自定义代码块（语言标签 + 复制按钮）
- `resize` 事件已做防抖处理（侧边栏折叠动画 200ms）
- 移动端响应式布局基本可用

### 1.2 需要优化的核心问题

| 问题 | 位置 | 影响 |
|------|------|------|
| **消息区 DOM 无序增长**，无虚拟滚动 | `message-renderer.js` | 对话历史 >50 条后卡顿 |
| **`escapeHtml` 每次重新创建 `div`** | `render.js` | 高频调用时产生 GC 压力 |
| **`State.setState` 无 diff 优化**，每次全量 emit | `state.js` | 多余 re-render |
| **Claude 风格缺失**：当前是"奶油白 + 赤陶色"暖色系，非 Claude 标志性的「浅灰白 + 暖橙/琥珀」中性色系 | `style.css :root` | 视觉风格不符 |
| **字体堆栈不含 `Inter`/`SF Pro`**，Claude 使用 `Inter` + `SF Pro Display` | `style.css` | 字体渲染不够精致 |
| **输入框无 `max-height` 限制 + 无字符计数** | `style.css` `#input` | 超长输入时布局崩坏 |
| **无快捷键系统**（Ctrl+K 新对话、Ctrl+/ 聚焦搜索等） | 全局 | 效率偏低 |
| **消息气泡无「复制/重新生成/删除」操作按钮**，悬停才出现 | `message-renderer.js` | 交互效率低于 Claude |
| **代码块无行号 + 无「复制代码」按钮位置固定** | `render.js` `_getMdRenderer` | 代码阅读体验差 |
| **无深色模式** | 全局 | 不符合 Claude 风格（Claude 支持 dark mode） |
| **侧边栏 Session 列表无搜索/排序** | `session-list.js` | Session 多时难找 |

---

## 二、Claude 风格设计语言定义

### 2.1 色彩系统（对标 Claude 官网）

```css
:root {
  /* 背景层级（Claude 风格：极淡灰，非奶油白） */
  --bg:           #F9FAFB;    /* 主背景：接近白色但更柔和 */
  --sidebar-bg:   #F3F4F6;    /* 侧边栏：比主背景深半度 */
  --surface:      #FFFFFF;    /* 卡片/气泡背景 */
  --surface-hover:#F9FAFB;    /* 悬停表面 */

  /* 文字色阶（Claude 使用 4 阶灰，无纯黑） */
  --text:         #1F2937;    /* 主文字：深灰，非纯黑 */
  --text-2:       #6B7280;    /* 次要文字 */
  --text-3:       #9CA3AF;    /* 禁用/占位文字 */

  /* Accent（Claude 标志性琥珀橙，非赤陶色） */
  --accent:       #D97706;    /* 琥珀橙：Claude 官网 CTA 色 */
  --accent-light: #FFFBEB;    /* 极淡琥珀背景 */
  --accent-hover: #B45309;    /* 悬停态 */

  /* 边框（Claude：极淡灰边框，非实色） */
  --border:       #E5E7EB;
  --border-light: #F3F4F6;

  /* 用户气泡（Claude：浅灰，非暖米色） */
  --user-bubble:  #F3F4F6;
}
```

### 2.2 字体系统（对标 Claude）

Claude 使用 `Inter` + `SF Pro Display`（macOS）+ `Segoe UI`（Windows）。

当前字体堆栈缺 `Inter`，需补充：

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

:root {
  --font: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Display",
         "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC",
         "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", "Cascadia Code",
               "Consolas", "Monaco", monospace;
}
```

### 2.3 间距体系（Claude 风格：紧凑，8px 基准网格）

| Token | 值 | 用途 |
|-------|------|------|
| `--sp-1` | 4px | 图标与文字间距 |
| `--sp-2` | 8px | 表单项间距 |
| `--sp-3` | 12px | 卡片内边距 |
| `--sp-4` | 16px | 区块间距 |
| `--sp-5` | 20px | 大区块间距 |
| `--sp-6` | 24px | 页面边距 |

### 2.4 圆角体系（Claude：偏圆润，但不过度）

| Token | 值 | 用途 |
|-------|------|------|
| `--radius-xs` | 6px | 按钮、输入框 |
| `--radius-sm` | 10px | 卡片、代码块 |
| `--radius` | 14px | 消息气泡 |
| `--radius-lg` | 20px | 模态框 |

---

## 三、布局优化方案

### 3.1 当前布局问题分析

当前 `#app` 使用 `display: flex`，侧边栏固定 240px，聊天区 `flex:1`。
问题：
1. 侧边栏折叠后仅 56px，Agent 区图标排列过密
2. 消息区 `.messages-inner` 最大宽度 760px 居中，在大屏（>1400px）上过窄
3. 输入区固定底部，无「输入框自动成长上限」的视觉提示

### 3.2 优化后布局

```
┌──────────────────────────────────────────────────────┐
│  sidebar (240px)  │         main (flex:1)          │
│                    │  ┌──────────────────────────┐  │
│  Logo + Title      │  │    welcome / messages   │  │
│  [+ 新对话]       │  │    max-width: 820px    │  │
│                    │  │    margin: 0 auto      │  │
│  [全部] [待办]    │  └──────────────────────────┘  │
│                    │  ┌──────────────────────────┐  │
│  Session List      │  │  输入区                  │  │
│  (flex:1)        │  │  max-width: 820px      │  │
│                    │  │  margin: 0 auto        │  │
│  ─────────────    │  └──────────────────────────┘  │
│  Agent Section     │                                  │
│  (可拖拽调整高度) │                                  │
└──────────────────────────────────────────────────────┘
```

**关键改动：**
- `.messages-inner` 和输入区 `max-width` 从 760px → **820px**（更充分利用大屏）
- 侧边栏折叠宽度从 56px → **48px**（更紧凑，Claude 风格）
- Agent Section 拖拽分隔线高度从 10px → **6px**（更精细）

---

## 四、性能优化方案（代码层面）

### 4.1 虚拟滚动（Virtual Scrolling）— 最高优先级

**问题**：当前所有消息 DOM 节点常驻内存，>50 条 session 滚动明显卡顿。

**方案**：实现简单虚拟滚动，只渲染可视区 ±5 条消息。

```javascript
// 在 message-renderer.js 中添加
const VirtualList = {
  ITEM_HEIGHT: 120,  // 预估每条消息高度
  BUFFER: 5,         // 上下各多渲染 5 条

  init(container) {
    this.container = container;
    this.items = [];
    this.topPadding = 0;
    this.bottomPadding = 0;
    container.style.overflow = 'auto';
    container.addEventListener('scroll', this._onScroll.bind(this), { passive: true });
  },

  _onScroll() {
    requestAnimationFrame(() => {
      const scrollTop = this.container.scrollTop;
      const viewHeight = this.container.clientHeight;
      const start = Math.max(0, Math.floor(scrollTop / this.ITEM_HEIGHT) - this.BUFFER);
      const end = Math.min(this.items.length, Math.ceil((scrollTop + viewHeight) / this.ITEM_HEIGHT) + this.BUFFER);
      this._renderRange(start, end);
    });
  },

  _renderRange(start, end) {
    // 只渲染 start~end 区间的 DOM 节点
    // 其余用 padding 占位
    this.topPadding = start * this.ITEM_HEIGHT;
    this.bottomPadding = (this.items.length - end) * this.ITEM_HEIGHT;
    // ... 更新 DOM
  }
};
```

> **注意**：考虑到项目复杂度，第一期可先用「消息分片加载」（只保留最近 30 条 DOM，往上滚加载更多）替代完整虚拟滚动。

### 4.2 `escapeHtml` 性能优化

**当前实现**（每次创建 div）：
```javascript
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```

**优化后**（纯字符串替换，零 DOM 开销）：
```javascript
const _htmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const _escapeHtmlReg = /[&<>"']/g;

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(_escapeHtmlReg, ch => _htmlEscapes[ch]);
}
```

### 4.3 `State.setState` 深度比较

**当前问题**：每次 `setState` 都无条件 emit 所有 key，即使值未变。

**优化方案**：对基本类型做 `Object.is` 比较，对数组/对象做 shallow compare：

```javascript
setState: function (partial) {
  const events = new Set();
  const keyToEvent = { /* 同现有 */ };
  let changed = false;
  for (const key in partial) {
    if (!Object.is(this[key], partial[key])) {
      this[key] = partial[key];
      const ev = keyToEvent[key];
      if (ev) events.add(ev);
      changed = true;
    }
  }
  if (changed) {
    const self = this;
    events.forEach(function (e) { self._emit(e); });
  }
},
```

### 4.4 代码块渲染优化

**当前问题**：`renderMarkdown` 每次全量重新渲染整个气泡内容（含代码块高亮）。

**优化方案**：
1. 对代码块使用 `highlight.js` 做客户端语法高亮（当前无高亮）
2. 代码块复制按钮使用事件委托（当前是每按钮独立监听）

---

## 五、交互优化方案

### 5.1 消息操作按钮（Claude 风格悬停出现）

在每条 Assistant 消息气泡右侧悬停时显示操作按钮：

```css
.message-actions {
  position: absolute;
  right: -40px;
  top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  opacity: 0;
  transition: opacity 150ms ease;
}
.message.assistant:hover .message-actions {
  opacity: 1;
}
```

按钮：复制 | 重新生成 | 删除 | 编辑

### 5.2 输入框增强

1. **字符计数**：超过 2000 字显示剩余字数
2. **发送按钮状态**：输入为空时按钮置灰（当前无此状态）
3. **Shift+Enter = 换行，Enter = 发送**（Claude 行为，当前已支持但不明显）

### 5.3 快捷键系统

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+K` | 新建对话 |
| `Ctrl+/` | 聚焦搜索（未来） |
| `Ctrl+Shift+C` | 复制最后一条代码块 |
| `Esc` | 停止生成（当前已有） |
| `Ctrl+Shift+;` | 切换侧边栏 |

---

## 六、深色模式方案

### 6.1 实现方式

使用 CSS 变量 + `[data-theme="dark"]` 选择器，不引入额外 CSS 文件：

```css
[data-theme="dark"] {
  --bg:           #0F0F0F;
  --sidebar-bg:   #1A1A1A;
  --surface:      #1E1E1E;
  --text:         #E5E7EB;
  --text-2:       #9CA3AF;
  --text-3:       #6B7280;
  --border:       #2D2D2D;
  --border-light: #252525;
  --user-bubble:  #2D2D2D;
  --accent:       #F59E0B;
  --accent-light: #1A1400;
  --accent-hover: #D97706;
}
```

### 6.2 切换入口

在侧边栏底部（Agent Section 下方）添加主题切换按钮：

```html
<button id="theme-toggle" class="theme-toggle-btn" aria-label="切换主题">
  <span class="theme-icon light">☀️</span>
  <span class="theme-icon dark">🌙</span>
</button>
```

---

## 七、实施优先级

| 优先级 | 任务 | 预计工作量 | 性能影响 |
|--------|------|----------|----------|
| P0 | 色彩系统改为 Claude 风格（2.1） | 0.5h | 视觉 |
| P0 | `escapeHtml` 优化（4.2） | 0.5h | ⭐⭐⭐ |
| P0 | 字体堆栈补充 Inter（2.2） | 0.5h | 视觉 |
| P1 | 消息操作按钮（5.1） | 1h | 交互 |
| P1 | 输入框增强（5.2） | 1h | 交互 |
| P1 | 侧边栏宽度调整（3.2） | 0.5h | 布局 |
| P1 | State.setState diff 优化（4.3） | 1h | ⭐⭐ |
| P2 | 深色模式（六） | 2h | 功能 |
| P2 | 虚拟滚动（4.1） | 3h | ⭐⭐⭐⭐⭐ |
| P2 | 快捷键系统（5.3） | 1h | 效率 |
| P3 | 代码块语法高亮（4.4） | 1.5h | 体验 |

---

## 八、文件变更清单

### 8.1 必须修改的文件

| 文件 | 变更内容 |
|------|----------|
| `web/css/style.css` | 色彩变量、字体、间距、圆角、深色模式、`--accent` 从赤陶色改为琥珀橙 |
| `web/js/utils/render.js` | `escapeHtml` 优化、可选引入 `highlight.js` |
| `web/js/state.js` | `setState` 添加 diff 逻辑 |
| `web/js/components/message-renderer.js` | 添加消息操作按钮、优化 DOM 结构 |
| `web/js/components/chat-view.js` | 输入框增强逻辑 |
| `web/js/views/app-view.js` | 侧边栏折叠宽度调整、主题切换按钮 |
| `web/index.html` | 引入 Inter 字体、highlight.js（可选） |

### 8.2 建议新增文件

| 文件 | 用途 |
|------|------|
| `web/js/utils/virtual-list.js` | 虚拟滚动实现（P2） |
| `web/js/utils/shortcuts.js` | 快捷键系统（P2） |
| `web/css/theme-dark.css` | 深色模式变量（或直接在 `style.css` 里加） |

---

## 九、Claude 风格设计参考（截图描述）

Claude 官网（claude.ai）的核心设计特征：

1. **极简布局**：左侧边栏 + 中间对话区，无多余装饰
2. **中性配色**：背景 `#F9FAFB`，文字 `#1F2937`，Accent `#D97706`（琥珀橙）
3. **紧凑气泡**：消息气泡 `border-radius: 14px`，`padding: 12px 16px`，行高 `1.6`
4. **字体**：Inter（免费）+ SF Pro（macOS 系统），`font-weight: 400` 正文，`500` 按钮，`600` 标题
5. **代码块**：`background: #F8F9FA`，`border-radius: 10px`，有行号，有「复制」按钮悬停显示
6. **动画**：所有 transition 使用 `cubic-bezier(0.4, 0, 0.2, 1)`（material curve），时长 150ms
7. **深色模式**：完整支持，`--surface` 为 `#1E1E1E`，代码块背景 `#2D2D2D`

---

## 十、总结

本方案从 **视觉（Claude 风格色彩/字体）**、**性能（escapeHtml 优化/虚拟滚动/State diff）**、**交互（消息操作/输入框增强/快捷键）**、**功能（深色模式）** 四个维度对虾指挥进行全面升级。

**最快见效的三项改动**（1 小时内完成）：
1. 改 CSS 变量（色彩 + 字体）→ 视觉立即 Claude 化
2. 优化 `escapeHtml` → 流式渲染性能提升
3. 添加消息操作按钮 → 交互效率大幅提升

建议按 P0 → P1 → P2 → P3 顺序实施，每完成一个优先级即部署验证。
