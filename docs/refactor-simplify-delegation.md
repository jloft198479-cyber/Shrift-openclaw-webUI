# 重构：去掉委托模式，简化为纯直接对话

## 日期：2026-05-23

## 背景

之前实现了"委托模式"（用户 @mention 子 Agent 后选择"直接对话"或"委托执行"），
但存在两个问题：
1. **UX 不佳**：@mention 后弹出二选一选择器，增加交互步骤
2. **委托执行不确定**：依赖 LLM 是否遵从 system 指令调用 `sessions_spawn`，不可靠

## 决策

**去掉委托模式，保留直接对话模式**。@mention 子 Agent 后直接切换到该 Agent 对话，
通过 `x-openclaw-agent-id` 请求头路由到目标 Agent。

## 修改文件

### 后端
- **server.js** (8930 bytes)：保留 WS 客户端初始化 + `/api/events` SSE 端点，
  去掉不必要的细分事件路由，统一 `_broadcastSSE()` 广播
- **ws-client.js** (4688 bytes)：简化为纯事件桥，去掉不存在的 `subscribe` 方法，
  保留 Connect 握手（protocol v4）+ 自动重连 + 心跳

### 前端
- **ws-bridge.js** (3113 bytes)：简化为通用 SSE 事件监听器，
  去掉委托事件处理，保留 `on/off` 监听器接口和通配符 `*` 监听
- **chat-view.js** (21955 bytes)：去掉 `delegateChat` 调用、`insertDelegationCard`、
  `handleDelegationEvent`，只保留直接对话流程（`Api.chat()` + SSE 流式渲染）
- **api.js** (5988 bytes)：去掉 `delegateChat` 方法，只保留 `chat()` 直接对话方法
- **mention-completer.js** (4206 bytes)：去掉模式选择器，@mention 直接设置
  `pendingDelegation: { mode: 'direct' }` + 显示对话 badge
- **state.js**：保留 `pendingDelegation`（语义上改为"待发送的 @mention 目标"）

### CSS
- **style.css**：删除以下样式块：
  - `.agent-delegation-card` 整块（委托卡片执行中/完成/失败状态）
  - `.mention-mode-picker` 整块（模式选择弹窗）
  - `.agent-delegation-result` 整块（委托结果内容区）
  - `.agent-result-card` / `.agent-result-header` / `.agent-result-body` 整块
  - `.agent-delegation-status` 过渡细化
  - 保留：`#delegate-badge`（改为"@mention 对话标签"）、`.ws-status-dot`、Agent 颜色变量

## 架构现状

### 交互模式：直接对话
```
用户 @子Agent → 直接切换到该 Agent 对话
  → x-openclaw-agent-id 路由到目标 Agent
  → /v1/chat/completions SSE 流式返回
```

### 事件桥（保留，为未来扩展用）
```
Gateway WS → ws-client.js → server.js /api/events SSE → ws-bridge.js → 监听器
```

### 待扩展
- 未来如需委托模式，可通过 WsBridge.on() 监听特定事件实现
- WsBridge 的事件路由机制已预留，不需要改动架构
