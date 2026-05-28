# OpenClaw Web UI — Agent 交互模式设计方案

> 记录时间: 2026-05-27 00:41
> 项目路径: F:\fzz-Project\openclaw-web-ui
> OpenClaw 配置: D:\AppData\openclaw\openclaw.json
> Gateway 端口: 18789, Token: hermes-local-dev

---

## 一、需求定义：四种 Agent 交互模式

用户明确提出四种模式：

### 1. 即时指派模式
- **场景**: 用户在主 agent 会话里 @子agent，等任务完成再继续
- **实现方式**: 消息发给主 agent，由主 agent 调 sessions_spawn，前端等待子 agent 结果返回后渲染
- **关键**: @mention 语义从"直连子 agent"变为"告诉主 agent 你要找谁"

### 2. 独立交互模式
- **场景**: 直接在子 agent 自己的会话窗口对话
- **实现方式**: 走 /v1/chat/completions + x-openclaw-agent-id header，直连子 agent HTTP 端点
- **关键**: 现有代码已实现（Api.chat() 的 agentId 参数）

### 3. 智能调度规则
- **场景**: 主 agent 依据任务类型自主调用预设子 agent
- **实现方式**: AGENTS.md 规则驱动，主 agent 内在能力，无需前端特殊处理
- **关键**: 当前 AGENTS.md 已包含子 agent 列表和 sessions_spawn 调用指引

### 4. 后台委托模式
- **场景**: 异步调度，任务可后台运行
- **实现方式**: sessions_spawn + mode="run"，子 agent 在隔离 session 中执行
- **关键**: 暂未深入，需后续设计

---

## 二、核心问题定位

**Web UI 委派模式（即时指派）跑不通的根因**：

### 问题 1: 前端绕过主 agent 直连子 agent
- Api.chat() 通过 x-openclaw-agent-id header 直接调子 agent HTTP 端点
- 这跳过了主 agent，导致 sessions_spawn 无法触发
- 结果：子 agent 结果能返回，但没有经过主 agent 的协调

### 问题 2: HTTP SSE 无法接收异步结果
- /v1/chat/completions 是请求-响应模型，一次请求只能返回一次响应
- sessions_spawn 异步执行：主 agent 先返回"已派出"，子 agent 完成后的最终回复无法通过已关闭的 HTTP SSE 连接送达
- 结果：子 agent 的结果丢失

### 问题 3: WS 连接无 chat 事件监听
- ws-bridge.js 只监听 	ick/health/presence 事件，无 chat 事件处理
- Gateway 通过 WS 广播 chat 事件（delta/final/error），但前端没有消费
- 结果：子 agent 完成后的事件被忽略

---

## 三、解决方案架构

### 核心架构变更: 主 agent 对话改走 WebSocket

**数据流**:
`
前端 chatViaWS() 
  → POST /api/chat/send 
  → 后端 handleChatSend 
  → wsClient.chatSend('agent:main:main', message) 
  → Gateway 
  → chat 事件广播 (delta/final/error)
  → server.js _broadcastSSE 
  → 前端 SSE 
  → ws-bridge.js 解析 
  → Api._wsOnDelta/Final/Error
`

### Gateway chat 事件格式
`json
{
  "event": "chat",
  "payload": {
    "state": "delta|final|error",
    "sessionKey": "agent:main:main",
    "runId": "xxx",
    "message": {
      "content": [{ "type": "text", "text": "..." }]
    },
    "stopReason": "stop|length|tool_use",
    "errorMessage": "..."
  }
}
`

**注意**: 此格式基于文档推测，未经 Gateway 实际验证。需端到端测试确认。

### @mention 语义变化
- **旧**: @子agent → 前端直接调子 agent HTTP 端点（绕过主 agent）
- **新**: @子agent → 消息发给主 agent，主 agent 调 sessions_spawn（经主 agent 协调）

---

## 四、响应慢问题分析

### 根因（3 个叠加因素）

1. **系统上下文巨大（主因）**
   - Gateway 注入完整工具 schema + workspace 文件，约 20K-24K tokens
   - 主 session tokens: 24,609，单次请求约 39K

2. **Web UI 缓存冷启动**
   - 走 /v1/chat/completions 创建新 session，DeepSeek prompt cache 失效
   - WebChat channel 复用持久 session，98% cache 命中率

3. **collectBody() 全量缓冲（非主因）**
   - 延迟 <100ms，可忽略

### WS chat 如何改善
- 主 agent 复用 gent:main:main 持久 session
- 和 WebChat 共享 prompt cache，避免冷启动
- 预期 TTFT 显著降低

---

## 五、代码改动清单

### 已实施（未验证）

| 文件 | 改动 | 目的 |
|------|------|------|
| config.json | 端口 28789→18789 | 还原错误改动 |
| ws-client.js | Origin header 动态化 | 支持不同端口配置 |
| ws-client.js | var→const/let | 代码风格 |
| server.js | /api/chat/send 超时+runId | WS chat HTTP 端点改进 |
| api.js | chatViaWS() + stopWSChat() | 前端 WS chat 发送 |
| chat-view.js | 主 agent 走 WS 路径 | 即时指派模式核心 |
| stream-renderer.js | stopGeneration WS 支持 | 停止生成兼容 |
| ws-bridge.js | _bindChatEvents() | 消费 Gateway chat 事件 |

### 待实施

| 文件 | 改动 | 目的 |
|------|------|------|
| proxy.js | 删除 AGENTS.md 注入 | 和 Gateway 注入重复，省 token |
| chat-view.js | onDelta 全量→增量 | 修复流式渲染闪烁 |
| ws-bridge.js | 验证 chat 事件格式 | 确保与 Gateway 实际格式匹配 |
| 前端 | 子 agent 结果渲染 | 显示 sessions_spawn 返回的子 agent 回复 |

---

## 六、sessions_spawn 验证结果

### CLI/WebChat 场景（已跑通）
- 28 条记录：25 成功 / 3 失败
- 成功案例：咪蒙写文章、写诗等，requesterOrigin.channel = "webchat"
- 失败案例：2 个 EBADF 错误（jobs agent），1 个 lost active execution context

### Web UI 场景（未跑通）
- 0 条记录来自 Web UI
- 原因：前端直连子 agent HTTP，绕过主 agent

---

## 七、当前状态与下一步

### 当前阻塞
1. **OpenClaw Gateway 未运行** — 端口 18789 无进程监听
2. **WS chat 未端到端验证** — 所有 WS 相关改动尚未经过实际测试
3. **chat 事件格式未确认** — ws-bridge.js 解析逻辑基于推测

### 下一步
1. 启动 OpenClaw Gateway（确认启动方式）
2. 端到端测试 WS chat（主 agent 对话 + 流式渲染）
3. 抓包确认 Gateway chat 事件格式，修正 ws-bridge.js
4. 测试即时指派模式（@子agent → sessions_spawn → 子 agent 回复渲染）
5. 测试独立交互模式（直连子 agent 对话）
6. 实现后台委托模式

---

## 八、关键文件索引

| 文件 | 职责 |
|------|------|
| server.js | HTTP 服务器，API 路由，SSE 事件转发 |
| proxy.js | Gateway API 代理，AGENTS.md 注入 |
| ws-client.js | Gateway WebSocket 客户端 |
| ws-bridge.js | 前端 WS 事件处理桥接 |
| api.js | 前端 API 层 |
| chat-view.js | 聊天消息发送主控 |
| mention-completer.js | @提及补全 |
| fs-store.js | 文件存储，syncTeamRoster/syncSubAgentRoster |
| agent-routes.js | Agent CRUD API |
| stream-renderer.js | 流式消息渲染 |

备份目录: _backup/20260526-220418（WS chat 迁移前最相关备份）

---

**文档结束**
