# 委托模式重构 — 改动文档

> 日期：2026-05-26  
> 目标：将原 4 模式架构重构为 2+1 架构，打通主 agent 调子 agent 的完整链路

---

## 一、背景与问题

### 原架构的 4 种模式

| 模式 | 定义 | 问题 |
|---|---|---|
| 即时指派 | 用户直接调子 agent，等完成再继续 | 和后台委托底层机制相同，拆分无意义 |
| 后台委托 | 主 agent 异步调度子 agent | `sessions_spawn` 异步结果经 WS 回传，前端不处理，**结果丢失** |
| 智能调度 | 主 agent 按任务类型自主选子 agent | 不是独立模式，是主 agent 的能力 |
| 独立交互 | 单独和子 agent 对话 | 唯一合理的独立路径 |

### 3 个核心断点

1. **消息路径不对**：委托消息走 HTTP `/v1/chat/completions`，一次性 SSE 流，等不到 `sessions_spawn` 的异步结果
2. **前端不处理 subagent 事件**：`ws-bridge.js` 的 `_handleGatewayEvent` 只做 `console.log`，没有业务逻辑
3. **token 浪费**：`proxy.js` 重复注入 AGENTS.md 为 system message，Gateway 已原生加载

---

## 二、新架构：2+1

### 2 个交互模式

| 模式 | 路径 | 触发方式 |
|---|---|---|
| **委托对话** | HTTP `/v1/chat/completions` → 主 agent session → 可能调 `sessions_spawn` | 在主会话里输入任何消息（含 @mention） |
| **直连对话** | HTTP `/v1/chat/completions` + `x-openclaw-agent-id` → 子 agent session | 点击左侧子 agent 进入独立会话 |

### 1 个 agent 能力

| 能力 | 驱动方式 | 说明 |
|---|---|---|
| **智能调度** | AGENTS.md 规则 | 主 agent 自主判断何时委托、委托给谁，不需要 UI 路由 |

### @mention 语义变更

| 维度 | 改动前 | 改动后 |
|---|---|---|
| 含义 | 前端路由指令 → 直接调子 agent HTTP API | 纯文本 → 主 agent 看到后自主调 `sessions_spawn` |
| 实现 | `pendingDelegation` state + 委托标签 UI | 文本插入输入框，无额外 UI |

---

## 三、改动清单

### 3.1 proxy.js — 删除冗余 AGENTS.md 注入

**文件**：`proxy.js`（项目根目录）

**改动**：
- 删除 `_injectSystemMessage()` 函数（~20 行）
- 删除 `const path = require('path');` 引用
- `proxyRequest()` 简化为直接转发，不再判断 agentId 注入逻辑

**原因**：Gateway 收到 `x-openclaw-agent-id` 请求时，原生加载该 agent 的完整上下文（AGENTS.md、SOUL.md、workspace 文件），proxy 层再做一遍是冗余注入，浪费 ~500-2000 token/次。

**改动前**：
```js
function proxyRequest(req, res, raw) {
  const agentId = req.headers['x-openclaw-agent-id'] || '';
  if (agentId && parsed.pathname === '/v1/chat/completions' && req.method === 'POST') {
    _injectSystemMessage(agentId, raw, function (modifiedRaw) {
      _forwardRequest(req, res, modifiedRaw, parsed);
    });
    return;
  }
  _forwardRequest(req, res, raw, parsed);
}
```

**改动后**：
```js
function proxyRequest(req, res, raw) {
  const parsed = new URL(req.url, 'http://localhost');
  // Gateway handles agent context natively. No need to inject here.
  _forwardRequest(req, res, raw, parsed);
}
```

---

### 3.2 mention-completer.js — @mention 变纯文本

**文件**：`web/js/ui/mention-completer.js`

**改动**：
- `_applyMention()`：不再设置 `State.pendingDelegation`，改为将 `@agentName` 文本插入输入框
- 删除 `showDelegateBadge()` 函数（~20 行）
- 保留 `cancelDelegateMode()` 用于清理遗留状态

**改动前**：选择 agent 后 → 设置 `pendingDelegation` state → 显示委托标签 → 发送时从 state 取 agentId

**改动后**：选择 agent 后 → 在输入框插入 `@咪蒙 ` → 用户继续输入请求 → 整段文本原样发给主 agent

**改动前**：
```js
function _applyMention(input, atPos, agentId, agentName) {
  const val = input.value;
  const after = val.substring(input.selectionStart);
  const before = val.substring(0, atPos).trimEnd();
  input.value = before + (after ? ' ' + after : '');
  input.focus();
  _hideMentionPopup();
  autoResize();
  State.setState({
    pendingDelegation: { agentId: agentId, agentName: agentName, mode: 'mention' }
  });
  showDelegateBadge(agentName, 'mention');
}
```

**改动后**：
```js
function _applyMention(input, atPos, agentId, agentName) {
  // Insert @agentName into the text — main agent sees it and delegates via sessions_spawn
  const val = input.value;
  const after = val.substring(input.selectionStart);
  const before = val.substring(0, atPos);
  const mention = '@' + agentName + ' ';
  input.value = before + mention + after;
  input.focus();
  const newPos = before.length + mention.length;
  input.setSelectionRange(newPos, newPos);
  _hideMentionPopup();
  autoResize();
}
```

---

### 3.3 chat-view.js — 移除 delegation 路由 + 增加委托渲染

**文件**：`web/js/components/chat-view.js`

#### 3.3.1 sendMessage() 简化

**改动**：
- agentId 仅从 `State.currentAgent` 取（直连模式专用），不再从 `pendingDelegation` 取值
- 删除 `cancelDelegateMode()` 调用
- 删除 `isDirectChat` 变量
- 删除 delegation 相关的 displayText 拼接（不再自动加 `@agentName` 前缀）

**改动前**：
```js
const delegation = State.pendingDelegation || null;
let agentId = delegation ? delegation.agentId : (State.currentAgent || '');
// ...
if (delegation && delegation.agentName) {
  displayText = '@' + delegation.agentName + ' ' + text;
}
// ...
cancelDelegateMode();
var isDirectChat = !!agentId;
```

**改动后**：
```js
// Agent ID comes only from currentAgent (Direct Chat mode).
// @mention is now just text in the message — main agent handles delegation.
let agentId = State.currentAgent || '';
```

#### 3.3.2 新增委托渲染方法

**新增属性**：
```js
_pendingDelegations: {},  // runId → DOM element
```

**新增方法 1**：`showDelegationPending(agentId, agentName, runId)`
- 创建一个带 spinner 的等待卡片，显示 "🔄 正在处理中…"
- 卡片带有 agent 头像、名称、颜色
- 以 `runId` 为 key 存入 `_pendingDelegations` 字典，供后续替换
- 调用时机：收到 `subagent.spawn` 事件

**新增方法 2**：`appendDelegationResult(payload)`
- 接收 payload：`{ childRunId, frozenResultText, agentId, task, outcome }`
- 如果 `_pendingDelegations[runId]` 存在，替换等待卡片内容为实际结果
- 如果不存在，作为新的 assistant 消息追加
- 错误结果（`outcome === 'error'`）显示错误样式
- 调用时机：收到 `subagent.complete` / `subagent.error` 事件

---

### 3.4 ws-bridge.js — 注册 sub-agent 事件监听

**文件**：`web/js/controllers/ws-bridge.js`

**改动**：
- `init()` 中增加 `this._bindDelegationEvents()` 调用
- 新增 `_bindDelegationEvents()` 方法

**注册的事件**：

| 事件名 | 处理 | 调用方法 |
|---|---|---|
| `subagent.spawn` | 子 agent 被创建 | `ChatView.showDelegationPending()` |
| `subagent.complete` | 子 agent 正常完成 | `ChatView.appendDelegationResult()` |
| `subagent.error` | 子 agent 执行出错 | `ChatView.appendDelegationResult({ outcome: 'error' })` |
| `*`（通配符） | 兼容不同版本的事件名 | 模糊匹配 `subagent`/`spawn`/`complete`/`done` 等关键词 |

**通配符匹配逻辑**（防御性编程）：
```
事件名包含 'subagent' 或 'sub-agent' 或 'spawn'
  → 包含 'complete'/'done'/'finish' → appendDelegationResult()
  → 包含 'spawn'/'start'/'create'   → showDelegationPending()
```

**payload 字段兼容**：
- `agentId` / `childAgentId` → agent 标识
- `runId` / `childRunId` → run 标识，用于匹配等待卡片
- `frozenResultText` / `resultText` → 子 agent 回复内容
- `outcome` → 'ok' 或 'error'

---

### 3.5 style.css — 委托等待状态样式

**文件**：`web/css/style.css`

**新增样式**（插入在"独立 Agent 模式顶栏"注释前）：

```css
.delegation-pending {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  color: var(--text-2);
  background: linear-gradient(135deg, #FBF5EF, #FDF6F0);
  border-radius: var(--radius-md);
  border: 1px solid #E0D5C8;
}
.delegation-spinner {
  display: inline-block;
  width: 18px; height: 18px;
  border: 2px solid #E0D5C8;
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: delegation-spin 0.8s linear infinite;
}
@keyframes delegation-spin {
  to { transform: rotate(360deg); }
}
```

---

### 3.6 state.js — 清理注释

**文件**：`web/js/state.js`

**改动**：`pendingDelegation` 字段保留但标注不再用于路由：
```js
pendingDelegation: null,  // kept for backward compat, no longer used for routing
```

---

## 四、未改动文件

| 文件 | 原因 |
|---|---|
| `server.js` | WS 转发逻辑不变，无需改动 |
| `ws-client.js` | 事件接收逻辑不变，无需改动 |
| `api.js` | `Api.chat()` 和 `Api.chatSend()` 保持不变 |
| `fs-store.js` | `syncTeamRoster()` 继续维护 AGENTS.md 的子 agent 列表 |
| `session-manager.js` | `selectAgent()` 继续用于直连模式 |
| `event-router.js` | 事件绑定不变 |
| `message-builder.js` | 消息构建逻辑不变 |
| `message-renderer.js` | 渲染逻辑不变 |

---

## 五、数据流图

### 委托对话（主会话 + @mention）

```
用户输入 "@咪蒙 写首诗"
  → Api.chat(messages, '')          // agentId 为空，发给主 agent
  → HTTP POST /v1/chat/completions  // 无 x-openclaw-agent-id 头
  → Gateway → 主 agent session
  → 主 agent 调 sessions_spawn({ agentId: 'agent-mpls0tivyzea', task: '写首诗' })
  → SSE 返回: "已将任务委托给咪蒙"
  → WS 事件: subagent.spawn → ChatView.showDelegationPending('agent-mpls0tivyzea', '咪蒙', runId)
  → [子 agent 异步执行...]
  → WS 事件: subagent.complete → ChatView.appendDelegationResult({ childRunId, frozenResultText, ... })
  → 等待卡片替换为咪蒙的诗
```

### 直连对话（子 agent 独立会话）

```
用户点击左侧 "咪蒙" → SessionManager.selectAgent('agent-mpls0tivyzea')
  → State.currentAgent = 'agent-mpls0tivyzea'
  → 用户输入 "写首诗"
  → Api.chat(messages, 'agent-mpls0tivyzea')
  → HTTP POST /v1/chat/completions + x-openclaw-agent-id: agent-mpls0tivyzea
  → Gateway → 咪蒙 agent session（独立 session、独立记忆）
  → SSE 流式返回咪蒙的回复
```

---

## 六、待验证事项

1. **Gateway 事件名**：OpenClaw 发送的 sub-agent 事件实际名称可能不是 `subagent.spawn` / `subagent.complete`，需在浏览器控制台查看 `[WsBridge] Gateway event:` 日志确认
2. **Payload 字段**：`childRunId`、`frozenResultText` 等字段名需实测确认
3. **主 agent HTTP 路径下的 sessions_spawn**：需验证通过 `/v1/chat/completions` 请求主 agent 时，它是否真的能调 `sessions_spawn` 工具（CLI/WebChat 场景已验证可用）
4. **AGENTS.md 同步**：`fs-store.js` 的 `syncTeamRoster()` 仍会往主 agent 的 AGENTS.md 写入 Sub-Agents 段落和 @Mention Handling Rules，确保这些规则引导主 agent 使用 `sessions_spawn`
