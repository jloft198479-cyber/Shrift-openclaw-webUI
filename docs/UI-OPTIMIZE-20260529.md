# 虾指挥 UI 优化方案 v4.0 — Claude 美学 · 侧边栏专项

> 日期：2026-05-29
> 定位：**仅出方案，不改代码**
> 风格基调：Claude 美学（安静、克制、内容优先）
> 核心目标：侧边栏从「控制面板」进化为「安静的背景层」

---

## 一、Claude 美学核心原则

Claude 官网（claude.ai）的设计语言可以浓缩为五句话：

1. **界面消失** — 没有气泡、没有卡片边框，内容自己建立层级
2. **中性灰阶** — 拒绝冷暖对立，整页只用 4 阶灰 + 1 个 accent
3. **留白即层级** — 用间距和灰度差代替边框和阴影
4. **accent 极克制** — 琥珀橙 `#D97706` 只出现在 CTA 和选中指示，不染色背景
5. **动效只做淡入** — 所有 transition 用 `cubic-bezier(0.4,0,0.2,1)`，时长 ≤ 200ms

---

## 二、当前侧边栏诊断

### 2.1 视觉问题清单

| # | 问题 | Claude 对标 |
|---|------|--------------|
| 1 | Accent 色太抢 — 新对话按钮虚线+accent 背景 | Claude 的「New chat」是无背景纯文字链接 |
| 2 | 筛选栏独立成行，浪费纵向空间 | Claude 把 "All/Separate" 做成右上角小字链接 |
| 3 | Session item 有 icon + badge + name + meta + menu，5 个元素抢注意力 | Claude 列表项只有名称和 hover 出现的菜单 |
| 4 | Active 状态用 `box-shadow: inset 3px 0` 强调，太重 | Claude 用左侧 2px accent 指示条，极轻 |
| 5 | 侧边栏有 `border-right`，视觉分隔太硬 | Claude 用 `box-shadow: 1px 0 0 rgba(0,0,0,0.04)` 代替 |
| 6 | Agent 区域标题 16px semibold，与 Session 列表标题同等权重 | Claude 助手列表是配角，12px regular |
| 7 | 折叠按钮绝对定位悬浮，带 border + accent hover | Claude 折叠按钮是流内布局，极安静 |

### 2.2 结构问题清单

```
当前侧边栏结构（240px）：
┌─────────────────────────┐
│  🦐 虾指挥   [↻]     │  ← header：logo+title+restart(太重)
│  ┌───────────────────┐  │
│  │ + 开始新对话      │  │  ← 虚线accent背景，像CTA按钮
│  └───────────────────┘  │
│  [全部] [待办]         │  ← 独立筛选栏，占一行
│  前端项目讨论           │
│  写周报        2025-… │  ← icon+badge+name+meta，信息过载
│  ...                   │
│  ─────────────────────  │
│  🤖 助手 (3)  [+]   │  ← 16px semibold，权重过高
│  Frontend Dev...       │
│  ...                   │
└─────────────────────────┘
```

---

## 三、侧边栏优化方案（核心）

### 3.1 新结构总览

```
优化后侧边栏结构（260px，更宽但更安静）：
┌─────────────────────────────┐
│  🦐 虾指挥              ⋯  │  ← 折叠按钮融入header流内
│                              │
│  + 开始新对话               │  ← 去掉虚线/背景，像普通列表项
│                              │
│  最近对话           待办    │  ← 筛选内联到标题旁，省一行
│                              │
│  前端项目讨论               │  ← 纯文字，无icon，13px深灰
│  写周报                     │  ← hover: 极淡灰背景
│  代码审查               ←  │  ← active: 左侧2px accent指示
│  ...                         │
│  ─────────────────────      │
│                              │
│  助手               +       │  ← 12px regular gray-500
│  🤖 Frontend Dev          │  ← emoji 20px + 名称13px
│  🐍 Python Engineer       │  ← 无描述、无skill标签
│  ...                         │
└─────────────────────────────┘
分隔：box-shadow 代替 border-right
```

### 3.2 逐元素优化明细

#### ① Header — 降权

| 属性 | 当前 | 优化后 |
|------|------|--------|
| 标题字号 | 22px semibold | **14px medium** gray-800 |
| 标题字重 | 600 | **500** |
| Restart 按钮 | 常显，28px 方形 | **移入下拉菜单**，或改为 hover 显示的 18px 图标 |
| 折叠按钮 | `position:absolute; right:-12px` 悬浮 | **流入 header 右侧**，无 border，无 background |
| padding | 20px 16px 12px | **14px 16px 8px** |

```css
/* 新 Header 样式 */
.sidebar-header {
  padding: 14px 16px 8px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.sidebar-header h1 {
  font-size: 14px;
  font-weight: 500;
  color: var(--gray-800);
  letter-spacing: -0.01em;
}
#sidebar-collapse-btn {
  position: static;    /* 取消绝对定位 */
  width: 20px; height: 20px;
  border: none;
  background: transparent;
  color: var(--gray-500);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  margin-left: auto;   /* 推到右侧 */
  border-radius: 4px;
  transition: color 150ms ease, background 150ms ease;
}
#sidebar-collapse-btn:hover {
  color: var(--gray-700);
  background: var(--gray-100);
}
```

#### ② 新对话按钮 — 去 CTA 化

| 属性 | 当前 | 优化后 |
|------|------|--------|
| 背景 | `var(--accent-light)` 琥珀淡底 | **transparent** |
| 边框 | `1.5px dashed var(--accent)` | **none** |
| 文字色 | `var(--accent)` | **var(--gray-700)** |
| hover | 实线 border + 背景加深 | **var(--gray-50) 极淡灰背景** |
| 字号 | 16px semibold | **13px medium** |
| 图标 | `+` | **`+` 13px gray-500** |

```css
#new-chat-btn {
  margin: 0 12px 8px;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--gray-700);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 150ms ease;
  display: flex; align-items: center; gap: 6px;
}
#new-chat-btn:hover {
  background: var(--gray-50);
}
#new-chat-btn:active { transform: scale(0.985); }
```

#### ③ 筛选栏 — 内联化

**当前**：独立一行，两个 `filter-btn`，各占 50% 宽度

**优化后**：在「最近对话」标题右侧加「待办」文字链接，省出完整一行给会话列表

```css
.filter-inline {
  font-size: 12px;
  color: var(--gray-500);
  cursor: pointer;
  margin-left: auto;
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 150ms ease, background 150ms ease;
}
.filter-inline:hover {
  color: var(--gray-700);
  background: var(--gray-100);
}
.filter-inline.active {
  color: var(--accent);
}
```

#### ④ Session 列表项 — 极简化

| 属性 | 当前 | 优化后 |
|------|------|--------|
| 左侧 icon | 有（20px 方形，琥珀背景） | **去掉** |
| Agent badge | 有（`session-agent-badge` 琥珀圆角） | **去掉**（可在 name 后加极小字说明） |
| 名称 | 13px medium | **13px regular** gray-800 |
| Meta 时间 | 有，11px gray-400 | **去掉**（hover 时显示在右侧） |
| Menu 按钮 | 常显 | **opacity:0，hover 时显示** |
| Active 指示 | `box-shadow: inset 3px 0 var(--accent)` | **左侧 2px accent 伪元素** |
| Active 背景 | `var(--accent-light)` | **var(--gray-50)** 极淡 |
| Item 间距 | `margin-bottom:4px` | **2px** 更紧凑 |
| padding | 10px 12px | **8px 12px** |

```css
.session-item {
  padding: 8px 12px;
  margin-bottom: 2px;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  cursor: pointer;
  transition: background 150ms ease;
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
}
.session-item:hover { background: var(--gray-50); }
.session-item.active {
  background: var(--gray-50);
}
.session-item.active::before {
  content: '';
  position: absolute;
  left: 0; top: 4px; bottom: 4px;
  width: 2px;
  border-radius: 0 2px 2px 0;
  background: var(--accent);
}
.session-item .name {
  font-size: 13px;
  font-weight: 400;
  color: var(--gray-800);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-item.active .name {
  font-weight: 500;
  color: var(--gray-700);
}
.session-item .menu-btn {
  opacity: 0;
  /* ... 其他样式不变 */
}
.session-item:hover .menu-btn { opacity: 1; }
```

#### ⑤ Agent 区域 — 降为配角

| 属性 | 当前 | 优化后 |
|------|------|--------|
| 标题字号 | 16px semibold | **12px regular** gray-500 |
| 标题字重 | 600 | **400** |
| Section count badge | 有（gray-100 背景圆角） | **去掉** |
| 新建按钮 | 虚线 accent border | **普通文字链接样式** |
| Agent item 描述 | 有（12px gray-400） | **去掉** |
| Agent item skill 标签 | 有 | **去掉** |
| Agent item 字号 | 13px medium | **13px regular** |
| Agent item 间距 | 4px | **2px** |

```css
#agent-section .section-title {
  font-size: 12px;
  font-weight: 400;
  color: var(--gray-500);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.agent-item {
  padding: 5px 8px;
  margin-bottom: 2px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 150ms ease;
}
.agent-item:hover { background: var(--gray-50); }
.agent-item .agent-name {
  font-size: 13px;
  font-weight: 400;
  color: var(--gray-700);
}
```

#### ⑥ 侧边栏分隔 — 去边框化

```css
/* 去掉 border-right，改用 box-shadow */
#sidebar {
  width: 260px;           /* 从 240px 略加宽 */
  min-width: 260px;
  background: var(--sidebar-bg);
  /* border-right: 1px solid var(--border);  删除 */
  box-shadow: 1px 0 0 rgba(0,0,0,0.04);
  display: flex;
  flex-direction: column;
  user-select: none;
  transition: width 200ms ease, min-width 200ms ease;
}
```

#### ⑦ 折叠态优化

折叠后宽度从 48px 调整为 **44px**（更紧凑）：

```css
#sidebar.collapsed {
  width: 44px;
  min-width: 44px;
}
#sidebar.collapsed .agent-list-compact {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 0;
}
#sidebar.collapsed .agent-item {
  justify-content: center;
  padding: 6px;
  border-radius: 6px;
}
```

---

## 四、配色系统更新

### 4.1 新的 CSS 变量定义

```css
:root {
  /* ── 灰阶（Claude 中性风） ─── */
  --gray-50:   #FAFAFA;
  --gray-100:  #F5F5F5;
  --gray-200:  #EEEEEE;
  --gray-300:  #E0E0E0;
  --gray-400:  #BDBDBD;
  --gray-500:  #9E9E9E;
  --gray-600:  #757575;
  --gray-700:  #424242;
  --gray-800:  #212121;
  --gray-900:  #121212;

  /* ── 语义色映射 ─── */
  --bg:           var(--gray-50);       /* 主背景 */
  --sidebar-bg:   var(--gray-100);      /* 侧边栏背景 */
  --surface:      #FFFFFF;               /* 卡片/气泡 */
  --text:         var(--gray-800);      /* 主文字 */
  --text-2:       var(--gray-600);      /* 次要文字 */
  --text-3:       var(--gray-500);      /* 禁用/占位 */

  /* ── Accent（Claude 琥珀橙，极克制使用） ─── */
  --accent:       #D97706;
  --accent-light: #FFFBEB;
  --accent-hover: #B45309;

  /* ── 边框（用灰度代替） ─── */
  --border:       var(--gray-200);
  --border-light: var(--gray-100);

  /* ── 阴影（三级，极轻） ─── */
  --shadow-xs:    0 1px 2px rgba(0,0,0,0.03);
  --shadow-sm:    0 2px 8px rgba(0,0,0,0.06);
  --shadow-md:    0 4px 16px rgba(0,0,0,0.10);
}
```

### 4.2 Accent 使用规范（强制）

> Accent 色 `#D97706` 只允许出现在以下三个位置：
>
> 1. **发送按钮**（背景）
> 2. **Session 列表 active 指示条**（左侧 2px）
> 3. **Logo / 品牌元素**
>
> **禁止**用于：背景色、边框色、筛选栏 active 态、新对话按钮

---

## 五、消息区域配合优化

侧边栏安静了，消息区域也要跟进，保持风格统一。

### 5.1 消息气泡 — 去容器化

| 属性 | 当前 | 优化后 |
|------|------|--------|
| AI 气泡背景 | `var(--surface)` 白色 | **transparent** |
| AI 气泡边框 | 无，但有左侧 3px accent 条 | **去掉** |
| AI 气泡阴影 | `0 1px 3px rgba(0,0,0,0.05)` | **none** |
| 用户气泡背景 | `var(--user-bubble)` 淡灰 | **transparent** |
| 区分方式 | 背景色 + 圆角方向 | **对齐方向 + 文字颜色** |

```css
.message.assistant .bubble {
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  padding: 4px 0;
  color: var(--gray-800);
}
.message.user .bubble {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 4px 0;
  color: var(--gray-600);
}
```

### 5.2 代码块 — 保留容器感

代码块是唯一需要"容器感"的元素（Claude 也是如此）：

```css
.code-block {
  margin: 12px 0;
  border-radius: 10px;
  border: 1px solid var(--gray-200);
  overflow: hidden;
  background: var(--gray-50);
}
.code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  background: var(--gray-100);
  border-bottom: 1px solid var(--gray-200);
}
```

---

## 六、输入区优化

| 属性 | 当前 | 优化后 |
|------|------|--------|
| 边框 | `1.5px solid var(--border)` | **1px solid var(--gray-200)** |
| 聚焦边框 | accent 色 + box-shadow | **var(--gray-400) + 极淡阴影** |
| 圆角 | 12px | **16px**（更圆润但不夸张） |
| 阴影 | 无 | **无**（Claude 输入区无浮起感） |
| 发送按钮 | 44px 方形，accent 背景 | **36px 圆形**，accent 背景，在输入框**内部**右下角 |

```css
.input-wrap {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--gray-200);
  border-radius: 16px;
  padding: 10px 16px;
  transition: border-color 150ms ease;
}
.input-wrap:focus-within {
  border-color: var(--gray-400);
  box-shadow: none;    /* 去掉 accent shadow */
}
#send-btn {
  width: 36px; height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  align-self: flex-end;   /* 右下角 */
  margin-top: 4px;
}
```

---

## 七、字体系统

Claude 使用 `Inter`（免费可商用）+ 系统字体回退。

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

:root {
  --font: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Display",
         "Segoe UI", Roboto, "Helvetica Neue", Arial,
         "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", "Cascadia Code",
                "Consolas", monospace;
}
```

**字号规范**：

| 用途 | 字号 | 行高 | 字重 |
|------|------|------|------|
| 消息正文 | 15px | 1.7 | 400 |
| 侧边栏文字 | 13px | 1.5 | 400 |
| 侧边栏 active | 13px | 1.5 | 500 |
| 输入框 | 15px | 1.5 | 400 |
| 代码块 | 13px | 1.6 | 400 |
| 标题（h1） | 20px | 1.3 | 600 |

---

## 八、动效系统

所有 transition 统一用 Claude 风格的 timing function：

```css
:root {
  --transition-fast: 120ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-normal: 180ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 250ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

**动效使用规范**：
- 背景色变化：`120ms`
- 位移（侧边栏折叠）：`200ms`
- 淡入（消息、组件入场）：`180ms`
- **禁止**使用 `ease-in-out`、`ease-in`、`ease-out` 默认曲线

---

## 九、响应式适配

### 9.1 窄屏（≤ 768px）

```css
@media (max-width: 768px) {
  #sidebar {
    position: fixed;
    top: 0; left: 0; bottom: 0;
    width: 280px;
    z-index: var(--z-sidebar);
    transform: translateX(-100%);
    transition: transform 200ms ease;
    box-shadow: var(--shadow-md);
  }
  #sidebar.open {
    transform: translateX(0);
  }
  #hamburger {
    display: flex;   /* 显示汉堡菜单按钮 */
  }
  #sidebar-overlay {
    display: block;   /* 显示遮罩层 */
  }
}
```

### 9.2 超宽屏（≥ 1440px）

```css
@media (min-width: 1440px) {
  .messages-inner {
    max-width: 820px;   /* 从 760px 加宽 */
  }
  #input-area {
    max-width: 820px;
  }
}
```

---

## 十、实施阶段划分

> 以下仅为实施方案参考，本期产出方案文档，暂不执行代码修改。

### 阶段一：侧边栏核心优化（P0，预计 2h）

- [ ] CSS 变量替换（配色系统）
- [ ] 侧边栏 Header 降权
- [ ] 新对话按钮去 CTA 化
- [ ] 筛选栏内联化
- [ ] Session 列表项极简化
- [ ] Active 指示条改为左侧 2px
- [ ] Agent 区域降为配角
- [ ] 侧边栏分隔改用 box-shadow
- [ ] 折叠态优化

### 阶段二：消息区域配合（P1，预计 1.5h）

- [ ] 消息气泡去容器化
- [ ] 代码块保留容器感并优化
- [ ] 输入区极简化
- [ ] 字体系统更新

### 阶段三：动效与响应式（P1，预计 1h）

- [ ] 动效系统统一
- [ ] 窄屏响应式适配
- [ ] 超宽屏适配

### 阶段四：深色模式（P2，预计 2h）

- [ ] 深色模式 CSS 变量定义
- [ ] 主题切换逻辑
- [ ] 侧边栏深色适配

---

## 十一、验收标准

实施时需逐项核对：

1. **第一感觉**：打开页面，侧边栏安静、不抢眼，主区域内容自然成为视觉焦点
2. **无 accent 污染**：侧边栏内除 active 指示条外，无琥珀橙色元素
3. **Session 列表极简**：纯文字 + hover 淡灰 + active 左侧指示条
4. **Agent 区域是配角**：12px regular gray-500 标题，无 badge，无虚线按钮
5. **分隔极轻**：侧边栏与主区域之间无硬边框，只有极淡 shadow 过渡
6. **消息区域无气泡**：AI 消息左对齐无色背景，用户消息右对齐灰色文字
7. **字体舒适**：15px 正文 + 1.7 行高，中文阅读无压迫感
8. **动效统一**：所有过渡使用 `cubic-bezier(0.4,0,0.2,1)`，无生硬动画

---

## 十二、文件变更参考清单

> 仅作后续实施时参考，本期不修改。

| 文件 | 变更内容 |
|------|----------|
| `web/css/style.css` | 全量替换 CSS 变量；侧边栏所有样式；消息气泡样式；输入区样式；动效系统；响应式 |
| `web/js/views/app-view.js` | 筛选栏内联渲染；折叠按钮流入 header；侧边栏宽度调整 |
| `web/js/components/session-list.js` | 去掉 icon 渲染；去掉 agent-badge 渲染；去掉 meta 渲染；active 状态改为伪元素指示条 |
| `web/js/components/agent-list.js` | 去掉 agent-meta 渲染；去掉 skill-tag 渲染；标题降权 |
| `web/js/components/chat-view.js` | 消息气泡去容器化适配；输入区样式更新 |
| `web/index.html` | 引入 Inter 字体（如未引入） |

---

*文档版本：v4.0 | 创建：2026-05-29 | 作者：Buddy*
