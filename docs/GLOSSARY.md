# 术语表

> 最后更新：2026-05-29

本文档定义了项目中使用的标准术语，用于保持代码和文档的一致性。

---

## 核心概念

| 中文 | 英文 | 说明 |
|------|------|------|
| 网关 | Gateway | OpenClaw 后端服务，负责处理 AI 请求 |
| 助手 | Agent | AI 角色，可以是主助手或子助手 |
| 会话 | Session | 一次完整的对话记录 |
| 消息 | Message | 会话中的单条消息 |
| 流式 | Streaming | 实时传输 AI 响应的方式 |

---

## 架构术语

| 中文 | 英文 | 说明 |
|------|------|------|
| 主节点 | Main Node | 前端 Web UI |
| 从节点 | Slave Node | OpenClaw 桌面客户端 |
| 指令下发 | Command Dispatch | 前端发送指令到后端 |
| 状态回执 | State Receipt | 后端返回状态给前端 |
| 事件桥 | Event Bridge | SSE 连接，用于实时事件推送 |

---

## UI 术语

| 中文 | 英文 | 说明 |
|------|------|------|
| 侧边栏 | Sidebar | 左侧导航栏 |
| 欢迎页 | Welcome Page | 新会话时显示的页面 |
| 气泡 | Bubble | 消息内容容器 |
| 标签 | Tag | Agent 标识 |
| 提及 | Mention | @某人 |

---

## 状态术语

| 中文 | 英文 | 说明 |
|------|------|------|
| 流式中 | Streaming | AI 正在生成响应 |
| 已连接 | Connected | SSE 连接正常 |
| 已断开 | Disconnected | SSE 连接断开 |
| 重连中 | Reconnecting | 正在尝试重新连接 |

---

## 错误术语

| 中文 | 英文 | 说明 |
|------|------|------|
| 请求失败 | Request Failed | API 请求返回错误 |
| 连接超时 | Connection Timeout | 网络连接超时 |
| 解析错误 | Parse Error | 数据解析失败 |
| 未知错误 | Unknown Error | 未预期的错误 |

---

## 使用规范

### 1. 代码注释
```javascript
// ✅ 正确
// 网关连接状态
const gatewayStatus = 'connected';

// ❌ 错误
// 服务器连接状态
const serverStatus = 'connected';
```

### 2. 变量命名
```javascript
// ✅ 正确
const agentList = [];
const sessionStore = {};

// ❌ 错误
const assistantList = [];
const conversationStore = {};
```

### 3. 日志输出
```javascript
// ✅ 正确
console.log('[Gateway] Connected');

// ❌ 错误
console.log('[Server] Connected');
```

### 4. 用户提示
```javascript
// ✅ 正确
showToast('网关连接失败', 3000, 'error');

// ❌ 错误
showToast('服务器连接失败', 3000, 'error');
```

---

## 术语来源

- **Gateway**：来自 OpenClaw 架构设计
- **Agent**：来自 AI Agent 概念
- **Session**：来自 Web Session 概念
- **Streaming**：来自 SSE (Server-Sent Events) 技术

---

## 更新记录

| 日期 | 更新内容 |
|------|---------|
| 2026-05-29 | 初始版本，定义核心术语 |
