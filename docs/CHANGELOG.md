# CHANGELOG — openclaw-web-ui（虾指挥）

> 所有代码变更的按时间倒序记录。每完成一项改动，追加一条记录。

---

## 2026-05-23

### 侧栏三点菜单修复与优化
**类型**：Bug修复 + 功能增强 | **影响范围**：侧栏交互、menu-system.js、event-router.js

**Bug：Agent 菜单按钮点击无响应**
- `event-router.js` 中 agent-list 的 click 事件没有拦截 `.agent-menu-btn`，点击冒泡到 `.agent-item` 导致选中 agent 而不是弹出菜单
- 只有右键菜单绑定了 `toggleAgentMenu`，左键点击 ⋮ 按钮无效

**Bug：`const session = null` 不可重赋值**
- `menu-system.js` 第7行 `const session = null`，后面的 `session = sessions[i]` 赋值失败，`session` 永远是 null
- 导致重命名时 `session.name` 报错，待办状态判断失效

**优化：内联重命名替代 `prompt()`**
- 会话重命名从原生 `prompt()` 弹窗改为内联 input 编辑
- 点击重命名后 `.name` 区域变为 input，Enter 确认、Escape 取消、失焦自动保存

**优化：会话菜单**
- 重命名改为内联 input 编辑（Enter 确认 / Escape 取消 / 失焦保存）

**优化：Agent 菜单**
- 删除 Agent 后自动退出该 Agent 模式

**优化：全局点击关闭菜单**
- 点击页面空白区域自动关闭下拉菜单

**优化：Agent 菜单按钮样式对齐**
- 与会话 `.menu-btn` 统一尺寸和 hover 效果
- 删除 CSS 中重复的 `.agent-dropdown` 规则

**涉及文件**：
- `web/js/ui/menu-system.js` — 修复 const bug + 内联重命名 + Agent 菜单（编辑/删除）
- `web/js/controllers/event-router.js` — 修复 agent-menu-btn 点击拦截 + 全局点击关闭菜单
- `web/css/style.css` — Agent 菜单按钮样式对齐 + 删除重复规则

---

### 附件上传多模态支持 + 跨会话隔离修复
**类型**：功能增强 + Bug修复 | **影响范围**：发送流程 + 会话管理 + API 消息构建

**问题一：附件只上传了图标，没传给 LLM**
- 文件确实上传到了服务器 `uploads/` 目录，返回 `{name, path, type}`
- 但 `session.messages` 只存了 `🖼 文件名.png` 纯文本，真实路径丢失
- `Api.chat` 发给 Gateway 的 messages 也是纯文本，LLM 完全看不到文件

**问题三：图片 image_url 路径映射问题**
- 之前用 `window.location.origin + att.path`（即 `http://localhost:3001/uploads/xxx.png`）
- 但 Gateway（端口 18789）无法回调我们的 Web 服务器获取图片
- 改为 `data:` URL 格式（base64 内嵌），Gateway 可直接解码，无需回调
- 历史消息（无 dataUrl）降级为 path URL

**修复**：
- `sendMessage` 中 `session.messages.push()` 新增 `attachments` 字段保存元数据（去掉 dataUrl 避免 localStorage 爆满）
- `_buildApiMessages` 新增第4参数 `attachmentPaths`，支持构建多模态 content
- 图片附件 → `image_url` 格式，优先用 `data:` URL（base64 内嵌），降级用 path
- 非图片附件 → 嵌入 `[附件: 文件名 (路径: /uploads/xxx, 类型: application/pdf)]` 文本
- `AttachmentBar.uploadAll()` 返回结果现在包含 `dataUrl` 字段
- 无附件时退化为纯字符串，兼容性零影响

**问题二：附件跨会话残留**
- `AttachmentBar.pendingAttachments` 是全局单例，切换会话时未清空
- 之前在三个入口手动加 `clearAttachments()`，新增入口容易遗漏

**修复**：清空逻辑收到 `ChatView.clearMessages()` 内部，自动清附件。任何新增会话入口只需调用 `clearMessages()`。

**涉及文件**：
- `web/js/components/chat-view.js` — 多模态消息构建 + clearMessages 内含 clearAttachments
- `web/js/controllers/session-manager.js` — 移除三处手动 `clearAttachments()` 调用

---

### 文件上传附件卡片 + 错误提示统一组件
**类型**：功能 + 重构 | **影响范围**：前端消息渲染层 + CSS

**背景**：
1. 用户消息中的附件信息（🖼 文件名.png）仅以纯文本展示，无法区分文本和附件，体验差
2. 错误提示在 `chat-view.js` 中硬编码 `style="color:#DC2626"`，不可复用、风格不统一

**改动**：

**① 附件卡片 UI**
- `message-renderer.js` 新增 `_parseAttachments()` 解析消息中 🖼/📄 等前缀行，分离文本和附件
- `appendMessage()` 新增第6个参数 `attachmentMeta`（可选），传入 `[{name, type, path}]` 时渲染卡片 UI
- 用户消息气泡中：文本内容 + 附件卡片（图标 + 文件名，赤陶色系圆角卡片）
- 历史消息恢复兼容：无 `attachmentMeta` 时自动从文本解析附件前缀渲染
- `chat-view.js` 的 `sendMessage` 中传入 `attachmentPaths` 作为 `attachmentMeta`

**② 错误提示统一组件**
- `MessageRenderer.showError(bubble, prefix, message)` 替代所有 `innerHTML = '<span style="color:#DC2626">...'`
- 渲染为 `<div class="chat-error">` — 红色系背景+边框+⚠图标+粗体标签
- `chat-view.js` 中 `onError` 和 `catch` 均改用 `MessageRenderer.showError()`
- 全项目 JS 中零残留 `style="color:#DC2626"` 内联样式

**新增 CSS 类**：
- `.msg-attachments` / `.msg-attachment-card` / `.msg-att-icon` / `.msg-att-name` — 附件卡片
- `.chat-error` / `.chat-error-icon` / `.chat-error-label` — 错误提示

**涉及文件**：
- `web/js/components/message-renderer.js` — 新增附件解析/渲染 + showError 方法（4.2KB → 9.9KB）
- `web/js/components/chat-view.js` — 传入 attachmentMeta + 用 showError 替换内联错误
- `web/css/style.css` — 新增附件卡片 + 错误提示样式（~50 行）

---

### chat-view.js 拆分重构
**类型**：重构 | **影响范围**：前端 JS 组件层

**背景**：`chat-view.js` 膨胀至 22KB，承担了消息渲染、流式渲染、附件处理、发送调度等全部职责，可读性和维护性下降。

**改动**：按职责拆分为 4 个模块：

| 新文件 | 大小 | 职责 |
|--------|------|------|
| `components/chat-view.js` | 11KB（原22KB） | 主控：欢迎页、Agent 顶栏、sendMessage 调度、会话管理 |
| `components/message-renderer.js` | 4.2KB | 消息气泡 DOM 构建、Agent 颜色系统（8色 hash 分配）、agent-label、thinking-block |
| `components/stream-renderer.js` | 3.9KB | 流式渲染（rAF 合并）、思考块实时更新、停止/重置按钮、endStreaming 状态清理 |
| `components/attachment-bar.js` | 5.2KB | 附件选择/拖拽/粘贴 UI、文件上传、MIME 图标映射 |

**兼容性**：
- ChatView 保留所有原有公开方法签名（`handleFiles` / `appendMessage` / `stopGeneration` / `sendMessage` 等），内部委托给子模块
- 外部调用方（event-router.js / session-manager.js / ws-bridge.js / app.js）零修改
- `index.html` 在 `chat-view.js` 前新增 3 个 `<script>` 标签

**关键设计决策**：
- `StreamRenderer` 通过 `getStreamState()` / `setStreamState()` 暴露内部状态，`chat-view.js` 的 `sendMessage` 仍持有 `st` 引用直接操作，避免过度封装
- `AttachmentBar.uploadAll()` 替代原 `ChatView.uploadAttachments()`，方法名更语义化

**涉及文件**：
- `web/js/components/chat-view.js` — 重写
- `web/js/components/message-renderer.js` — 新建
- `web/js/components/stream-renderer.js` — 新建
- `web/js/components/attachment-bar.js` — 新建
- `web/index.html` — 新增 3 行 script 标签

---

### 委托模式简化重构
**类型**：重构 | **影响范围**：前端 + 后端

**背景**：委托模式（主 Agent spawn 子 Agent）的 UX 不佳（@mention 后弹二选一选择器），且实际执行依赖 LLM 遵从 system 指令，不可靠。决定简化为"直接对话"模式。

**改动**：
- 去掉 @mention 后的"直接对话 vs 委托执行"选择器，@mention 直接进入直接对话模式
- 删除 `delegateChat()`、`insertDelegationCard()`、`handleDelegationEvent()` 等委托相关代码
- 删除约 200 行委托相关 CSS（委托卡片、模式选择器、结果区、agent-delegation-result 等）
- 简化 `ws-client.js`（去掉 subscribe 方法）、`ws-bridge.js`（去掉委托事件处理）、`server.js`（统一 `_broadcastSSE()`）
- `State.pendingDelegation` 保留，仅存储 @mention 选中的 agent 信息

**涉及文件**：
- `web/js/components/chat-view.js` — 删除委托分支
- `web/css/style.css` — 删除约 200 行委托样式
- `web/js/ui/mention-completer.js` — 直接对话模式
- `server.js` — 简化 SSE 广播
- `ws-client.js` — 简化
- `ws-bridge.js` — 简化
- `docs/refactor-simplify-delegation.md` — 重构记录
