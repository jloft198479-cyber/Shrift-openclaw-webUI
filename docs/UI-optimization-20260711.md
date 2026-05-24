# 虾指挥 Web UI 优化记录

> 优化日期：2026-07-11
> 涉及文件：`web/css/style.css`、`web/index.html`、`web/js/views/app-view.js`、`web/js/controllers/event-router.js`
> 原则：仅视觉优化，不影响功能逻辑

---

## 一、字体系统 Token 化

### 变更内容

在 `:root` 中新增三组设计 token：

```css
/* 字号 scale */
--font-xs:      11px;   /* 辅助标签、角标、微标签 */
--font-sm:      12px;   /* 次要信息、meta、代码块 */
--font-base:    13px;   /* 正文基准、会话名称 */
--font-md:      14px;   /* 消息气泡、输入占位符 */
--font-lg:      16px;   /* 区域标题、图标按钮 */
--font-xl:      22px;   /* 欢迎页大标题 */

/* 行高 */
--leading-tight:  1.35;  /* 标题、heading */
--leading-normal: 1.6;   /* 正文 */
--leading-relaxed: 1.75; /* 长文消息、气泡 */

/* 字重 */
--weight-normal:   400;  /* 正文、辅助文字 */
--weight-medium:   500;  /* 按钮文字、会话名、Agent 名 */
--weight-semibold: 600;  /* 区域标题、选中态、h1 */
```

### 替换统计

| 类型 | 替换前（硬编码） | 替换后（token） |
|------|-----------------|-----------------|
| `font-size` | 约 80+ 处散落的 px 值 | 100 处引用 `var(--font-*)` |
| `font-weight` | 约 30+ 处 `500/600/700` | 41 处引用 `var(--weight-*)` |
| `line-height` | 3 处全局不一致值 | 7 处引用 `var(--leading-*)` |

### 保留的硬编码值（有意为之）

- `body { font-size: 0.9375rem }` — rem 单位，浏览器缩放友好
- `font-size: 8px` — 下拉箭头装饰
- `font-size: 10px` — skill 标签微标签
- `line-height: 1` — 图标对齐（约 15 处，非文本场景）
- `line-height: 1.5` — 输入框、代码块等组件内部值

### 优化理由

1. 消除了 13px / 13.5px / 14px / 14.5px 之间的微小差异，统一为清晰的 6 级 scale
2. 消灭了 `font-weight: 700`，三级字重足够表达视觉层级
3. 后续维护只需改 `:root` 变量，无需 grep 整个文件

---

## 二、中文字体加载

### 变更内容

**`web/index.html`**：在 `<head>` 中新增 Google Fonts CDN 引用：

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600&display=swap" rel="stylesheet">
```

**`web/css/style.css`**：`--font` 变量更新字体栈：

```css
/* 更新前 */
--font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif;

/* 更新后 */
--font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
```

### 优化理由

- Noto Sans SC 通过 CDN 显式加载，跨 Windows 版本视觉一致性更好
- 补充 PingFang SC（macOS）和 Microsoft YaHei（Windows）作为离线回退
- 仅加载 400/500/600 三档权重，控制传输体积

---

## 三、侧边栏折叠态（icon-only）

### 变更内容

**CSS**：在 `#sidebar` 样式后新增折叠态规则：

```css
#sidebar.collapsed {
  width: 56px;
  min-width: 56px;
}
/* 折叠态隐藏文本元素，仅保留图标 */
#sidebar.collapsed .sidebar-header h1,
#sidebar.collapsed #new-chat-btn span,
#sidebar.collapsed #filter-bar,
#sidebar.collapsed .session-item .name,
/* ... 等等 */
```

新增折叠按钮样式：

```css
#sidebar-collapse-btn {
  position: absolute;
  right: -12px;
  top: 24px;
  /* 圆形按钮，悬浮在侧边栏右边缘 */
}
```

**HTML**（`app-view.js`）：在 `</div>` (sidebar 关闭标签) 前添加：

```html
<button id="sidebar-collapse-btn" title="折叠侧边栏">‹</button>
```

**JS**（`event-router.js`）：

```javascript
const sidebar = document.getElementById('sidebar');
const collapseBtn = document.getElementById('sidebar-collapse-btn');
collapseBtn?.addEventListener('click', function () {
  sidebar.classList.toggle('collapsed');
  const isCollapsed = sidebar.classList.contains('collapsed');
  collapseBtn.textContent = isCollapsed ? '›' : '‹';
  collapseBtn.title = isCollapsed ? '展开侧边栏' : '折叠侧边栏';
});
```

### 优化理由

- 240px 在 1366px 笔记本上占比 17.6%，折叠后降至 4%
- 释放 184px 给聊天区，代码块和表格可读性显著提升
- 参考 Claude Desktop、Cursor 的成熟交互范式

---

## 四、会话列表交互态简化

### 变更内容

```css
/* 更新前：hover 时显示左边框 + 背景 */
.session-item:hover { border-left-width: 3px; border-left-color: var(--border); }
.session-item:hover { background: rgba(0,0,0,0.03); }
.session-item.active {
  background: var(--accent-light);
  border-left: 3px solid var(--accent);
}

/* 更新后：hover 仅背景，选中态用 box-shadow 内嵌 */
.session-item:hover { background: rgba(0,0,0,0.03); }
.session-item.active {
  background: var(--accent-light);
  box-shadow: inset 3px 0 0 var(--accent);
}
```

其他调整：
- 会话项 `margin-bottom`: 2px → 4px（增加间距）
- 会话列表滚动条：4px → 6px（提高可操作性）

### 优化理由

- 原方案 hover 和 active 都有左边框，视觉区分不够强
- 改用 `box-shadow: inset` 替代 `border-left`，避免影响布局计算
- 增大会话项间距提升扫视效率

---

## 五、Agent 区域空间压缩

### 变更内容

```css
/* 默认最大高度：240px → 180px */
#agent-section:not(.has-custom-height) > #agent-list {
  max-height: min(180px, calc(100vh - 320px));
}

/* Agent 列表间距：gap 2px → 4px */
#agent-list { gap: 4px; }

/* Agent 列表项 padding：8px → 6px */
.agent-item { padding: 6px 8px; }
```

### 优化理由

- 减少助手区域默认 60px 高度，在 768px 高笔记本上多显示约 3 条会话
- 会话列表优先级高于 Agent 列表

---

## 六、筛选栏视觉弱化

### 变更内容

```css
/* 更新前 */
.filter-btn.active {
  background: var(--surface);
  color: var(--text);
  border-color: var(--border);
  box-shadow: var(--shadow-sm);
}
#filter-bar { padding: 0 12px 8px; }
.filter-btn { border-radius: 6px; }

/* 更新后 */
.filter-btn.active {
  background: var(--accent-light);
  color: var(--accent);
  border-color: transparent;
  box-shadow: none;
}
#filter-bar { padding: 0 12px 4px; }
.filter-btn { border-radius: 12px; }
```

### 优化理由

- 筛选是低频操作，不应与会话列表争夺视觉注意力
- 胶囊形态（pill shape）更轻量，符合圆角设计语言
- 减少底部 padding 节省纵向空间

---

## 影响评估

### 功能不受影响

- 所有修改仅涉及 CSS 变量层和少量 CSS 规则
- JS 新增的折叠按钮事件是独立逻辑，不修改任何现有事件处理
- HTML 仅新增一个按钮元素，不改变任何现有 DOM 结构

### 潜在注意事项

1. **Google Fonts 依赖外网**：首次加载时会有约 200ms 的 FOUT（Flash of Unstyled Text），`display=swap` 确保不阻塞渲染。离线环境自动回退到系统字体
2. **折叠态 CSS 选择器**：使用后代选择器隐藏子元素，如果后续有新的文本元素加入侧边栏，需要在 `.collapsed` 规则中补充隐藏
3. **字号 scale 调整**：`--font-base` 设为 13px（原散落值 13~13.5px 区间），极少数对字号极其敏感的用户可能感知差异
