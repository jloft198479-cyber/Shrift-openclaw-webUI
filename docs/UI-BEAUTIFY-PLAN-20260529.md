## 虾指挥 UI 美化方案 — Claude 风格 + 侧边栏深度优化

> **版本**：v3.0 | 日期：2026-05-29
> **核心策略**：「消失的界面」— UI 退到幕后，内容成为唯一主角
> **重点**：侧边栏从「控制面板」升级为「安静助手」，全盘 Claude 设计语言

---

## 一、整体设计哲学

借鉴 Claude 的核心设计原则，同时保留虾指挥的多 Agent 差异化功能：

1. **消失的界面**：不用气泡、边框、卡片去"框"内容；用灰度和排版建立层级
2. **极致留白**：消息间距宽松，内容居中呼吸
3. **克制的品牌色**：赤陶色 #C96442 仅出现在 logo、发送按钮、选中指示，不染色背景
4. **功能克制**：侧边栏只有一个视觉主角——会话列表，其他都是配角
5. **动效极简**：只做淡入，不做花哨的入场动画

---

## 二、配色系统（核心改动）

### 2.1 色板定义

`css
:root {
  /* 灰色系（中性偏暖，极克制） */
  --gray-50:  #FAFAFA;
  --gray-100: #F5F5F5;
  --gray-200: #EEEEEE;
  --gray-300: #E0E0E0;
  --gray-400: #BDBDBD;
  --gray-500: #9E9E9E;
  --gray-600: #757575;
  --gray-700: #424242;
  --gray-800: #212121;
  --gray-900: #121212;

  /* 品牌色（赤陶色，极少量使用） */
  --accent:        #C96442;
  --accent-hover:  #B55A38;
  --accent-subtle: #FAF5F2;
  --accent-text:   #C96442;

  /* 表面 */
  --surface:       #FFFFFF;
  --surface-hover: #F5F5F5;

  /* 边框（极少使用） */
  --border:       #E0E0E0;
  --border-light: #EEEEEE;

  /* 阴影（极简三级） */
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.03);
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 16px rgba(0,0,0,0.10);
}
`

### 2.2 与当前色板的关键变化

| 变量 | 当前值 | 新值 | 理由 |
|------|--------|------|------|
| --bg | #F9FAFB | #FAFAFA | 中性灰，非冷灰 |
| --sidebar-bg | #F3F4F6 | #F5F5F5 | 与主区仅1级灰度差 |
| --accent | #D97706 琥珀橙 | #C96442 赤陶色 | 保留品牌个性 |
| accent 用法 | 按钮/筛选栏/气泡 | **仅 logo+发送按钮+选中指示** | Claude 克制原则 |

---

## 三、侧边栏深度优化（核心重点）

### 3.1 当前问题诊断

1. **accent 色太抢** — 新对话按钮虚线边框+accent背景；筛选栏active也是accent
2. **信息层级混乱** — logo 22px粗体、新对话16px粗体accent、「虾内助」16px粗体，三者同等权重
3. **新对话按钮太重** — 虚线边框+accent背景 = CTA按钮视觉重量
4. **session item 太胖** — icon+agent-badge+name+meta+menu-btn，5个元素抢注意力
5. **折叠按钮突兀** — 悬浮右边缘，24px圆形+border+accent hover
6. **Agent 区域太重** — section-title 16px粗体+badge+虚线accent新建按钮
7. **border-right 太明显** — 1px solid，与Claude无分隔线做法相反

### 3.2 新侧边栏视觉设计

`
+-- 侧边栏（260px, #F5F5F5）-------------------+
|                                                   |
|  虾指挥  [< 折叠]                               |
|                                                   |
|  + 开始新对话                                    |
|                                                   |
|  ---                                             |
|                                                   |
|  最近对话                  [待办]                   |
|                                                   |
|    前端项目讨论                                   |
|    写周报             <- 纯文字，13px 深灰        |
|    代码审查           <- hover: 极淡灰背景         |
|    学习笔记           <- active: 左侧2px accent指示  |
|                                                   |
|  ---                                             |
|                                                   |
|  助手                             [+ 新建]        |
|                                                   |
|    前端开发者                                    |
|    Python工程师                                  |
|    私域运营师                                    |
|                                                   |
+---------------------------------------------------+
右侧: box-shadow: 1px 0 0 rgba(0,0,0,0.04)
`

### 3.3 侧边栏各元素改动明细

#### ① Header 极简化

- logo 保持，标题从 22px semibold 降为 14px medium gray-800
- 去掉 restart-btn（移到 dropdown 或隐藏）
- 折叠按钮从「悬浮在右边缘」改为「header 右侧小 icon」
- padding: 16px 16px 10px

#### ② 新对话按钮 → 改为同款 item

- 当前：<button> 虚线边框 + accent 背景 + accent 文字
- 新方案：做成 session-item 同款的 div，不是按钮
- hover：和 session item 一样极淡灰背景

#### ③ 筛选栏 → 内联到标题旁

- 当前：2个 filter-btn 横排占一行
- 新方案：在「最近对话」标题右侧加「待办」文字链接
- 省出一行空间给会话列表

#### ④ 会话列表 — 极简

- 去掉 icon、去掉 agent-badge、去掉 meta 时间
- name 单行，13px，深灰，hover 极淡灰背景
- active 状态：左侧 2px accent 指示条 + 极淡底色
- item 间距从 margin-bottom:4px 改为 2px，更紧凑
- menu-btn 保留，但 opacity:0 默认，hover 时显示

#### ⑤ Agent 区域 — 降为配角

- 标题「助手」12px regular gray-500（不是 semibold）
- 去掉 section-count badge
- 去掉 new-agent-btn 的虚线 accent 样式
- agent item：emoji icon(20px) + 名称(13px)，单行紧凑
- 去掉 agent-meta（描述、skill-tag）

#### ⑥ 折叠按钮 — 安静化

- 从悬浮绝对定位改为 header 流内布局
- 无 border，无 background，无 accent hover
- hover: color 变深

#### ⑦ 侧边栏分隔 — 去掉 border

- 当前：order-right: 1px solid
- 新方案：ox-shadow: 1px 0 0 rgba(0,0,0,0.04)
- 宽度从 240px 略加宽到 260px

---

## 四、消息区域 — 无气泡布局

### 4.1 核心变化：去掉消息气泡

- AI 消息：左对齐，深色文字，无背景，无边框，无圆角
- 用户消息：右对齐，灰色文字，无背景，无边框，无圆角
- 区分方式：对齐方向 + 文字颜色，而非背景色/气泡

### 4.2 代码块保持容器感

代码块是唯一需要"容器感"的元素：
- 整体圆角 10px
- 标题栏深色 + 语言名 + 复制按钮
- 代码区深色背景

---

## 五、输入区 — 极简容器

- 边框极淡（#EEEEEE），hover 时稍微加深
- 圆角 24px（大圆角但不是胶囊）
- 不用 ox-shadow（Claude 输入区没有阴影浮起感）
- 发送按钮：圆形小按钮，accent 色，在输入框右侧内部

---

## 六、排版系统

| 用途 | 当前值 | 新值 | 理由 |
|------|--------|------|------|
| 消息正文 | 13px | **16px** | Claude 标准，中文需要更大 |
| 消息行高 | 1.6 | **1.75** | 16px x 1.75 = 28px，中文舒适 |
| 侧边栏文字 | 13px | **13px** | 辅助区域保持小 |
| 输入框 | 16px | **15px** | 略小于正文 |
| 代码块 | 13px | **13.5px** | 小于正文以区分层级 |
| 欢迎标题 | 22px | **24px** | 大而简洁 |

---

## 七、文件变更清单

### 7.1 CSS 改动（web/css/style.css）

| 区域 | 改动描述 |
|------|----------|
| :root | 全量替换色板变量 + 增加灰阶变量 |
| #sidebar | 去掉 border-right → box-shadow；宽度 260px |
| #sidebar-collapse-btn | 去掉 position:absolute → 流内；去掉 border |
| .sidebar-header h1 | 22px semibold → 14px medium |
| #new-chat-btn | 去掉虚线 accent → 透明背景同款 item |
| #filter-bar | 去掉独立行 → 内联到标题旁 |
| .session-item | 简化：去掉 icon、meta；紧凑间距 |
| .session-item.active | box-shadow inset → 伪元素 2px accent 指示条 |
| #agent-section | 降级视觉：12px 标题、去掉 badge |
| .agent-item | 紧凑化、隐藏 meta |
| .message .bubble | **去掉背景/边框/阴影/圆角** |
| #input-area | 极简容器、大圆角、去阴影 |
| 滚动条 | 宽度 4px、更淡的 thumb |

### 7.2 JS 改动

| 文件 | 改动 |
|------|------|
| iews/app-view.js | 筛选栏内联到标题旁；折叠按钮移入 header 流内 |
| components/session-list.js | 移除 icon 渲染、meta 渲染 |
| components/agent-list.js | 移除 agent-meta 渲染 |
| components/message-renderer.js | 适配无气泡样式 |

---

## 八、实施优先级

| 阶段 | 任务 | 预计工时 |
|------|------|----------|
| **P0** | CSS 变量替换（色板） | 15min |
| **P0** | 侧边栏去 border → shadow | 5min |
| **P0** | 新对话按钮极简化 | 10min |
| **P0** | 筛选栏内联 | 20min |
| **P0** | session-item 简化 | 20min |
| **P1** | 折叠按钮安静化 | 15min |
| **P1** | Agent 区域降级 | 15min |
| **P1** | 消息去气泡 | 15min |
| **P1** | 输入区极简化 | 10min |

**P0 总工时**：约 1.5 小时  
**P0+P1 总工时**：约 2.5 小时

---

## 九、验收标准

1. 打开页面第一感觉：干净、安静、留白充足
2. 侧边栏与主区域无可见分隔线，灰度差自然过渡
3. 侧边栏无 accent 色元素（除选中指示条外）
4. 会话列表极简：纯文字 + hover 淡灰 + active 左侧 accent 指示条
5. 消息区域无气泡，用户消息右对齐灰色，AI 消息左对齐深色
6. 输入区极简容器，不抢注意力
7. 品牌色只出现在 logo、发送按钮、选中指示上
8. 16px 正文 + 1.75 行高，中文阅读舒适
