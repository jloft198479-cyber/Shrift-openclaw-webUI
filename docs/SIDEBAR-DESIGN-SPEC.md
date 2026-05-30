# 侧边栏设计规范

> 最后更新：2026-05-29
> 参考来源：Claude 设计系统、ClawX 侧边栏、Open Design 排版规范

---

## 一、字体方案

### 字体分工
| 用途 | 字体 | 来源 |
|------|------|------|
| 标题（虾指挥、虾助手） | HYQiHei | 本地下载 |
| 欢迎页标题（开始新对话） | HYQiHei | 本地下载 |
| 正文/UI 文字 | Noto Sans SC | Google Fonts CDN |
| 系统回退 | Microsoft YaHei, PingFang SC | 系统字体 |

### 字体文件
- `web/fonts/HYQiHei-65S.ttf` — 气黑体 65 字重，用于标题

---

## 二、字重体系

| 用途 | 字重 | 说明 |
|------|------|------|
| 正文 | 400 | 普通阅读 |
| UI 强调 | 500 | 选中态、导航 |
| 标题 | 650 | HYQiHei 原生字重 |
| 大标题 | 700 | 备用粗体 |

---

## 三、行高规范

| 文字尺寸 | 行高 | 依据 |
|----------|------|------|
| ≤14px | 1.5 | Claude: Small 用 1.5 |
| 15-18px | 1.5-1.6 | Claude: Body 用 1.5-1.6 |

---

## 四、侧边栏元素规范

### 4.1 Header 区域
```css
.sidebar-header {
  padding: 20px 16px 10px;
}

.sidebar-header .logo img {
  max-height: 28px;
}

.sidebar-header h1 {
  font-family: 'HYQiHei', 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
  font-size: 18px;
  font-weight: 650;
  line-height: 1.2;
}
```

### 4.2 重启按钮
```css
.restart-btn {
  opacity: 0.5;           /* 默认半透明可见 */
  width: 22px; height: 22px;
  transition: opacity 150ms ease;
}
.restart-btn:hover { opacity: 1; }
```

### 4.3 新建会话按钮
```css
#new-chat-btn {
  margin: 8px 12px 10px;
  padding: 8px 12px;
  border: 1px solid rgba(0,0,0,0.1);  /* 弱显示细黑边框 */
  border-radius: var(--radius-sm);     /* 8px */
  font-size: 14px;
  font-weight: 400;
  color: var(--text-2);
}
```

### 4.4 会话列表项
```css
.session-item {
  padding: 8px 12px;
  margin-bottom: 2px;
  border-radius: var(--radius-sm);
}
.session-item .name {
  font-size: 14px;
  font-weight: 400;       /* 非选中 */
  line-height: 1.5;
  color: var(--text-2);
}
.session-item:hover .name { color: var(--text); }
.session-item.active .name {
  font-weight: 500;       /* 选中态 */
  color: var(--text);
}
.session-item:hover { background: rgba(0,0,0,0.05); }
.session-item.active { background: rgba(0,0,0,0.05); }
```

### 4.5 Agent 标签（会话中的助手标识）
```css
.session-agent-badge {
  height: 16px;
  padding: 0 5px;
  font-size: 9px;
  font-weight: 500;
  border-radius: 8px;
  background: rgba(0,0,0,0.04);
  color: var(--muted);
}
```

### 4.6 虾助手区域
```css
/* 标题 */
#agent-section .section-title {
  font-family: 'HYQiHei', 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
  font-size: 13px;
  font-weight: 650;
  color: var(--meta);
}

/* 新建按钮 */
#agent-section .section-header .new-agent-btn {
  font-size: 16px;
  color: var(--text-2);
  background: rgba(0,0,0,0.04);
  width: 22px; height: 22px;
}
```

### 4.7 助手列表项
```css
.agent-item {
  padding: 7px 10px;
  border-radius: var(--radius-sm);
}
.agent-item .agent-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.agent-item .agent-name {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--text-2);
}
.agent-item .agent-meta {
  font-size: 12px;
  color: var(--meta);
  line-height: 1.4;
}
.agent-item:hover { background: rgba(0,0,0,0.04); }
.agent-item.active { background: rgba(0,0,0,0.05); }
.agent-item.active .agent-name { color: var(--text); }
```

### 4.8 拖动线（已隐藏）
```css
.agent-resize-divider { background: transparent; }
.agent-resize-divider:hover { background: transparent; }
```

---

## 五、颜色规范

| 用途 | 色值 | 变量 |
|------|------|------|
| 主背景 | #FAFAFA | --bg |
| 主文字 | #1A1A1A | --text |
| 次要文字 | #666666 | --text-2 |
| 灰色文字 | #999999 | --meta |
| 边框 | #E5E5E5 | --border |
| hover 背景 | rgba(0,0,0,0.05) | - |
| active 背景 | rgba(0,0,0,0.05) | - |

---

## 六、间距规范

| 元素 | 间距 |
|------|------|
| Header padding | 20px 16px 10px |
| 新建按钮 margin | 8px 12px 10px |
| 会话项 padding | 8px 12px |
| 助手项 padding | 7px 10px |
| 助手名称与简介 gap | 2px |

---

## 七、冻结区域

以下区域已冻结，修改需用户确认：
- 会话框 UI（聊天区域）
- 消息气泡样式
- 流式渲染

---

## 八、设计原则

1. **字体分层** — 标题用 HYQiHei，正文用系统字体
2. **行高 1.5** — 小字（≤14px）统一 1.5 行高
3. **字重体系** — 400/500/650 三档
4. **hover 反馈** — 5% 黑色背景
5. **弱边框** — 按钮用 rgba(0,0,0,0.1) 细边框
6. **隐藏拖动线** — 保留功能，隐藏视觉

---

## 九、前端架构优化记录

> 最后更新：2026-05-29
> 优化范围：P0 高风险、P1 中风险、P2 低风险问题

### 9.1 P0 高风险问题（已解决）

#### 问题 1：全局函数污染
- **现状**：20+ 全局函数直接暴露在 window 上
- **解决方案**：创建 `Utils` 模块，封装所有工具函数
- **向后兼容**：保留全局函数别名

#### 问题 2：重复代码
- **现状**：`getAttachmentIcon`、复制逻辑等重复定义
- **解决方案**：统一到 `Utils` 模块，其他模块引用

#### 问题 3：ChatView 职责过重
- **现状**：787 行代码，混合业务逻辑和视图
- **解决方案**：拆分为 `ChatController`（业务逻辑）+ `ChatView`（纯视图）
- **结果**：315 行，职责分离

### 9.2 P1 中风险问题（已解决）

#### 问题 1：状态管理扁平
- **现状**：20+ 属性在同一层级
- **解决方案**：分组为 `State.ui`、`State.chat`、`State.agent`、`State.connection`、`State.model`
- **向后兼容**：保留 `State.xxx` 直接访问

#### 问题 2：SSE 重连无指数退避
- **现状**：固定 3 秒重连
- **解决方案**：指数退避（3-30 秒），连接成功后重置

#### 问题 3：错误处理不统一
- **现状**：Toast、气泡、alert 混用
- **解决方案**：创建 `ErrorHandler` 统一处理层

### 9.3 P2 低风险问题（已解决）

#### 问题 1：术语不统一
- **现状**：Gateway/服务器/Server 混用
- **解决方案**：创建 `GLOSSARY.md` 术语表

#### 问题 2：魔法数字
- **现状**：45+ 处硬编码数字
- **解决方案**：提取到 `Constants` 常量模块

#### 问题 3：事件监听器未清理
- **现状**：无 destroy 方法
- **解决方案**：添加 `_handlers` 数组和 `destroy()` 方法

---

## 十、新增文件清单

| 文件 | 用途 |
|------|------|
| `web/js/utils/utils.js` | 工具函数模块 |
| `web/js/utils/error-handler.js` | 统一错误处理层 |
| `web/js/constants.js` | 常量定义 |
| `web/js/controllers/chat-controller.js` | 聊天业务逻辑控制器 |
| `docs/GLOSSARY.md` | 术语表 |

---

## 十一、备份记录

| 时间 | 备份目录 | 内容 |
|------|---------|------|
| 2026-05-29 14:20 | `_backup-sidebar-design-20260529-142044/` | 侧边栏设计 |
| 2026-05-29 15:30 | `_backup-p0p1p2-20260529-153014/` | P0/P1/P2 优化 |
