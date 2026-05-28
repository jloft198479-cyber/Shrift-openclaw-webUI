# OpenClaw Web UI 架构重构设计文档

> 日期：2026-05-28
> 版本：v1.0
> 状态：待确认

---

## 一、问题诊断

### 1.1 当前架构的核心病症

```
┌─────────────────────────────────────────────────────────────┐
│                        症状：语义混乱                          │
├─────────────────────────────────────────────────────────────┤
│ UI 显示 "委托给 小李子" → 实际行为是 "直接对话"               │
│ State.pendingDelegation → 实际不是委托，是 agent 切换         │
│ SubagentCard 生命周期 → 三个模块同时操作，状态竞争             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                        症状：通道竞争                          │
├─────────────────────────────────────────────────────────────┤
│ SSE 流 tool_calls → Gateway 不暴露，检测失败                  │
│ Gateway WS 事件 → 字段格式不稳定，时灵时不灵                   │
│ Sync 文件轮询 → 最可靠，但前端还有另外两个通道在抢活           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                        症状：状态分散                          │
├─────────────────────────────────────────────────────────────┤
│ State.activeSubagents → 数组，无持久化                        │
│ SubagentCard._cards → 对象，独立管理                          │
│ session-sync._syncParsedCount → 服务端闭包变量                │
│ WsBridge._spawnDetected → Set，临时状态                       │
│ 四个状态之间 → 无同步机制，各自为政                            │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 根因：三种模式边界模糊

当前代码试图同时支持三种模式，但它们的入口、状态管理、通信通道全部混在一起：

| 模式 | 期望行为 | 实际行为 | 差距 |
|------|---------|---------|------|
| 直接对话 | @mention → 切换 agent | @mention → 切换 agent | ✅ 符合 |
| 智能调度 | 消息给 main → main 判断派谁 | 消息给 main → main 自己回答 | ❌ 未接入 |
| 委托执行 | @mention → main 强制派谁 | 不存在这个行为 | ❌ 从未实现 |

**委托执行是一个"伪需求"**——它试图在前端强制实现智能调度，但：
- 调度决策应该由 main agent（LLM）做，不是前端做
- 强制路由引入了不必要的复杂度
- 语义上让用户困惑

---

## 二、新架构设计：两种模式，清晰边界

### 2.1 模式定义

```
┌─────────────────────────────────────────────────────────────┐
│                      模式一：直接对话                          │
│                    (Direct Conversation)                      │
├─────────────────────────────────────────────────────────────┤
│ 触发方式：                                                     │
│   - 用户 @mention 某个 agent                                   │
│   - 用户点击 sidebar 的 agent 头像                             │
│                                                               │
│ 行为：                                                         │
│   - 前端切换到该 agent 的会话上下文                             │
│   - 消息直接发给该 agent（x-openclaw-agent-id）                │
│   - 该 agent 直接回复用户                                      │
│                                                               │
│ 特点：                                                         │
│   - 一对一，无中间人                                           │
│   - 用户明确知道自己在跟谁聊                                   │
│   - 适合：深度交流、特定技能使用、调试                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      模式二：智能调度                          │
│                    (Smart Dispatch)                           │
├─────────────────────────────────────────────────────────────┤
│ 触发方式：                                                     │
│   - 用户直接输入消息（不 @mention）                            │
│   - 用户说 "帮我..." / "搜索..." / "写个..."                  │
│                                                               │
│ 行为：                                                         │
│   - 消息发给 main agent（虾指挥）                              │
│   - main agent 分析需求 → 判断是否需要派子 agent               │
│   - 如需：调用 sessions_spawn → 子 agent 执行 → announce 回传 │
│   - main agent 汇总结果 → 回复用户                             │
│                                                               │
│ 特点：                                                         │
│   - 用户不用知道该找谁                                         │
│   - main agent 自动分解任务、并行调度                          │
│   - 适合：复杂任务、多 agent 协作、用户不确定该找谁            │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 两种模式的数据流对比

```
【直接对话模式】

用户输入: "@小李子 知乎搜一下 Cursor"
  ↓
前端检测到 @mention → State.targetAgent = "小李子"
  ↓
用户点击发送
  ↓
Api.chat(messages, agentId="小李子")
  ↓
POST /v1/chat/completions + x-openclaw-agent-id: 小李子
  ↓
proxy.js 注入小李子的 AGENTS.md
  ↓
Gateway → 小李子 agent → 直接回复
  ↓
SSE 流 → 前端渲染
  ↓
用户看到小李子的回复

【智能调度模式】

用户输入: "帮我调研一下 AI 编程工具"
  ↓
前端无 @mention → State.targetAgent = null
  ↓
用户点击发送
  ↓
Api.chat(messages, agentId="main")  // 或空，默认走 main
  ↓
POST /v1/chat/completions + x-openclaw-agent-id: main
  ↓
proxy.js 注入 main 的 AGENTS.md（含 Sub-Agents 列表）
  ↓
Gateway → main agent（虾指挥）
  ↓
虾指挥分析："这活儿该小李子干"
  ↓
虾指挥调用 sessions_spawn(agentId="小李子", task="调研 AI 编程工具")
  ↓
Gateway 创建子会话 → 小李子执行
  ↓
小李子完成 → Gateway announce → 写入 main session 文件
  ↓
虾指挥收到 announce → 汇总 → 回复用户
  ↓
SSE 流 → 前端渲染
  ↓
用户看到虾指挥的汇总回复（含小李子的调研结果）
```

### 2.3 关键区别

| 维度 | 直接对话 | 智能调度 |
|------|---------|---------|
| 目标 agent | 用户明确指定 | main agent 自动判断 |
| 消息路由 | 直连子 agent | 先走 main，可能再派子 agent |
| 上下文隔离 | 子 agent 独立上下文 | main agent 统筹上下文 |
| 多 agent 协作 | 不支持（一对一） | 支持（main 可并行派多个） |
| 结果汇总 | 子 agent 直接回复 | main agent 汇总后回复 |
| 用户感知 | "我在跟小李子聊" | "我在跟虾指挥聊，它派了人" |

---

## 三、状态管理重构：单一真相源

### 3.1 当前状态的问题

```javascript
// State.js - 当前
activeSubagents: [],        // 子 agent 列表（前端）
pendingDelegation: null,    // 委托状态（语义错误）

// SubagentCard.js - 独立
_cards: {},                 // 卡片对象（独立管理）
_pollTimers: {},            // 轮询定时器

// session-sync.js - 服务端
_syncParsedCount: 0,        // 同步计数（闭包）
_syncFileOffset: 0,         // 文件偏移

// WsBridge.js - 独立
_spawnDetected: {},         // 已检测的 spawn
_listeners: {}              // 事件监听器
```

**四个地方存储子 agent 状态，互相同步 = 没有同步。**

### 3.2 新状态设计

```javascript
// State.js - 唯一状态管理中心
const State = {
  // === 会话状态 ===
  sessions: [],              // 会话列表
  currentSessionId: null,    // 当前会话 ID
  currentAgent: "",          // 当前对话的 agent（直接对话模式用）
  messages: [],              // 当前会话消息
  
  // === 连接状态 ===
  connected: false,          // Gateway 连接状态
  streaming: false,          // 是否正在流式输出
  
  // === Agent 状态 ===
  agents: [],                // agent 列表（来自 openclaw.json）
  skills: [],                // skill 列表
  models: [],                // 模型列表
  defaultModel: '',          // 默认模型
  
  // === 交互模式状态 ===
  interactionMode: 'smart',  // 'smart' | 'direct' | null
  targetAgent: null,         // 直接对话模式的目标 agent
  
  // === 子任务状态（智能调度模式用）===
  subtasks: {},              // { sessionKey: { agentId, status, task, startedAt } }
  
  // === UI 状态 ===
  userScrolledUp: false,
  editingAgent: null,
  activeModal: null,
  filter: "",
};
```

### 3.3 状态变更规则

```
┌─────────────────────────────────────────────────────────────┐
│                     状态变更契约                              │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. 任何状态变更必须通过 State.setState()                     │
│     → 触发对应事件 → 组件响应                                │
│                                                               │
│  2. 子任务状态（subtasks）只能通过 SubtaskManager 修改        │
│     → 禁止任何组件直接操作 State.subtasks                    │
│                                                               │
│  3. 组件只读 State，不直接写                                  │
│     → 写操作通过事件触发，由 Manager 处理                    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 3.4 SubtaskManager（新增模块）

```javascript
/**
 * SubtaskManager - 子任务生命周期管理（单一真相源）
 * 
 * 职责：
 *   1. 创建子任务记录
 *   2. 更新子任务状态（pending → running → completed | failed | stopped）
 *   3. 查询子任务状态
 *   4. 清理已完成的子任务
 * 
 * 原则：
 *   - 所有子任务状态变更必须经过此模块
 *   - 对外提供明确的 API，内部操作 State.subtasks
 *   - 不操作 DOM，只管理数据
 */
const SubtaskManager = {
  // 创建子任务
  create: function(sessionKey, agentId, task) {
    State.setState({
      subtasks: Object.assign({}, State.subtasks, {
        [sessionKey]: {
          agentId: agentId,
          task: task,
          status: 'pending',      // pending | running | completed | failed | stopped
          startedAt: Date.now(),
          completedAt: null,
          result: null,
        }
      })
    });
    State._emit('subtask-created', { sessionKey, agentId, task });
  },
  
  // 更新状态
  updateStatus: function(sessionKey, status, result) {
    const subtask = State.subtasks[sessionKey];
    if (!subtask) return;
    
    const updated = Object.assign({}, State.subtasks);
    updated[sessionKey] = Object.assign({}, subtask, {
      status: status,
      completedAt: status === 'completed' || status === 'failed' ? Date.now() : null,
      result: result || subtask.result,
    });
    
    State.setState({ subtasks: updated });
    State._emit('subtask-updated', { sessionKey, status, result });
  },
  
  // 获取进行中的子任务
  getActive: function() {
    const active = {};
    for (const key in State.subtasks) {
      if (['pending', 'running'].includes(State.subtasks[key].status)) {
        active[key] = State.subtasks[key];
      }
    }
    return active;
  },
  
  // 清理已完成的子任务（保留最近 10 个）
  cleanup: function() {
    const entries = Object.entries(State.subtasks)
      .filter(([_, v]) => v.status === 'completed' || v.status === 'failed' || v.status === 'stopped')
      .sort((a, b) => (b[1].completedAt || 0) - (a[1].completedAt || 0));
    
    if (entries.length <= 10) return;
    
    const toKeep = new Set(entries.slice(0, 10).map(([k]) => k));
    const cleaned = {};
    for (const key in State.subtasks) {
      if (State.subtasks[key].status === 'pending' || State.subtasks[key].status === 'running' || toKeep.has(key)) {
        cleaned[key] = State.subtasks[key];
      }
    }
    State.setState({ subtasks: cleaned });
  },
};
```

---

## 四、通信通道重构：统一事件流

### 4.1 当前通道的问题

```
┌─────────────────────────────────────────────────────────────┐
│                     当前：三条通道竞争                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  通道 1: SSE 流（/v1/chat/completions）                       │
│    → Api.chat() 消费                                          │
│    → 解析 delta.tool_calls → onToolCall                       │
│    → 问题：Gateway 不暴露 sessions_spawn 的 tool_call         │
│                                                               │
│  通道 2: Gateway WS → SSE /api/events                         │
│    → WsBridge 消费                                            │
│    → 解析 sessions.changed / chat 事件                        │
│    → 问题：字段格式不稳定，时灵时不灵                         │
│                                                               │
│  通道 3: Sync 文件轮询（session-sync.js）                     │
│    → 轮询 Gateway session 文件                                │
│    → SSE chat-sync 广播                                       │
│    → 问题：前端还有另外两个通道在抢活                         │
│                                                               │
│  结果：三个通道各自为政，SubagentCard 被重复创建/完成          │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 新设计：单一通道，分层消费

```
┌─────────────────────────────────────────────────────────────┐
│                     新架构：单一 SSE 通道                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  后端（server.js）                                            │
│    ├─ Gateway WS 事件 → 统一转换为内部事件格式                │
│    ├─ Sync 文件变更 → 统一转换为内部事件格式                  │
│    └─ 所有内部事件 → 统一 SSE 广播（/api/events）             │
│                                                               │
│  前端（WsBridge）                                             │
│    ├─ 消费单一 SSE 通道                                       │
│    ├─ 解析事件 → 路由到对应处理器                             │
│    └─ 处理器操作 State → 组件响应                             │
│                                                               │
│  原则：                                                        │
│    - 后端负责"收集和标准化"所有事件源                         │
│    - 前端负责"消费和路由"单一事件流                           │
│    - 禁止前端直接从多个通道获取同一类信息                     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 事件类型定义

```javascript
/**
 * 统一事件类型（前后端契约）
 */
const EVENT_TYPES = {
  // === 连接状态 ===
  'connection.status': { ws: 'connected' | 'disconnected' },
  
  // === 聊天消息 ===
  'chat.delta':     { sessionKey, runId, content, agentId },
  'chat.thinking':  { sessionKey, runId, content },
  'chat.final':     { sessionKey, runId, content, agentId },
  'chat.error':     { sessionKey, runId, error },
  
  // === 子任务（智能调度模式）===
  'subtask.spawned':   { sessionKey, agentId, task, runId },
  'subtask.progress':  { sessionKey, agentId, toolName },
  'subtask.completed': { sessionKey, agentId, result },
  'subtask.failed':    { sessionKey, agentId, error },
  
  // === 会话变更 ===
  'session.created': { sessionKey, agentId },
  'session.updated': { sessionKey, status },
  'session.ended':   { sessionKey, reason },
  
  // === 配置变更 ===
  'agents.updated': {},
  'models.updated': {},
};
```

### 4.4 后端事件标准化（server.js）

```javascript
/**
 * 后端事件标准化器
 * 
 * 职责：将所有事件源（Gateway WS、文件变更、HTTP API）
 *       转换为统一的事件格式，通过单一 SSE 通道广播
 */
const EventNormalizer = {
  // Gateway WS 事件 → 内部事件
  fromGatewayWs: function(gwEvent) {
    const eventName = gwEvent.event || '';
    const payload = gwEvent.payload || gwEvent.params || gwEvent;
    
    switch (eventName) {
      case 'chat':
        return this._normalizeChatEvent(payload);
      case 'sessions.changed':
        return this._normalizeSessionEvent(payload);
      default:
        return { type: 'gateway.raw', data: gwEvent };
    }
  },
  
  // Sync 文件变更 → 内部事件
  fromSync: function(messages, progress) {
    const events = [];
    
    // 新消息事件
    messages.forEach(msg => {
      events.push({
        type: 'chat.final',
        sessionKey: msg.sessionKey,
        content: msg.content,
        agentId: msg.agentId || 'main',
      });
    });
    
    // 进度事件
    for (const agentId in progress) {
      events.push({
        type: 'subtask.progress',
        agentId: agentId,
        toolName: progress[agentId].toolName,
      });
    }
    
    return events;
  },
  
  _normalizeChatEvent: function(payload) {
    const state = payload.state || '';
    const sessionKey = payload.sessionKey || '';
    
    if (state === 'delta') {
      return { type: 'chat.delta', sessionKey, content: payload.message?.content };
    }
    if (state === 'final') {
      return { type: 'chat.final', sessionKey, content: payload.message?.content };
    }
    if (state === 'error') {
      return { type: 'chat.error', sessionKey, error: payload.errorMessage };
    }
    
    return null;
  },
  
  _normalizeSessionEvent: function(payload) {
    const reason = payload.reason || '';
    const sessionKey = payload.sessionKey || '';
    
    if (reason === 'subagent-status' && payload.status === 'done') {
      return { type: 'subtask.completed', sessionKey };
    }
    if (reason === 'create') {
      return { type: 'session.created', sessionKey };
    }
    if (reason === 'ended' || reason === 'delete') {
      return { type: 'session.ended', sessionKey, reason };
    }
    
    return null;
  },
};
```

### 4.5 前端事件路由（WsBridge）

```javascript
/**
 * WsBridge - 前端事件路由中心
 * 
 * 职责：
 *   1. 连接单一 SSE 通道（/api/events）
 *   2. 接收标准化事件
 *   3. 路由到对应处理器
 *   4. 不直接操作 DOM，只触发 State 变更或调用 Manager
 * 
 * 原则：
 *   - 单一入口：所有事件来自 SSE
 *   - 单一出口：通过 State.setState() 或 Manager API
 *   - 禁止组件直接监听 Gateway WS
 */
const WsBridge = {
  _source: null,
  _handlers: {},
  
  init: function() {
    this._registerHandlers();
    this.connect();
  },
  
  _registerHandlers: function() {
    // 连接状态
    this._handlers['connection.status'] = this._onConnectionStatus;
    
    // 聊天消息
    this._handlers['chat.delta'] = this._onChatDelta;
    this._handlers['chat.thinking'] = this._onChatThinking;
    this._handlers['chat.final'] = this._onChatFinal;
    this._handlers['chat.error'] = this._onChatError;
    
    // 子任务
    this._handlers['subtask.spawned'] = this._onSubtaskSpawned;
    this._handlers['subtask.progress'] = this._onSubtaskProgress;
    this._handlers['subtask.completed'] = this._onSubtaskCompleted;
    this._handlers['subtask.failed'] = this._onSubtaskFailed;
    
    // 会话变更
    this._handlers['session.created'] = this._onSessionCreated;
    this._handlers['session.ended'] = this._onSessionEnded;
    
    // 配置变更
    this._handlers['agents.updated'] = this._onAgentsUpdated;
  },
  
  _onSubtaskSpawned: function(data) {
    SubtaskManager.create(data.sessionKey, data.agentId, data.task);
  },
  
  _onSubtaskProgress: function(data) {
    SubtaskManager.updateStatus(data.sessionKey, 'running');
  },
  
  _onSubtaskCompleted: function(data) {
    SubtaskManager.updateStatus(data.sessionKey, 'completed', data.result);
  },
  
  _onSubtaskFailed: function(data) {
    SubtaskManager.updateStatus(data.sessionKey, 'failed', data.error);
  },
  
  // ... 其他处理器
};
```

---

## 五、组件职责重构：原子化、高内聚低耦合

### 5.1 当前组件的问题

```
chat-view.js（570 行）
  ├─ 发送调度
  ├─ 委托入口（已废弃）
  ├─ 流式渲染控制
  ├─ 附件处理
  ├─ 消息保存
  └─ Sync 触发

ws-bridge.js（290 行）
  ├─ SSE 连接管理
  ├─ 事件解析
  ├─ 子 agent 检测
  ├─ 卡片创建/完成
  ├─ 消息追加
  └─ 去重

subagent-card.js（345 行）
  ├─ 卡片创建
  ├─ 进度更新
  ├─ 停止按钮
  ├─ 定时器管理
  ├─ 完成/停止/淡出
  ├─ WS 桥接绑定
  └─ 卡片查找
```

**问题：每个组件都做太多事，职责边界模糊。**

### 5.2 新组件架构

```
┌─────────────────────────────────────────────────────────────┐
│                        应用层（App Layer）                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  app.js                                                       │
│    └─ 初始化所有模块，建立依赖关系                             │
│                                                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                        视图层（View Layer）                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ChatView         - 聊天界面容器（只负责布局）                 │
│  SessionList      - 会话列表                                 │
│  AgentList        - Agent 列表                               │
│  InputArea        - 输入区域（含 @mention）                    │
│  MessageList      - 消息列表                                 │
│  SubtaskPanel     - 子任务面板（显示进行中/完成的子任务）      │
│                                                               │
│  原则：                                                        │
│    - 只负责渲染，不处理业务逻辑                               │
│    - 通过 State 事件响应数据变化                              │
│    - 用户操作触发事件，不直接调用 API                         │
│                                                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                        控制器层（Controller Layer）            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ChatController   - 聊天流程控制                               │
│    ├─ 发送消息                                                 │
│    ├─ 接收消息                                                 │
│    ├─ 停止生成                                                 │
│    └─ 切换模式（智能调度 ↔ 直接对话）                         │
│                                                               │
│  SessionController - 会话管理                                  │
│    ├─ 创建会话                                                 │
│    ├─ 切换会话                                                 │
│    ├─ 删除会话                                                 │
│    └─ 重命名会话                                               │
│                                                               │
│  SubtaskController - 子任务管理（调用 SubtaskManager）         │
│    ├─ 显示子任务卡片                                           │
│    ├─ 更新子任务进度                                           │
│    ├─ 完成/失败/停止子任务                                     │
│    └─ 清理已完成子任务                                         │
│                                                               │
│  原则：                                                        │
│    - 协调视图和模型                                            │
│    - 处理用户交互                                              │
│    - 不直接操作 DOM，通过 State 驱动视图                      │
│                                                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                        模型层（Model Layer）                   │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  State            - 全局状态（唯一真相源）                     │
│  SubtaskManager   - 子任务状态管理                             │
│  SessionStore     - 会话持久化（localStorage + 服务端）        │
│                                                               │
│  原则：                                                        │
│    - 纯数据逻辑，无 DOM 操作                                   │
│    - 所有状态变更通过明确 API                                  │
│    - 可独立测试                                                │
│                                                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                        服务层（Service Layer）                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Api              - HTTP API 封装                              │
│  WsBridge         - SSE 事件通道（消费标准化事件）             │
│  EventRouter      - 事件路由（后端事件标准化）                 │
│                                                               │
│  原则：                                                        │
│    - 封装外部通信细节                                          │
│    - 提供清晰的异步接口                                        │
│    - 错误处理和重试逻辑                                        │
│                                                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                        工具层（Utility Layer）                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  MessageBuilder   - 消息组装（纯函数）                         │
│  Dedup            - 去重工具                                   │
│  RenderUtils      - 渲染辅助函数                               │
│  MentionCompleter - @mention 自动补全                          │
│                                                               │
│  原则：                                                        │
│    - 纯函数，无副作用                                          │
│    - 不依赖全局状态                                            │
│    - 可独立测试                                                │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 组件依赖规则

```
┌─────────────────────────────────────────────────────────────┐
│                     依赖方向（只能向下依赖）                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│   视图层  →  控制器层  →  模型层  →  服务层  →  工具层        │
│                                                               │
│   禁止：                                                        │
│     - 视图层直接调用服务层                                     │
│     - 控制器层直接操作 DOM                                     │
│     - 模型层直接调用 API                                       │
│     - 同级组件直接调用（必须通过 State 事件）                  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 六、实施计划

### 阶段一：清理废弃代码（1-2 天）

**目标**：删除委托执行相关的废弃代码，消除语义混乱

| 文件 | 改动 | 验证方式 |
|------|------|---------|
| `chat-view.js` | 删除 `pendingDelegation` 相关逻辑 | @mention 后直接切换 agent |
| `mention-completer.js` | "委托给" → "与某某对话" | UI 文案正确 |
| `State.js` | `pendingDelegation` → `targetAgent` | 状态名语义正确 |
| `subagent-card.js` | 删除委托相关的卡片逻辑 | 直接对话模式无卡片 |
| `ws-bridge.js` | 删除 `_detectSubagentSpawn` 中委托相关逻辑 | 无重复卡片创建 |

### 阶段二：接入智能调度（2-3 天）

**目标**：让默认消息走 main agent，触发智能调度

| 文件 | 改动 | 验证方式 |
|------|------|---------|
| `chat-view.js` | 无 @mention 时 agentId = 'main' | 消息发给 main agent |
| `message-builder.js` | 保留 @mention 标记在消息中 | main agent 能看到 @mention |
| `proxy.js` | 确保 main 的 AGENTS.md 正确注入 | main agent 知道子 agent 列表 |
| `session-sync.js` | 优化 Sync 模式可靠性 | announce 结果正确回传 |

### 阶段三：重构状态管理（2-3 天）

**目标**：建立单一真相源，消除状态分散

| 文件 | 改动 | 验证方式 |
|------|------|---------|
| `State.js` | 新增 `subtasks`、`interactionMode`、`targetAgent` | 状态结构清晰 |
| 新增 `SubtaskManager.js` | 子任务生命周期管理 | 所有子任务状态一致 |
| `subagent-card.js` | 改为纯展示组件，数据来自 State | 卡片状态与 State 同步 |
| `ws-bridge.js` | 统一事件路由，操作 State | 事件处理不重复 |

### 阶段四：重构通信通道（2-3 天）

**目标**：统一事件流，消除通道竞争

| 文件 | 改动 | 验证方式 |
|------|------|---------|
| `server.js` | 新增 `EventNormalizer` | 后端事件格式统一 |
| `ws-bridge.js` | 改为单一 SSE 消费 + 事件路由 | 前端只从一个通道接收 |
| `session-sync.js` | 事件标准化后广播 | Sync 结果通过统一通道 |

### 阶段五：组件化重构（3-5 天）

**目标**：原子化组件，清晰职责边界

| 文件 | 改动 | 验证方式 |
|------|------|---------|
| 新增 `ChatController.js` | 提取聊天流程控制 | chat-view.js 只负责渲染 |
| 新增 `SubtaskController.js` | 提取子任务 UI 控制 | subagent-card.js 只负责渲染 |
| `chat-view.js` | 精简为纯视图组件 | 行数 < 200 |
| `ws-bridge.js` | 精简为事件通道 | 行数 < 150 |

### 验证清单

每个阶段完成后必须验证：

1. **直接对话模式**：@mention → 切换 agent → 直接回复 ✅
2. **智能调度模式**：无 @mention → main agent → 可能派子 agent ✅
3. **子任务显示**：智能调度时显示子任务卡片 → 完成/失败 ✅
4. **消息去重**：同一消息不重复显示 ✅
5. **状态一致性**：State.subtasks 与 UI 卡片状态一致 ✅
6. **错误处理**：Gateway 断开、子 agent 失败时有降级 ✅

---

## 七、风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| Gateway 事件格式变化 | 中 | 高 | 后端 EventNormalizer 隔离变化 |
| Sync 模式时序问题 | 中 | 高 | 增量读取 + 去重双重保障 |
| main agent 不调用 sessions_spawn | 中 | 高 | 优化 AGENTS.md instruct + 模型调参 |
| 重构引入新 bug | 高 | 中 | 分阶段实施，每阶段验证 |
| 性能下降 | 低 | 中 | 保持增量读取，避免全量扫描 |

---

## 八、一句话总结

> **砍掉委托执行这个"伪需求"，明确区分"直接对话"和"智能调度"两种模式。统一通信通道，建立单一状态真相源，原子化组件职责。让 main agent（虾指挥）发挥智能调度的价值，前端只做清晰的展示和交互。**
