# 子 Agent 委托结果回传链路 —— 完整技术记录

> 日期：2026-05-27  
> 版本：OpenClaw Gateway 2026.5.19 + Web UI 独立外部代理  
> 状态：✅ 生产就绪  

---

## 一、问题定义

### 现象
用户在 Web UI 中说"让小李子去知乎搜一个 skill"，主 agent 回复"已派人去办"，随后发送按钮恢复正常，但**子 agent 的执行结果永不出现**。

### 核心矛盾
```
Gateway sessions_spawn 是异步的
  → 主 agent SSE 流在 spawn 后立即关闭（[DONE]）
  → 子 agent 执行完成 → Gateway 触发 announce 流程
  → announce 结果写入 Gateway session 文件 ✅
  → 但前端没有打开的 SSE 连接接收这个结果 ❌
```

### 验证数据（trajectory 日志铁证）

```
2026-05-27T03:04 UTC  主 agent SSE: "好的，给小李子下令" → [DONE] → SSE 关闭
2026-05-27T03:05 UTC  announce 启动:
  runId = announce:v1:agent:agent-mpm470b4rlng:subagent:xxx
  assistantTexts = [
    "小李子回来了，搜到了 5 条结果…",
    "推荐度最高的是一条 18 赞的完整自动化流程…"
  ]
  finalStatus = success

→ 结果已在 Gateway 文件里，但前端无通道接收！
```

---

## 二、根因分析：三层检测全断

### 尝试 1：SSE stream delta 中的 tool_call 检测

```
期望: api.js 解析 delta.tool_calls → onToolCall("sessions_spawn") → SubagentCard.create()
实际: deepseek-v4-flash 的 tool_call delta 格式与前端解析不兼容，从未触发
```

**失败原因：** Gateway/模型组合的 SSE 流中不暴露 `sessions_spawn` 的 tool_call delta（Gateway 内部处理）。

### 尝试 2：Gateway WebSocket 事件监听

```
期望: wsClient.on('event') → 检测 sessions.changed → 触发同步
实际: Gateway 发的字段名是 payload.phase = "end"，代码里匹配的是 payload.reason
```

**失败原因：** 字段名不匹配（`phase` vs `reason`），一行代码的问题，但暴露了依赖 Gateway WS 事件格式的风险。

### 尝试 3：post-stream 消息计数增长检测

```
期望: SSE [DONE] → 记录 baseline → 每 3s 检查 → count > baseline → 发现新消息
实际: announce 太快，第一轮 poll 时 announce 已完成 → baseline 已含 announce → 之后无增长
```

**失败原因：** 时序竞争（race condition）—— baseline 在 announce 之后建立，检测不到变化。

### 结论

| 检测机制 | 依赖 | 可靠性 |
|---------|------|:---:|
| SSE tool_call delta | Gateway 内行为 | ❌ 不可控 |
| Gateway WS 事件字段 | 事件格式契约 | ❌ 字段不稳定 |
| 消息计数增长 | 时序窗口 | ❌ announce 太快 |

**根本教训：任何依赖"恰好赶上某个时机"的检测方案，都不可靠。**

---

## 三、最终方案：Sync 模式（文件对账）

### 设计哲学

> **不检测 spawn 是否发生，不追 announce 何时到达——只做一件事：保持两份数据一致。**
>
> Web UI session 的消息列表 ↔ Gateway session 的消息列表。

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (Browser)                        │
│                                                             │
│  WsBridge ── listen('chat-sync') ──→ 去重 ──→ 追加消息      │
│                                          ──→ 卡片 ✓/消失    │
│                                                             │
│  chat-view.js                                               │
│    onDone → _postStreamSyncCheck                            │
│       ① 创建 🔄 子任务 卡片                                  │
│       ② POST /api/sessions/sync-start                       │
└────────────────────────┬────────────────────────────────────┘
                         │ SSE: chat-sync
┌────────────────────────┴────────────────────────────────────┐
│                      server.js                              │
│                                                             │
│  _startSessionSync()                                        │
│    ├─ baseline = _countGatewayAssistantMessages()           │
│    └─ setInterval(_doSessionSync, 5000)                     │
│                                                             │
│  _doSessionSync()                                           │
│    ├─ count = _readGatewayAssistantMessages().length        │
│    ├─ if count <= baseline → idleRounds++ → 超时停止         │
│    └─ if count > baseline →                                │
│        ① newMessages = allMessages.slice(baseline)          │
│        ② _broadcastSSE({ type: 'chat-sync', messages })     │
│        ③ baseline = count                                   │
│                                                             │
│  _readGatewayAssistantMessages()                            │
│    ├─ 定位: $OPENCLAW_STATE_DIR/agents/main/sessions/       │
│    ├─ 跳过: trajectory.jsonl 文件                            │
│    ├─ 跳过: 心跳文件（内容含 HEARTBEAT 但无 agent:... 引用）   │
│    ├─ 选择: 最新真实对话 jsonl                                │
│    └─ 解析: type=message + role=assistant → 过滤 HEARTBEAT_OK│
│                                                             │
│  Gateway WS Event → _onSubagentGatewayEvent                 │
│    └─ sessions.changed + phase=end → _startSessionSync()     │
│       （作为加速器，在检测到 announce 完成时立即启动同步）      │
└─────────────────────────────────────────────────────────────┘
```

### Sync 循环参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `SYNC_INTERVAL_MS` | 5000 | 检查间隔 |
| `SYNC_MAX_IDLE_ROUNDS` | 24 | 2分钟无变化自动停止 |
| 启动方式 1 | 前端 `POST /api/sessions/sync-start` | 每条消息发送后触发 |
| 启动方式 2 | Gateway WS `sessions.changed(end)` | 事件加速器 |

---

## 四、改动文件清单

### 4.1 server.js

| 新增函数 | 职责 |
|---------|------|
| `_startSessionSync()` | 启动 Sync 循环，记录基线 |
| `_doSessionSync()` | 每 5s 检查一次消息数，有增长则广播 |
| `_stopSessionSync()` | 停止循环（2 分钟无变化自动调） |
| `_handleSyncStart(body, res)` | 新路由 handler |
| `_readGatewayAssistantMessages()` | 读 Gateway session JSONL，过滤心跳，返回消息列表 |
| `_countGatewayAssistantMessages()` | 返回消息数（轻量版，不做完整解析） |

| 修改函数 | 变更 |
|---------|------|
| `_onSubagentGatewayEvent` | 从多方字段匹配简化为仅匹配 `phase=end` |
| `handleSessionSync` | 从 RPC+sessions.history 改为直接调 `_readGatewayAssistantMessages` |

| 删除代码 | 原因 |
|---------|------|
| `_trySyncAndBroadcast` | RPC 依赖 Gateway 不可靠 |
| `_extractSessionMessages` | 不复用 |
| `_readGatewaySessionMessages`（旧版 80 行） | 被新版 `_readGatewayAssistantMessages` 替代 |

| 新增路由 | 方法 | 路径 |
|---------|------|------|
| sync-start | POST | `/api/sessions/sync-start` |

### 4.2 web/js/api.js

| 新增方法 | 说明 |
|---------|------|
| `Api.startSync()` | POST `/api/sessions/sync-start`，触发服务端 Sync 循环 |

### 4.3 web/js/components/chat-view.js

| 变更 | 说明 |
|------|------|
| `_postStreamSyncCheck` | 从 60 行（基线检测+去重+定时）简化为 15 行：创建卡片 + 调 `Api.startSync()` |

### 4.4 web/js/controllers/ws-bridge.js

| 新增 | 说明 |
|------|------|
| SSE 监听 `chat-sync` | 收到新消息 → 去重 → 追加到聊天 |
| `_handleChatSync(data)` | 追加消息 + 卡片完成/消失 + 兜底创建（如果还没有卡片） |
| `_addedMsgFingerprints` | 消息去重集合（sha256 风格：前 100 字符去空白） |

### 4.5 web/js/components/subagent-card.js

| 变更 | 说明 |
|------|------|
| **删除** `_startPolling`、`_stopPolling`、`_updateProgress`、`_onSubagentDone`、`_removeFromState` | 卡片不再主动轮询，转为纯被动展示 |
| **保留** `create`、`_markCompleted`、`_markStopped`、`_fadeOutCard` | 纯展示+淡出 |
| CSS `subagent-card-mini` | 紧凑双行布局 |

### 4.6 web/css/style.css

| 新增 | 说明 |
|------|------|
| `.subagent-card-mini .subagent-card-inner` | 紧凑内边距 5px 10px |
| `.subagent-text` | 柔性列布局 |
| `.subagent-label` / `.subagent-detail` | 双行文字样式 |
| transition + fadeOut | 平滑消失动画 |

---

## 五、数据流完整时序

```
t0    用户发送消息
t1    API.chat() → POST /v1/chat/completions → SSE stream
t2    模型回复 "已派人去办" → [DONE]
t3    onDone → _postStreamSyncCheck:
      ① 找到最后一个 assistant 气泡
      ② SubagentCard.create({ anchorEl }) → 卡片出现在对话中
      ③ setTimeout(1s) → Api.startSync()
t4    server _startSessionSync → baseline = 39
      setInterval(每5秒) → _doSessionSync

─── 子 agent 在后台执行中 ───

t5    Gateway 写入 announce 结果 → session 文件更新
t6    _doSessionSync: _readGatewayAssistantMessages().length = 40
      40 > 39 → 检测到增长！
      newMessages = allMessages[39..40] = ["小李子搜完了，结果如下：…"]
      _broadcastSSE({ type: 'chat-sync', messages: newMessages })

t7    前端 WsBridge 收到 'chat-sync' SSE 事件
      _handleChatSync:
      ├─ 去重（指纹比对 _addedMsgFingerprints）
      ├─ MessageRenderer.appendMessage × N
      ├─ SubagentCard._markCompleted → ✓ → 3s 淡出消失
      └─ scrollToBottom

t8    2 分钟无新变化 → _stopSessionSync（循环自动停止）
```

---

## 六、踩坑总结

### 坑 1：依赖 SSE stream 内的 tool_call delta
> Gateway/deepseek-v4-flash 组合不在 SSE 流中暴露 sessions_spawn 的 tool_call。  
> **教训：不要假设模型一定会以标准 OpenAI tool_calls 格式输出。Gateway 可能内部处理。**

### 坑 2：依赖 Gateway WebSocket 事件字段名
> `payload.reason` vs `payload.phase` —— 字段命名不一致。  
> **教训：不应依赖 Gateway 事件 payload 的具体字段格式，除非官方文档承诺稳定性。**

### 坑 3：消息计数基线在 announce 之后建立
> 时序竞争导致 baseline 已含 announce 结果，后续无"增长"可检测。  
> **教训：不应依赖"变化检测"来处理可能先于检测完成的异步操作。**

### 坑 4：Gateway sessions.history RPC 不可用
> `unknown method: sessions.history` —— Gateway 不支持此 RPC。  
> **教训：RPC 接口不是 REST API，不同 Gateway 版本可用方法不同。文件读取是唯一确定可用的兜底方案。**

### 坑 5：心跳文件污染
> Gateway 为心跳维护单独的 session 文件，包含大量 `HEARTBEAT_OK` 消息。  
> **教训：文件选择需做内容检测，不能仅靠修改时间。**

### 坑 6：SubagentCard 轮询依赖 Gateway RPC
> `/api/subagent/status` 代理到 Gateway 的 `sessions.list` RPC，返回 500 错误。  
> **教训：前端不应依赖 Gateway 的内部 RPC 来做状态检查。**

### 坑 7：卡片的轮询生命周期过早结束
> `_postStreamSyncCheck` 之前用 `maxAttempts=6`（18s），而子 agent 可能需要更长时间。  
> **教训：同步循环应作为长期运行的独立进程，由服务端管理，不依赖前端定时器。**

### 坑 8：删除轮询方法时遗留引用
> `_markStopped` 和 `_markCompleted` 仍引用已删除的 `_stopPolling` 和 `_removeFromState`。  
> **教训：重构时需全量搜索被删除方法的引用，不能仅靠 grep 文件名。**

---

## 七、进一步优化方向

### 7.1 技术层面

#### 7.1.1 通信通道统一
**现状：** 前端与 Gateway 之间有三条通道（SSE/非流式、WebSocket→SSE 转发、Gateway WS 事件→SSE），三条通道的边界不清晰。

**优化：** 将 Web UI 的核心通信统一到 **单一 SSE 连接**上，所有事件（chat delta、tool call、subagent progress、session change）都通过同一个 EventSource 推送。

```
// 理想架构
EventSource('/api/events')
  .on('chat')        → delta/thinking/done/error
  .on('subagent')    → spawn/progress/complete/error
  .on('session')     → created/updated/deleted
  .on('gateway')     → health/pairing/config-change
```

> 实现依赖：ws-client.js 已有的 `sessions.subscribe` 能接收 Gateway 实推事件，server.js 只需统一广播到同一个 SSE 通道。

#### 7.1.2 服务端 Sync 循环改为事件驱动
**现状：** Sync 默认 5 秒间隔轮询，空闲时浪费 CPU。

**优化：** 利用 `fs.watch` 监听 Gateway session 目录的文件变更事件，只在有新写入时才执行同步。

```
// 伪代码
fs.watch(sessionsDir, (eventType, filename) => {
  if (eventType === 'change' && filename.endsWith('.jsonl')) {
    debounceSync(); // 防抖 500ms
  }
});
```

> 顾虑：Windows 上 `fs.watch` 稳定性，需 fallback 到轮询。

#### 7.1.3 读 Gateway 文件时做增量读取
**现状：** 每次 Sync 检查都全量读 Gateway session JSONL（可能有几百 KB）。

**优化：** 服务端维护文件偏移量，每次只读增量行。

```javascript
_sessionFileOffset = {}; // key: fileName, value: lastByteOffset

function readLinesSinceOffset(filePath) {
  const stat = fs.statSync(filePath);
  const lastOffset = _sessionFileOffset[filePath] || 0;
  if (stat.size <= lastOffset) return [];
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buf, 0, stat.size - lastOffset, lastOffset);
  _sessionFileOffset[filePath] = stat.size;
  // 解析新增行...
}
```

### 7.2 逻辑层面

#### 7.2.1 消息去重统一到一个模块
**现状：** 去重逻辑分散在 3 个地方——WsBridge（`_makeFingerprint`）、subagent-card（`_subagentMsgFingerprint`）、chat-view（内联代码）。

**优化：** 提取到共享模块。

```javascript
// web/js/utils/dedup.js
var Dedup = {
  _seen: {},
  isDuplicate: function (content) {
    var fp = (content || '').slice(0, 100).replace(/\s/g, '');
    if (this._seen[fp]) return true;
    this._seen[fp] = true;
    return false;
  },
  reset: function () { this._seen = {}; }
};
```

#### 7.2.2 SubAgent 卡片统一生命周期管理
**现状：** 卡片创建在 3 个地方——chat-view（onToolCall）、chat-view（_postStreamSyncCheck）、ws-bridge（_handleChatSync）。

**优化：** 封装到 `SubAgentLifecycle` 模块，提供统一接口。

```javascript
var SubAgentLifecycle = {
  isActive: function () { /* 是否有进行中的子 agent */ },
  show: function (anchorEl, info) { /* 创建或更新卡片 */ },
  dismiss: function () { /* 完成/消失 */ },
  update: function (text) { /* 更新进度文字 */ },
};
```

#### 7.2.3 server.js 函数提取到独立模块
**现状：** server.js 超过 700 行，Sync 相关约 100 行内联。

**优化：** 提取到 `session-sync.js`。

```
server.js (路由 + HTTP + 工具)
session-sync.js (Sync 循环 + Gateway 文件读取)
agent-routes.js (Agent 管理)
proxy.js (Gateway 代理)
ws-client.js (WebSocket 客户端)
```

### 7.3 代码质量层面

#### 7.3.1 硬编码消除
**现状：** `'agent:main:webui'`、`'D:\AppData\openclaw'` 等路径硬编码在多处。

**优化：** 统一为配置常量或环境变量。

```javascript
var GATEWAY_STATE_DIR = process.env.OPENCLAW_STATE_DIR;
var GATEWAY_MAIN_SESSION = 'agent:main:webui';
var SESSIONS_SUBDIR = path.join('agents', 'main', 'sessions');
```

#### 7.3.2 错误处理统一
**现状：** 大量 `try {} catch (e) {}` 空块，错误被静默吞掉。

**优化：** 统一错误日志。

```javascript
function safeLog(prefix, fn) {
  try { return fn(); } catch (e) {
    console.error('[Sync] ' + prefix + ': ' + e.message);
    return null;
  }
}
```

---

## 八、关键配置参数速查

| 参数 | 位置 | 默认值 | 说明 |
|------|------|--------|------|
| Gateway 端口 | openclaw.json → gateway.port | 18789 | WebSocket + HTTP |
| Gateway token | openclaw.json → gateway.auth.token | hermes-local-dev | 认证 |
| Gateway state 目录 | 环境变量 `OPENCLAW_STATE_DIR` | `D:\AppData\openclaw` | Session 文件路径 |
| 主 agent session key | 硬编码 | `agent:main:webui` | Sync 读取目标 |
| Sync 间隔 | server.js `SYNC_INTERVAL_MS` | 5000 | 毫秒 |
| Sync 超时 | server.js `SYNC_MAX_IDLE_ROUNDS` | 24 | 24×5s=120s |
| 子 agent 超时 | openclaw.json → agents.list[main].subagents.runTimeoutSeconds | 120 | 秒 |
| 委托模式 | openclaw.json → agents.list[main].subagents.delegationMode | prefer | prefer/require |
| 主 agent 模型 | openclaw.json → agents.list[main].model.primary | deepseek/deepseek-v4-flash | 影响 spawn 可靠性 |

---

## 九、复现与测试

### 向后端发送委托请求
```
POST /v1/chat/completions
Headers:
  Content-Type: application/json
  x-openclaw-agent-id: main
  x-openclaw-session-key: agent:main:webui
Body:
  { "model": "openclaw:main", "messages": [{ "role": "user", "content": "让小李子去知乎搜一条 skill" }] }
```

### 启动 Sync 循环
```
POST /api/sessions/sync-start
Body: {}
Response: { "success": true, "baseline": 39 }
```

### 查询当前消息列表
```
GET /api/sessions/<sessionId>/sync
Response: { "success": true, "messages": [...] }
```

### 监控日志关键字
```
server console:
  [Sync] Loop started, baseline=XX
  [Sync] Loop stopped
Gateway trajectory:
  announce:v1:agent:agent-xxx:subagent:xxx
  assistantTexts: ["小李子搜完了…"]
  finalStatus: success
```

---

## 十、一句话总结

> **不要试图在错误的地方找正确的答案——文件系统是唯一确定的数据源，Sync 是唯一确定的同步策略。**
