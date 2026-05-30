# 智能调度子 Agent 进度显示 — 技术实现与踩坑记录

> 本文档记录虾指挥 Web UI 中「智能调度模式下子 Agent 执行进度实时显示」功能的完整技术实现，包括根因分析、修复过程、事件链路、踩坑经验。
> 目的：防止未来代码改动破坏此功能，便于他人复现或优化。

---

## 一、功能概述

**需求**：智能调度（dispatch）模式下，主 Agent 通过 `sessions_spawn` 分配子 Agent 任务后，用户需要看到子 Agent 的实时执行状态（正在调用什么工具），而非面对一片空白等待。

**实现效果**：
- 气泡内显示子 Agent 进度块：`[旋转图标] 小周 正在执行 · exec`
- 子 Agent 完成后进度块变为：`[勾号] 小周 已完成`
- 输入框上方显示调度状态栏：`[旋转图标] 智能调度中… 小周(执行中)`
- 所有子 Agent 完成后状态栏淡出，发送按钮恢复

---

## 二、架构总览

```
Gateway WS                    server.js                    前端
───────────                  ──────────                   ──────
{type:"event",               wsClient.emitter.on('event')  ws-bridge.js
 event:"session.tool",  ───►  → data.payload.data.phase   → subagent-progress SSE
 payload:{sessionKey,         → data.payload.sessionKey      → chat-controller.js
          data:{phase,name}}}                                   → message-renderer.js
```

**关键数据流**：

1. Gateway WS 推送 `{type:"event", event, payload}` 格式的事件
2. `ws-client.js` 解析 WS 消息，`emitter.emit('event', data)` 广播原始对象
3. `server.js` 监听事件，从 `data.payload` 提取子 Agent 信息，广播 SSE 事件
4. `ws-bridge.js` 监听 SSE 事件，调用 `ChatController` 对应方法
5. `ChatController` 更新状态，调用 `MessageRenderer` 渲染进度块

---

## 三、根因分析 — 为什么之前一直不工作

### 3.1 核心错误：WS 事件结构误读

**OpenClaw Gateway WS 事件的实际结构**（官方架构文档确认）：

```json
{
  "type": "event",
  "event": "session.tool",
  "payload": {
    "sessionKey": "agent:agent-mpr5t5r2vi0e:subagent:xxx",
    "data": {
      "phase": "start",
      "name": "exec"
    },
    "runId": "...",
    "stream": "tool"
  }
}
```

**之前代码错误地查找的路径**：

| 代码查找的路径 | 实际数据位置 | 结果 |
|---|---|---|
| `payload.sessionKey` | `data.payload.sessionKey` | ❌ 顶层无 sessionKey，得到空字符串 |
| `payload.data` | `data.payload` | ❌ 顶层无 data 字段，得到 undefined |
| `payload.data` → JSON.parse → `d.payload` | 直接就是 `data.payload` | ❌ 多余的嵌套解析 |

**根因**：代码把 `debugTrace.trace` 日志中的 `data` 字段（实际是 `JSON.stringify(payload)` 的输出）误认为是 WS 事件的 `data` 字段，写出了完全错误的嵌套解析逻辑。`payload.data` 在顶层根本不存在，导致所有子 Agent 进度事件从未被识别和广播。

### 3.2 错误的嵌套解析逻辑（修复前）

```javascript
// ❌ 错误：假设 payload.data 存在且是 JSON 字符串
const payload = data;  // 把整个 data 对象当作 payload
const sessionKey = payload.sessionKey || '';  // 顶层无 sessionKey，永远为空
let d = payload.data || {};  // 顶层无 data，得到 {}
if (typeof d === 'string') { d = JSON.parse(d); }  // 永远不走这个分支
var innerP = d.payload || d;  // {} 的 payload 是 undefined，innerP = {}
// 后续所有从 innerP 提取信息的逻辑全部失效
```

### 3.3 正确的解析逻辑（修复后）

```javascript
// ✅ 正确：直接从 data.payload 取事件详情
const p = data.payload || {};
const sessionKey = p.sessionKey || '';
const toolData = p.data || {};
const isToolStart = toolData.phase === 'start' && toolData.name;
```

---

## 四、修复内容

### 4.1 server.js（L142-L175）

**修改前**：30 行错误的嵌套解析，`payload.data` → JSON.parse → `innerP` → `innerP.data`

**修改后**：直接用 `data.payload`，代码从 55 行缩减到 30 行

```javascript
wsClient.emitter.on('event', function (data) {
  sseManager.broadcast({ type: 'gateway', data: data });
  sessionSync.onSubagentGatewayEvent(data);
  const eventName = data.event || '';
  const p = data.payload || {};
  const sessionKey = p.sessionKey || '';

  // session.tool / agent 事件 → 子 Agent 工具调用进度
  if ((eventName === 'session.tool' || eventName === 'agent') && p) {
    const toolData = p.data || {};
    const isToolStart = toolData.phase === 'start' && toolData.name;
    let subAgentId = '';
    if (sessionKey.indexOf(':subagent:') >= 0) {
      subAgentId = sessionKey.split(':')[1] || '';
    }
    if (!subAgentId && p.spawnedBy) {
      const parts = p.spawnedBy.split(':');
      if (parts.length >= 2 && parts[1] !== 'main') subAgentId = parts[1];
    }
    if (isToolStart && subAgentId) {
      _broadcastSubagentProgress(subAgentId, toolData.name);
    }
    // sessions_spawn 特殊处理：主 Agent 调用 spawn 时，目标子 Agent 还没创建
    if (isToolStart && toolData.name === 'sessions_spawn') {
      let spawnAgentId = (toolData.args && toolData.args.agentId) || '';
      if (!spawnAgentId && toolData.meta) {
        var m = toolData.meta.match(/agent\s+(\S+)/);
        if (m) spawnAgentId = m[1];
      }
      if (spawnAgentId && spawnAgentId !== 'main') {
        _broadcastSubagentProgress(spawnAgentId, 'sessions_spawn');
      }
    }
  }

  // sessions.changed 事件 → 子 Agent 创建/完成
  if (eventName === 'sessions.changed') {
    if (sessionKey.indexOf(':subagent:') >= 0) {
      const agentId = sessionKey.split(':')[1] || '';
      const parentKey = p.spawnedBy || (p.session && p.session.spawnedBy) || '';
      const sessionId = _extractFrontendSessionId(parentKey);
      if (p.phase === 'start' || p.reason === 'create') {
        _broadcastSubagentProgress(agentId, '', sessionId);
      } else if (p.phase === 'end' || p.phase === 'error' || p.reason === 'delete') {
        _broadcastSubagentDone(agentId, sessionId);
      }
    }
  }
});
```

### 4.2 session-sync.js（L50-L76）

同样的修复：`payload.data` → `data.payload`，删除错误的嵌套解析。

### 4.3 前端文件（无需修改）

以下文件在之前的会话中已正确实现，本次修复不需要改动：

| 文件 | 职责 |
|---|---|
| `web/js/controllers/chat-controller.js` | 管理调度状态、进度块、announce 追加 |
| `web/js/controllers/ws-bridge.js` | SSE 事件监听，分发到 ChatController |
| `web/js/components/message-renderer.js` | 进度块 DOM 渲染（addProgressBlock / updateProgressBlock） |
| `web/js/views/app-view.js` | 调度状态栏 HTML |
| `web/js/state.js` | `dispatching` 状态字段 |
| `web/css/style.css` | 进度块、状态栏、极简黑白图标样式 |

---

## 五、完整事件链路

以一次典型的 dispatch 任务为例：

```
1. 用户发送消息 → Api.chat() → SSE 流式渲染主 Agent 回复

2. 主 Agent 调用 sessions_spawn
   → WS: {event:"session.tool", payload:{data:{phase:"start",name:"sessions_spawn"}}}
   → server.js 检测 sessions_spawn，广播 SSE: subagent-progress
   → 前端: handleSubagentProgress → 显示进度块 "小周 · sessions_spawn"

3. 子 Agent 创建
   → WS: {event:"sessions.changed", payload:{sessionKey:"agent:xxx:subagent:yyy", reason:"create"}}
   → server.js 广播 SSE: subagent-progress
   → 前端: handleSubagentProgress → 更新进度块

4. 子 Agent 执行工具
   → WS: {event:"session.tool", payload:{sessionKey:"agent:xxx:subagent:yyy", data:{phase:"start",name:"exec"}}}
   → server.js 广播 SSE: subagent-progress
   → 前端: handleSubagentProgress → 更新进度块 "小周 · exec"

5. 子 Agent 完成
   → WS: {event:"sessions.changed", payload:{sessionKey:"agent:xxx:subagent:yyy", phase:"end"}}
   → server.js 广播 SSE: subagent-done
   → 前端: handleSubagentDone → 进度块变为 "小周 已完成"

6. 主 Agent announce 回复
   → session-sync.js 检测到新消息 → 广播 SSE: announce-result
   → 前端: handleAnnounceResult → 追加内容到气泡内

7. 所有子 Agent 完成
   → ChatController._checkDispatchComplete → dispatching=false → 状态栏淡出 → 发送按钮恢复
```

---

## 六、踩坑记录

### 坑 1：WS 事件结构误读（本次根因）

- **现象**：`subagent-progress-broadcast` 从未出现在 debug 日志中
- **根因**：代码查找 `payload.data`（不存在），实际数据在 `data.payload`
- **教训**：**先看实际数据，再写解析代码**。用 debug 日志或 SSE 流监控确认 WS 事件的真实结构，不要凭文档或猜测写代码
- **验证方法**：`curl -s -N "http://localhost:3001/api/events"` 直接看 SSE 流中的 gateway 事件

### 坑 2：debug 日志的 data 字段造成误导

- **现象**：debug 日志中 `data` 字段看起来像嵌套 JSON，导致写出多层解析
- **根因**：`debugTrace.trace('gateway-event', { data: JSON.stringify(payload) })` 中的 `data` 是日志字段名，不是 WS 事件的 `data` 字段
- **教训**：日志字段命名不要和事件字段重名，避免混淆。修复后改为 `payloadKeys: Object.keys(p).join(',')`

### 坑 3：onDone 时序问题（之前会话）

- **现象**：主 Agent 流式结束后，send 按钮短暂恢复又禁用
- **根因**：`StreamRenderer.endStreaming()` 先执行（内部恢复按钮），然后才设 `dispatching=true`
- **修复**：先设 `dispatching=true`，再调 `endStreaming`；`_resetSendBtn` 中检查 `State.dispatching`

### 坑 4：handleSubagentProgress 没有检查 interactionMode

- **现象**：私聊模式下子 Agent 工具调用也会触发进度显示
- **修复**：加了 `if (State.interactionMode !== 'dispatch') return;`

### 坑 5：sessions.changed 的 phase 值不是 "start"

- **现象**：子 Agent 创建时 `sessions.changed` 的 `phase` 是 `"message"` 而非 `"start"`
- **修复**：同时检查 `p.reason === 'create'`；但主要依赖 `session.tool` 事件的 `phase:"start"` 来检测工具调用

### 坑 6：sessions_spawn 发生在主 Agent session 上

- **现象**：主 Agent 调用 `sessions_spawn` 时，`sessionKey` 是 `agent:main:webui:xxx`，不含 `:subagent:`，所以 `subAgentId` 提取不到
- **修复**：新增 `sessions_spawn` 专用检测，从 `toolData.args.agentId` 或 `toolData.meta` 提取目标子 Agent ID

---

## 七、关键文件索引

| 文件 | 修改内容 | 行号 |
|---|---|---|
| `server.js` | WS 事件解析修复 + sessions_spawn 检测 | L142-L175 |
| `session-sync.js` | WS 事件解析修复 | L50-L76 |
| `chat-controller.js` | 调度状态管理（之前会话已完成） | 全文 |
| `message-renderer.js` | 进度块渲染（之前会话已完成） | L384-L440 |
| `ws-bridge.js` | SSE 事件监听（之前会话已完成） | L105-L123 |
| `state.js` | dispatching 状态字段（之前会话已完成） | 多处 |
| `app-view.js` | 调度状态栏 HTML（之前会话已完成） | L48-L51 |
| `style.css` | 进度块 + 状态栏 + 极简图标样式（之前会话已完成） | L1034-L1133 |

---

## 八、验证方法

### 8.1 后端验证

```powershell
# 查看 debug 日志中是否有 subagent-progress-broadcast
Select-String -Path debug-events.log -Pattern "subagent-progress-broadcast" | Select-Object -Last 5
```

### 8.2 SSE 流验证

```powershell
# 直接监控 SSE 事件流
curl -s -N "http://localhost:3001/api/events"
```

应看到 `subagent-progress` 和 `subagent-done` 类型的 SSE 事件。

### 8.3 前端验证

1. 切换到智能调度模式
2. 发送一个需要 spawn 子 Agent 的任务
3. 观察：气泡内是否出现进度块（旋转图标 + Agent 名 + 工具名）
4. 观察：输入框上方是否出现调度状态栏
5. 观察：子 Agent 完成后进度块是否变为勾号
6. 观察：所有子 Agent 完成后状态栏是否淡出、发送按钮是否恢复

---

## 九、已知限制与未来优化

1. **主 Agent 在 announce 中重新 spawn 子 Agent**：新 spawn 不被 `dispatching` 状态跟踪，需要监听 announce 流中的 `sessions_spawn` 工具调用
2. **sessionId 为空时的路由**：`handleAnnounceResult` 中如果 `sessionId` 不匹配当前会话，内容会被路由到目标 session 的存储但不显示在当前页面
3. **子 Agent 嵌套 spawn**：如果子 Agent 自己再 spawn 子子 Agent，当前只跟踪第一层
4. **Agent 输出风格**：Agent 回复中的 emoji 符号（✅ 1️⃣ 等）是 AI 生成内容，非 UI 硬编码，如需调整需修改 AGENTS.md
