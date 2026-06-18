# 虾指挥 (Shrift) — Code Wiki

> **项目名称**：shrift-openclaw-webui  
> **版本**：1.0.0  
> **协议**：MIT  
> **作者**：简乐  
> **定位**：OpenClaw 的 Web 控制面板，主打 Agent 主从模式的显式调用

---

## 目录

1. [项目概述](#1-项目概述)
2. [整体架构](#2-整体架构)
3. [技术栈与依赖](#3-技术栈与依赖)
4. [目录结构](#4-目录结构)
5. [后端模块详解](#5-后端模块详解)
6. [前端模块详解](#6-前端模块详解)
7. [数据流与通信机制](#7-数据流与通信机制)
8. [API 接口文档](#8-api-接口文档)
9. [状态管理体系](#9-状态管理体系)
10. [安全机制](#10-安全机制)
11. [项目运行方式](#11-项目运行方式)
12. [配置说明](#12-配置说明)
13. [架构原则与设计哲学](#13-架构原则与设计哲学)
14. [已知踩坑经验](#14-已知踩坑经验)

---

## 1. 项目概述

虾指挥是一款基于 [OpenClaw](https://github.com/nicepkg/openclaw) 的 Web UI 应用，核心特色是实现 **Agent 主从模式的显式调用**。它提供两种交互模式：

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| **智能调度** | 主 Agent 自动分配任务给合适的子 Agent | 复杂任务、多步骤流程 |
| **独立交互** | 用户通过 `@` 指定某个子 Agent 直接对话 | 精准需求、单点任务 |

### 核心功能

- 💬 **智能对话** — 流式输出、思考过程展示、多轮对话
- 🤖 **Agent 管理** — 创建/编辑/删除 Agent，绑定技能与模型
- 📨 **@提及** — 输入 `@` 快速召唤指定 Agent 协作
- 📁 **会话持久化** — 聊天记录存储在服务器端，双写 localStorage
- 🔒 **安全防护** — DOMPurify XSS 防护、上传文件白名单、路径遍历防护
- 📡 **SSE 实时事件** — Gateway 状态实时推送，断线自动重连
- 🖥️ **一键启动** — 自动探测 Node.js 和 OpenClaw 路径

---

## 2. 整体架构

```
┌────────────────────────────────────────────────────────────────┐
│                     浏览器（前端 SPA）                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ State.js │  │ Api.js   │  │WsBridge  │  │ Components   │  │
│  │ (状态中心)│  │ (API层)  │  │(SSE事件桥)│  │ (UI组件群)   │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────────────┘  │
│       │             │             │                            │
│       └──────┬──────┘──────┬──────┘                           │
│              │             │                                   │
└──────────────┼─────────────┼───────────────────────────────────┘
               │ HTTP/SSE    │ SSE (/api/events)
               ▼             ▼
┌────────────────────────────────────────────────────────────────┐
│                    Node.js HTTP 服务器                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │server.js │  │routes.js │  │proxy.js  │  │ agent-routes │  │
│  │(HTTP服务)│  │(API路由) │  │(GW代理)  │  │ (Agent CRUD) │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │fs-store  │  │sse-mgr   │  │ws-client │  │session-sync  │  │
│  │(文件存储)│  │(SSE管理) │  │(GW WS桥) │  │(会话同步)    │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘  │
│  ┌──────────┐                                                  │
│  │roster-   │  ← Agent 花名册同步与 AGENTS.md 生成             │
│  │sync.js   │                                                  │
│  └──────────┘                                                  │
└──────────────────────┬─────────────────────────────────────────┘
                       │ HTTP Proxy (/v1/*) + WebSocket
                       ▼
┌────────────────────────────────────────────────────────────────┐
│                  OpenClaw Gateway (外部依赖)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                     │
│  │主 Agent  │  │子 Agent 1│  │子 Agent N│  ...                 │
│  │(调度中心)│  │(专家)    │  │(专家)    │                      │
│  └──────────┘  └──────────┘  └──────────┘                     │
└────────────────────────────────────────────────────────────────┘
```

### 架构分层

| 层 | 职责 | 关键文件 |
|----|------|----------|
| **视图层** | DOM 渲染、用户交互 | `components/*.js`, `views/app-view.js` |
| **控制层** | 业务逻辑调度 | `controllers/chat-controller.js`, `controllers/session-manager.js` |
| **状态层** | 响应式状态管理 | `state.js` |
| **通信层** | API 调用、SSE 事件 | `api.js`, `controllers/ws-bridge.js` |
| **HTTP 服务层** | 路由、代理、静态文件 | `server.js`, `routes.js`, `proxy.js` |
| **数据层** | 文件读写、会话持久化 | `fs-store.js`, `session-sync.js` |
| **同步层** | Agent 花名册、配置监听 | `roster-sync.js` |
| **实时层** | SSE 推送、WS 事件桥 | `sse-manager.js`, `ws-client.js` |

---

## 3. 技术栈与依赖

### 后端

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js | >= 18 | 运行时 |
| ws | ^8.20.1 | WebSocket 客户端（连接 Gateway） |

> 后端零框架，纯 Node.js 原生 `http` 模块构建，无 Express/Koa。

### 前端

| 依赖 | 用途 | 加载方式 |
|------|------|----------|
| marked.js | Markdown → HTML 渲染 | CDN/本地 `js/lib/marked.min.js` |
| DOMPurify | XSS 防护（sanitize HTML） | CDN/本地 `js/lib/purify.min.js` |
| Google Fonts (Inter, Noto Sans SC) | 界面字体 | Google Fonts CDN |

> 前端零构建工具，无 Webpack/Vite，纯原生 JavaScript + HTML + CSS，通过 `<script defer>` 加载。

---

## 4. 目录结构

```
openclaw-web-ui/
├── server.js              # HTTP 服务器入口 + 配置加载 + 模块初始化
├── routes.js              # API 路由定义与处理器
├── fs-store.js            # 文件存储层（配置读写、会话持久化、技能扫描）
├── proxy.js               # Gateway HTTP 代理
├── ws-client.js           # Gateway WebSocket 客户端
├── agent-routes.js        # Agent/技能/模型 CRUD API
├── sse-manager.js         # SSE 连接管理器
├── session-sync.js        # Gateway 会话文件轮询同步
├── roster-sync.js         # Agent 花名册同步与 AGENTS.md 生成
├── config.example.json    # 配置模板
├── package.json           # 项目元信息与依赖
├── start.ps1 / start.bat  # 一键启动脚本（Windows）
├── stop.ps1 / stop.bat    # 一键停止脚本（Windows）
├── shrift.bat             # 独立窗口启动入口
├── test-e2e.js            # E2E 测试
│
├── web/                   # 前端静态文件
│   ├── index.html         # 主入口页面
│   ├── setup.html         # 首次配置向导页面
│   ├── manifest.json      # PWA 清单
│   ├── logo.svg           # 应用 Logo
│   ├── css/
│   │   └── style.css      # 全局样式
│   ├── fonts/             # 本地字体文件
│   ├── avatars/           # Agent 头像 SVG 资源（16个）
│   ├── images/            # 图片资源
│   └── js/
│       ├── app.js             # 应用初始化入口
│       ├── state.js           # 响应式状态管理中心
│       ├── api.js             # API 调用层
│       ├── constants.js       # 常量定义
│       ├── lib/               # 第三方库
│       │   ├── marked.min.js
│       │   └── purify.min.js
│       ├── controllers/       # 控制器层
│       │   ├── chat-controller.js   # 聊天业务逻辑
│       │   ├── session-manager.js   # 会话管理 + SessionStore
│       │   ├── event-router.js      # 连接状态 UI
│       │   └── ws-bridge.js         # 前端 SSE 事件桥
│       ├── components/       # UI 组件层
│       │   ├── chat-view.js         # 聊天视图（纯视图层）
│       │   ├── message-renderer.js  # 消息气泡渲染
│       │   ├── stream-renderer.js   # 流式渲染
│       │   ├── message-builder.js   # API 消息构建
│       │   ├── session-list.js      # 会话列表
│       │   ├── session-interaction.js # 会话创建/查找
│       │   ├── agent-list.js        # Agent 列表
│       │   ├── agent-modal.js       # Agent 创建/编辑弹窗
│       │   ├── welcome-view.js      # 欢迎页
│       │   ├── attachment-bar.js    # 附件栏
│       │   ├── model-switcher.js    # 模型切换 UI
│       │   ├── model-picker.js      # 模型选择器组件
│       │   ├── tool-monitor.js      # Tool Call 监控面板
│       │   └── virtual-list.js      # 虚拟列表（长消息优化）
│       ├── ui/               # UI 交互层
│       │   ├── interaction-bindings.js  # 全局事件绑定
│       │   ├── mention-completer.js     # @提及补全
│       │   └── menu-system.js           # 会话/Agent 菜单
│       ├── utils/            # 工具函数
│       │   ├── utils.js              # 通用工具集
│       │   ├── render.js             # Markdown 渲染
│       │   ├── error-handler.js      # 统一错误处理
│       │   └── lazy-loader.js        # 懒加载工具
│       └── views/            # 视图构建
│           └── app-view.js           # 应用骨架 HTML 构建
│
└── docs/                  # 项目文档
```

---

## 5. 后端模块详解

### 5.1 server.js — HTTP 服务器入口

**职责**：HTTP 服务器创建、配置加载、模块初始化与编排

**关键流程**：

1. **依赖检查** — 检测 `ws` 模块是否可用
2. **配置加载** — 读取 `config.json`，解析端口/Gateway URL/Token
3. **OpenClaw 配置定位** — `_resolveOpenclawConfig()` 按优先级查找：
   - 环境变量 `OPENCLAW_CONFIG_PATH`
   - `config.json` 中的 `openclawConfigPath`
   - `_detectOpenclawConfig()` 自动探测候选路径
4. **Setup 模式** — 若未找到 `openclaw.json`，进入配置向导模式
5. **模块初始化** — 依次初始化 `fs-store`、`sse-manager`、`proxy`、`ws-client`、`session-sync`、`roster-sync`
6. **配置文件监听** — `fs.watch` 监听 `openclaw.json` 变更，触发花名册同步
7. **HTTP 请求处理** — Setup 模式仅开放配置 API；正常模式走完整路由

**关键函数**：

| 函数 | 说明 |
|------|------|
| `_resolveOpenclawConfig(cfg)` | 按优先级解析 OpenClaw 配置路径 |
| `_detectOpenclawConfig()` | 自动探测 openclaw.json 候选路径 |
| `_refreshSetupMode()` | 配置保存后刷新模式状态 |
| `collectBody(req, callback)` | 收集请求体（带大小限制 10MB） |
| `serveStatic(req, res)` | 静态文件服务（带路径安全检查） |

### 5.2 fs-store.js — 文件存储层

**职责**：OpenClaw 配置文件读写、会话持久化、技能扫描

**核心状态**（闭包变量）：

| 变量 | 说明 |
|------|------|
| `OPENCLAW_CONFIG` | openclaw.json 文件路径 |
| `SESSIONS_DIR` | 会话文件存储目录 |
| `DATA_DIR` | OpenClaw 数据目录 |

**关键函数**：

| 函数 | 说明 |
|------|------|
| `init(configPath, projectDir)` | 初始化存储路径，含可写性检测与 fallback |
| `readConfig()` / `writeConfig(data)` | 读写 openclaw.json |
| `getAgentList()` | 获取 Agent 列表 |
| `findAgentRaw(agentId)` | 按 ID 查找 Agent 原始数据 |
| `getAgentWorkspace(agentId)` | 获取 Agent 工作区路径 |
| `scanSkills(ws)` | 扫描工作区 skills 目录 |
| `scanGlobalSkills()` | 扫描全局 skills 目录 |
| `scanExtraDirsSkills()` | 扫描配置中额外 skills 目录 |
| `getAvailableModels()` | 从配置解析可用模型列表 |
| `saveSession(session)` / `getSession(id)` | 会话 CRUD |
| `cleanupWorkspace(workspace)` | 清理 Agent 工作区（含安全路径校验） |
| `patchAgentField(agentId, field, value)` | 修改 Agent 单个字段 |

**安全机制**：

- `_canWriteDir(dir)` — 写入前探测目录可写性，不可写时 fallback 到项目目录
- `_isPathWithinAllowedRoots(targetPath)` — 清理工作区前校验路径在允许范围内

### 5.3 routes.js — API 路由定义

**职责**：定义所有 `/api/*` 路由及其处理逻辑

**路由注册方式**：正则表达式匹配

```javascript
{ method: 'GET', pattern: /^\/api\/agents$/, handler: function(m, req, res) { ... } }
```

**关键函数**：

| 函数 | 说明 |
|------|------|
| `init(deps)` | 注入依赖（wsClient, sseManager, proxy, collectBody, getConfig, refreshSetupMode） |
| `_safeSessionId(id)` | Session ID 安全校验（防路径遍历） |
| `_verifyConfigPath(filePath)` | 验证 OpenClaw 配置文件有效性 |
| `handleSetup(req, res)` | 保存配置（Setup 模式） |
| `handleSetupDetect(req, res)` | 自动检测 OpenClaw 配置路径 |
| `handleUpload(req, res)` | 文件上传（白名单 + 大小限制） |

### 5.4 proxy.js — Gateway HTTP 代理

**职责**：将 `/v1/*` 请求代理到 OpenClaw Gateway

**关键函数**：

| 函数 | 说明 |
|------|------|
| `createProxy(gwHost, gwPort, gwToken, store)` | 创建代理实例 |
| `proxyRequest(req, res, raw)` | 代理请求到 Gateway（支持 SSE 流式透传） |
| `checkHealth(res)` | 健康检查（请求 Gateway `/v1/models`） |

**代理行为**：

- 透传 `x-openclaw-agent-id` 和 `x-openclaw-session-key` 请求头
- 自动注入 `Authorization: Bearer <token>`
- SSE 响应设置 `Cache-Control: no-cache`、`X-Accel-Buffering: no`
- 超时 180 秒

### 5.5 ws-client.js — Gateway WebSocket 客户端

**职责**：与 OpenClaw Gateway 建立 WebSocket 连接，接收实时事件

**连接协议**：

1. 建立 WS 连接到 `ws://<host>:<port>/ws`
2. 发送 `connect` 握手消息（含 auth token、role、protocol 版本）
3. 订阅 `sessions.subscribe` 事件
4. 接收事件并转发给 SSE 管理器

**关键函数**：

| 函数 | 说明 |
|------|------|
| `createWsClient(gwUrl, gwToken)` | 创建 WS 客户端实例 |
| `connect()` | 建立连接（含自动重连，指数退避 3s→30s） |
| `sendRequest(method, params, timeoutMs)` | 发送请求-响应式 WS 消息 |
| `chatSend(sessionKey, message)` | 发送聊天消息 |
| `chatHistory(sessionKey, limit)` | 获取聊天历史 |
| `isConnected()` | 连接状态检查 |

**重连策略**：指数退避，基础延迟 3 秒，最大延迟 30 秒，心跳间隔 25 秒

**降级方案**：若 `sessions.subscribe` 失败，自动切换到 HTTP 轮询（5 秒间隔）

### 5.6 agent-routes.js — Agent CRUD API

**职责**：Agent、技能、模型的增删改查

**关键函数**：

| 函数 | 说明 |
|------|------|
| `listAgents(res)` | Agent 列表（30 秒缓存） |
| `getAgentDetail(agentId, res)` | Agent 详情（含 AGENTS.md、团队成员、技能） |
| `createAgent(body, res)` | 创建 Agent（自动生成 ID、工作区、allowAgents） |
| `updateAgent(agentId, body, res)` | 更新 Agent 属性 |
| `deleteAgent(agentId, res)` | 删除 Agent（含工作区清理） |
| `listSkills(res)` | 技能列表（含绑定 Agent 信息） |
| `handleSkillAction(agentId, body, res)` | 绑定/解绑技能 |
| `syncSkills(agentId, body, res)` | 同步技能列表 |
| `deleteSkill(skillId, res)` | 删除技能（含解绑 + 目录清理） |
| `listModels(res)` | 模型列表 |
| `updateDefaultModel(body, res)` | 更新默认模型 |

**创建 Agent 自动化流程**：

1. 生成唯一 ID
2. 创建工作区目录
3. 写入 AGENTS.md（如有 prompt）
4. 加入 `allowAgents` 白名单
5. 同步花名册

### 5.7 sse-manager.js — SSE 连接管理器

**职责**：管理 Server-Sent Events 客户端连接的生命周期

**关键方法**：

| 方法 | 说明 |
|------|------|
| `init(getWsStatus)` | 注入 WS 状态查询回调 |
| `handleSSE(req, res)` | SSE 端点处理器（`/api/events`） |
| `broadcast(payload)` | 向所有客户端广播事件 |
| `closeAll()` | 关闭所有连接 |

**事件类型**：

| 事件 | 说明 |
|------|------|
| `status` | 连接状态（ws: connected/disconnected） |
| `gateway` | Gateway WS 事件转发 |
| `agents-updated` | Agent 列表变更通知 |
| `announce-result` | 子 Agent 执行结果（预留） |
| `subagent-progress` | 子 Agent 进度（预留） |

### 5.8 session-sync.js — Gateway 会话文件轮询

**职责**：轮询主 Agent 的 session 文件，检测新消息并广播到前端

**工作机制**：

1. Gateway WS 事件触发 `startSync()`
2. 定位最新 session 文件（`.jsonl` 格式）
3. 增量读取文件内容（基于 offset）
4. 解析 assistant 消息并广播
5. 连续 6 次无新消息则停止轮询

**关键函数**：

| 函数 | 说明 |
|------|------|
| `init(broadcastFn)` | 注入 SSE 广播函数 |
| `onSubagentGatewayEvent(data)` | Gateway 事件触发同步 |
| `startSync()` / `stopSync()` | 启动/停止轮询循环 |
| `readGatewayAssistantMessages()` | 读取 Gateway assistant 消息 |
| `_readSubagentProgress()` | 读取子 Agent 执行进度 |

### 5.9 roster-sync.js — Agent 花名册同步

**职责**：同步 Agent 的 AGENTS.md 文件，生成 Sub-Agents、Team Members、Skills 等 section

**关键函数**：

| 函数 | 说明 |
|------|------|
| `syncTeamRoster()` | 同步主 Agent 的 AGENTS.md（Sub-Agents + @Mention Rules） |
| `syncSubAgentRoster(agentId)` | 同步子 Agent 的 AGENTS.md（Team Members + Skills） |
| `syncAllRosters()` | 同步所有 Agent 花名册（含 allowAgents 引用完整性校验） |
| `unbindSkillFromAll(skillId)` | 从所有 Agent 解绑指定技能 |

**AGENTS.md 生成内容**：

- `## Sub-Agents` — 子 Agent 列表（ID、名称、描述）
- `## @Mention Handling Rules` — @提及处理规则
- `## Team Members` — 团队成员列表
- `## Skills` — 技能使用说明与命令
- `## Custom Skills Notes` — 用户自定义内容（保留不覆盖）

**技能链接管理**：`_syncSkillLinks()` 在 Agent 工作区创建 symlink/junction 指向全局技能目录

---

## 6. 前端模块详解

### 6.1 加载顺序

前端通过 `<script defer>` 按依赖顺序加载，加载顺序即依赖关系：

```
1. purify.min.js, marked.min.js     ← 第三方库
2. constants.js                      ← 常量定义
3. state.js                          ← 状态中心（无依赖）
4. utils/utils.js                    ← 工具函数（依赖 Constants）
5. utils/error-handler.js            ← 错误处理
6. utils/lazy-loader.js              ← 懒加载
7. utils/render.js                   ← Markdown 渲染（依赖 Utils, marked, DOMPurify）
8. api.js                            ← API 调用层（依赖 State, Utils）
9. views/app-view.js                 ← 应用骨架构建
10. controllers/session-manager.js   ← 会话管理（依赖 State, SessionStore）
11. controllers/event-router.js      ← 事件路由
12. controllers/ws-bridge.js         ← SSE 事件桥（依赖 State, Api）
13. ui/menu-system.js                ← 菜单系统
14. ui/mention-completer.js          ← @提及补全
15. ui/interaction-bindings.js       ← 全局事件绑定
16. components/*                     ← UI 组件
17. controllers/chat-controller.js   ← 聊天控制器（依赖所有组件）
18. components/chat-view.js          ← 聊天视图（依赖 ChatController）
19. app.js                           ← 应用初始化入口
```

### 6.2 state.js — 响应式状态管理中心

**设计原则**：真理源自一处，全局引用

**状态分组**：

| 分组 | 字段 | 触发事件 |
|------|------|----------|
| `State.ui` | `sidebarOpen`, `activeModal`, `editingAgent`, `filter` | `sidebar`, `modal`, `filter` |
| `State.chat` | `streaming`, `userScrolledUp`, `messages`, `currentSessionId` | `streaming`, `scroll`, `messages`, `session-switch` |
| `State.agent` | `agents`, `skills`, `currentAgent`, `interactionMode` | `agent-list`, `skills`, `agent-switch`, `mode-switch` |
| `State.connection` | `connected` | `connection` |
| `State.model` | `models`, `defaultModel` | `model-list`, `model-switch` |
| `State.sessions` | 会话列表（顶层） | `session-list` |

**核心 API**：

| 方法 | 说明 |
|------|------|
| `State.setState(partial)` | 更新状态（支持分组和扁平两种写法，自动触发事件） |
| `State.on(event, callback)` | 订阅事件，返回取消订阅函数 |
| `State.off(event, callback)` | 取消订阅 |
| `State.findAgent(nameOrId)` | 按 ID 或名称查找 Agent |

**向后兼容**：提供 getter/setter 代理，允许 `State.streaming` 等扁平访问方式

### 6.3 api.js — API 调用层

**核心方法**：

| 方法 | 说明 |
|------|------|
| `Api.chat(messages, agentId, callbacks)` | 发送聊天消息（SSE 流式） |
| `Api.stopGeneration()` | 停止生成（AbortController） |
| `Api.fetchAgents()` | 获取 Agent 列表 |
| `Api.createAgent(data)` | 创建 Agent |
| `Api.updateAgent(agentId, data)` | 更新 Agent |
| `Api.fetchAgentDetail(agentId)` | 获取 Agent 详情 |
| `Api.fetchAllSkills()` | 获取技能列表 |
| `Api.fetchModels()` | 获取模型列表 |
| `Api.updateDefaultModel(modelId)` | 更新默认模型 |
| `Api.checkHealth()` | 健康检查 |

**`Api.chat()` 流式处理**：

1. 构建请求（`model: "openclaw/<agentId>"`，`stream: true`）
2. 设置 `x-openclaw-agent-id` 和 `x-openclaw-session-key` 请求头
3. 解析 SSE 流：`onDelta`（内容增量）、`onThinking`（思考过程）、`onAgentSwitch`（Agent 切换）、`onToolCall`（工具调用）、`onDone`（完成）

### 6.4 controllers/chat-controller.js — 聊天业务逻辑

**核心方法**：

| 方法 | 说明 |
|------|------|
| `ChatController.sendMessage()` | 发送消息主流程（11 步） |
| `ChatController.stopGeneration()` | 停止生成 |
| `ChatController.resolveAgentDisplay(agentId)` | 解析 Agent 显示名 |

**sendMessage 流程**：

1. 获取用户输入
2. 上传附件（如有）
3. 确定 Agent（dispatch 模式→main，direct 模式→指定 Agent）
4. 确保会话存在（`SessionInteraction.ensureSession`）
5. 开始流式渲染（`StreamRenderer.beginStreaming`）
6. 隐藏欢迎页
7. 构建显示文本与 API 文本
8. 显示用户消息
9. 保存用户消息
10. 创建助手消息气泡
11. 调用 API 并处理流式回调

### 6.5 controllers/session-manager.js — 会话管理

包含两个核心对象：

**SessionStore** — 会话存储（localStorage + 服务器双写）

| 方法 | 说明 |
|------|------|
| `save(session)` | 保存会话（localStorage + 服务器双写） |
| `get(id)` | 获取会话（优先缓存，fallback localStorage） |
| `remove(id)` | 删除会话（localStorage + 服务器双删） |
| `rename(id, name)` | 重命名会话 |
| `fetchFromServer()` | 从服务器拉取会话列表 |
| `fetchSession(id)` | 从服务器拉取单个会话 |

**SessionManager** — 会话管理逻辑

| 方法 | 说明 |
|------|------|
| `createSession()` | 创建新会话 |
| `selectSession(id)` | 选择会话（先渲染本地缓存，再从服务器更新） |
| `deleteSession(id, e)` | 删除会话 |
| `renameSession(id, name)` | 重命名会话 |
| `exportSession(sid)` | 导出会话为 Markdown |
| `loadSessions()` | 加载会话列表 |
| `exitAgentMode()` | 退出 Agent 直接对话模式 |

**长会话优化**：渲染历史消息时最多显示 200 条，超出部分显示占位提示

### 6.6 controllers/ws-bridge.js — 前端 SSE 事件桥

**通道架构**：

| 通道 | 说明 | 状态 |
|------|------|------|
| SSE 流 `/v1/chat/completions` | 消息渲染唯一通道 | ✅ 活跃 |
| `gateway` | Gateway WS 事件转发 | ✅ 活跃 |
| `status` | 连接状态 | ✅ 活跃 |
| `agents-updated` | Agent 列表变更 | ✅ 活跃 |
| `announce-result` | 子 Agent 结果 | 🔜 预留 |
| `subagent-progress` | 子 Agent 进度 | 🔜 预留 |

**重连策略**：指数退避，基础延迟 3 秒，最大延迟 30 秒

### 6.7 UI 组件层

#### components/chat-view.js — 聊天视图（纯视图层）

业务逻辑已迁移到 `ChatController`，本模块仅做视图操作委托。

#### components/message-renderer.js — 消息气泡渲染

**核心功能**：

- Agent 颜色系统（8 色，基于名称哈希分配）
- 附件卡片渲染
- 思考过程折叠块
- Agent 标签（头像 + 名称 + 描述）
- 复制按钮（事件委托）

#### components/stream-renderer.js — 流式渲染

**核心功能**：

- 增量渲染（rAF + 50ms debounce）
- 思考块实时更新
- 准备中动画指示器
- 停止/发送按钮切换
- 流式结束后添加操作按钮

#### components/message-builder.js — API 消息构建

**核心功能**：

- 构建符合 OpenAI 格式的 API 消息数组
- 处理多 Agent 消息归属（`[AgentName said]:`）
- 多模态消息构建（文本 + 图片 URL + 附件描述）

#### components/agent-list.js — Agent 列表

监听 `agent-list` 和 `agent-switch` 事件，渲染侧边栏 Agent 列表，含缓存 key 去重。

#### components/agent-modal.js — Agent 创建/编辑弹窗

**功能**：名称、简介、头像选择器（16 个 SVG）、详情介绍（含提示标签模板）、技能绑定、模型选择、团队成员展示。

#### components/welcome-view.js — 欢迎页

两种模式：主界面欢迎页（含建议提示词）和 Agent 对话欢迎页。

#### components/attachment-bar.js — 附件栏

支持拖拽、粘贴、点击上传，图片预览，大小限制 10MB。

#### components/model-switcher.js — 模型切换

底部模型选择栏，切换时调用 API 更新 Agent 模型或默认模型。

#### components/tool-monitor.js — Tool Call 监控面板

调试工具，快捷键 `Ctrl+Shift+M` 切换，实时显示 SSE 流中的 `tool_call` 事件。

#### components/virtual-list.js — 虚拟列表

长消息列表性能优化，消息超过 50 条时启用虚拟滚动，只渲染可见区域 + 缓冲区。

### 6.8 UI 交互层

#### ui/interaction-bindings.js — 全局事件绑定

**绑定类别**：按钮、输入框、快捷键、滚动检测、Agent 区域（折叠/拖拽调整高度）、侧边栏（拖拽调整宽度）、拖拽上传、会话列表、全局点击

**快捷键**：

| 快捷键 | 功能 |
|--------|------|
| `Enter` | 发送消息 |
| `Shift+Enter` | 换行 |
| `Escape` | 关闭弹窗 |
| `Ctrl+N` | 新建会话 |
| `Ctrl+Shift+N` | 新建 Agent |
| `Ctrl+/` | 聚焦输入框 |
| `Ctrl+Shift+M` | 切换 Tool Monitor |

**清理机制**：所有事件监听器记录在 `_handlers` 和 `_stateUnsubscribers`，调用 `destroy()` 可全部清理。

#### ui/mention-completer.js — @提及补全

输入 `@` 时弹出 Agent 选择器，选中后切换到直接对话模式。

#### ui/menu-system.js — 菜单系统

会话三点菜单（重命名、标记待办、导出、删除）和 Agent 三点菜单（编辑、删除），含内联重命名功能。

### 6.9 工具函数层

#### utils/utils.js — 通用工具集

| 方法 | 说明 |
|------|------|
| `Utils.escapeHtml(str)` | HTML 转义 |
| `Utils.uid()` | 生成唯一 ID |
| `Utils.fmtDate(ts)` | 相对时间格式化 |
| `Utils.$(sel)` / `Utils.$$(sel)` | DOM 选择器简写 |
| `Utils.scrollToBottom(el, smooth)` | 滚动到底部（rAF 节流） |
| `Utils.autoResize()` | 输入框自动调整高度 |
| `Utils.getAttachmentIcon(mimeType)` | MIME 类型→图标 |
| `Utils.renderAgentAvatar(avatar, name)` | Agent 头像渲染 |
| `Utils.normalizeAgents(rawList)` | Agent 列表标准化 |
| `Utils.highlightMentions(text)` | @提及高亮 |
| `Utils.showToast(msg, duration, type)` | Toast 通知 |
| `Utils.copyToClipboard(text, onSuccess, onError)` | 剪贴板复制（含 fallback） |

#### utils/render.js — Markdown 渲染

- 自定义 marked renderer：代码块加语言标签 + 复制按钮
- LRU 缓存（64 条），避免重复 `marked.parse` + `DOMPurify.sanitize`
- 复制按钮事件委托

#### utils/error-handler.js — 统一错误处理

| 上下文 | 提示方式 |
|--------|----------|
| `chat` | 气泡内显示错误 |
| `api` / `upload` / `network` / `unknown` | Toast 提示 |

#### utils/lazy-loader.js — 懒加载工具

按需加载 JS 文件，支持缓存、批量加载、预加载。

### 6.10 constants.js — 常量定义

| 分组 | 关键常量 |
|------|----------|
| `TIMEOUT` | Toast 时长、API 超时、SSE 重连延迟 |
| `SIZE` | 输入框最大高度、侧边栏宽度范围、滚动阈值 |
| `FILE` | 文件大小限制（10MB） |
| `LIMIT` | 字符数限制（8000）、消息渲染上限（200）、缓存大小 |
| `TIME` | 时间单位常量 |
| `PAGINATION` | UID 生成参数 |

---

## 7. 数据流与通信机制

### 7.1 消息发送流程

```
用户输入 → InteractionBindings (keydown Enter)
         → ChatView.sendMessage()
         → ChatController.sendMessage()
           ├─ AttachmentBar.uploadAll()        ← 上传附件
           ├─ SessionInteraction.ensureSession() ← 确保会话
           ├─ MessageRenderer.appendMessage()   ← 显示用户消息
           ├─ StreamRenderer.beginStreaming()    ← 开始流式
           ├─ MessageBuilder.buildApiMessages()  ← 构建 API 消息
           └─ Api.chat(messages, agentId, callbacks)
               ├─ fetch /v1/chat/completions → proxy.js → Gateway
               ├─ SSE 流式回调:
               │   ├─ onDelta → StreamRenderer.scheduleRender()
               │   ├─ onThinking → 思考块更新
               │   ├─ onAgentSwitch → MessageRenderer.updateMessageAgent()
               │   ├─ onToolCall → ToolMonitor.log()
               │   └─ onDone → SessionStore.save() + StreamRenderer.endStreaming()
               └─ 服务器双写: SessionStore.save()
```

### 7.2 实时事件流

```
Gateway WS 事件
    ↓
ws-client.js (emitter)
    ↓
server.js 事件监听
    ├→ sseManager.broadcast() → 前端 WsBridge (SSE /api/events)
    └→ sessionSync.onSubagentGatewayEvent() → 文件轮询同步
```

### 7.3 Agent 创建流程

```
AgentModal._collectAndSave()
    → Api.createAgent(data)
        → POST /api/agents
            → agent-routes.createAgent()
                ├─ 生成 ID + 创建工作区
                ├─ 写入 AGENTS.md
                ├─ 加入 allowAgents 白名单
                ├─ store.writeConfig(data)
                ├─ rosterSync.syncAllRosters()
                └─ 返回 { success: true, id }
```

### 7.4 配置变更同步

```
openclaw.json 文件变更
    ↓
server.js fs.watch (1 秒防抖)
    ├→ rosterSync.syncAllRosters()    ← 同步所有花名册
    ├→ agentRoutes.invalidateCache()  ← 清除 Agent 缓存
    └→ sseManager.broadcast({ type: 'agents-updated' }) ← 通知前端
```

---

## 8. API 接口文档

### 基础接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查（代理到 Gateway `/v1/models`） |
| GET | `/api/events` | SSE 事件流 |
| POST | `/api/upload` | 文件上传 |

### Agent 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/agents` | Agent 列表 |
| POST | `/api/agents` | 创建 Agent |
| GET | `/api/agents/:id` | Agent 详情 |
| PUT | `/api/agents/:id` | 更新 Agent |
| DELETE | `/api/agents/:id` | 删除 Agent |
| GET | `/api/agents/:id/agents-md` | 获取 Agent 的 AGENTS.md |
| PUT | `/api/agents/:id/agents-md` | 更新 Agent 的 AGENTS.md |
| DELETE | `/api/agents/:id/bootstrap` | 删除 Agent 的 BOOTSTRAP.md |
| GET | `/api/agents/:id/skills` | 获取 Agent 技能列表 |
| POST | `/api/agents/:id/skills` | 绑定/解绑技能（`action: bind/unbind`） |
| PUT | `/api/agents/:id/skills` | 同步技能列表 |

### 技能接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/skills` | 全局技能列表 |
| DELETE | `/api/skills/:id` | 删除技能 |

### 模型接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/models` | 可用模型列表 + 默认模型 |
| PUT | `/api/models/default` | 更新默认模型 |

### 会话接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/sessions` | 会话列表 |
| GET | `/api/sessions/:id` | 获取会话详情 |
| POST | `/api/sessions` | 创建会话 |
| PUT | `/api/sessions/:id` | 保存会话 |
| DELETE | `/api/sessions/:id` | 删除会话 |
| GET | `/api/sessions/:id/sync` | 同步 Gateway 消息 |

### 配置接口（Setup 模式）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/setup` | 保存配置 |
| POST | `/api/setup/detect` | 自动检测 OpenClaw 配置路径 |
| POST | `/api/setup/verify` | 验证配置路径有效性 |

### Gateway 代理

| 方法 | 路径 | 说明 |
|------|------|------|
| * | `/v1/*` | 代理到 OpenClaw Gateway |

---

## 9. 状态管理体系

### 单向数据流

```
用户操作 / API 响应 / SSE 事件
         ↓
   State.setState(partial)
         ↓
   状态更新 + 事件触发
         ↓
   组件监听事件 → 重新渲染
```

### 事件名映射

| 状态变更 | 触发事件 | 监听组件 |
|----------|----------|----------|
| Agent 列表变更 | `agent-list` | AgentList |
| 当前 Agent 切换 | `agent-switch` | AgentList, WelcomeView |
| 交互模式切换 | `mode-switch` | — |
| 会话列表变更 | `session-list` | SessionList |
| 当前会话切换 | `session-switch` | SessionList |
| 流式状态变更 | `streaming` | InteractionBindings |
| 消息列表变更 | `messages` | — |
| 连接状态变更 | `connection` | — |
| 模型列表变更 | `model-list` | ModelSwitcher |
| 弹窗状态变更 | `modal` | AgentModal |
| 筛选条件变更 | `filter` | SessionList |
| 滚动状态变更 | `scroll` | — |

---

## 10. 安全机制

| 安全措施 | 实现位置 | 说明 |
|----------|----------|------|
| XSS 防护 | `render.js` | DOMPurify sanitize 所有 Markdown 输出 |
| 上传安全 | `routes.js` | 文件扩展名白名单 + 10MB 大小限制 |
| 路径遍历防护 | `routes.js` | `_safeSessionId()` 校验，拒绝 `/`、`\`、`..` |
| URL 解码校验 | `routes.js` | 路径参数 `decodeURIComponent` 后再校验 |
| 请求体限制 | `server.js` | `MAX_BODY_SIZE = 10MB`，超出返回 413 |
| 静态文件路径检查 | `server.js` | `serveStatic()` 校验文件路径在允许范围内 |
| 工作区清理安全 | `fs-store.js` | `_isPathWithinAllowedRoots()` 校验路径 |
| Gateway 认证 | `proxy.js` | 自动注入 `Authorization: Bearer <token>` |

---

## 11. 项目运行方式

### 前置条件

1. **Node.js** >= 18（推荐 LTS）
2. **OpenClaw** 已安装并配置（`npm install -g openclaw`）
3. **OpenClaw 配置文件** 存在（至少配置一个 Agent）

### 一键启动（推荐）

```powershell
# Windows: 双击 shrift.bat 或运行
.\start.ps1
```

启动脚本自动完成：

1. 设置 `OPENCLAW_STATE_DIR` 环境变量
2. 检测并启动 Gateway（端口 18789）
3. 等待 Gateway 就绪（轮询 `/v1/models`，最长 60 秒）
4. 检测并启动 Web UI（端口 3001）
5. 等待 Web UI 就绪（轮询 `/api/health`，最长 15 秒）
6. 自动打开浏览器 `http://localhost:3001`

### 手动启动

```bash
# 终端 1：启动 Gateway
openclaw gateway --port 18789 --verbose

# 终端 2：启动 Web UI
node server.js
```

### 首次配置

首次启动时自动进入 Setup 模式（`setup.html`），引导用户：

1. 自动检测 OpenClaw 配置文件位置
2. 手动输入路径后验证
3. 保存配置后自动进入主界面

### 停止服务

```powershell
.\stop.ps1    # 或双击 stop.bat
```

---

## 12. 配置说明

### config.json

```json
{
  "port": 3001,
  "gatewayUrl": "http://127.0.0.1:18789",
  "gatewayToken": "hermes-local-dev",
  "openclawConfigPath": ""
}
```

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `port` | Web UI 监听端口 | 3001 |
| `gatewayUrl` | Gateway 地址 | `http://127.0.0.1:18789` |
| `gatewayToken` | Gateway 认证 Token | `hermes-local-dev` |
| `openclawConfigPath` | openclaw.json 文件路径 | 空（自动探测） |

### 环境变量

| 变量 | 说明 |
|------|------|
| `OPENCLAW_CONFIG_PATH` | OpenClaw 配置文件路径（优先级最高） |
| `OPENCLAW_STATE_DIR` | OpenClaw 数据目录 |
| `PORT` | Web UI 端口（覆盖 config.json） |
| `APPDATA` | Windows 应用数据目录（用于自动探测） |

---

## 13. 架构原则与设计哲学

### 核心原则

1. **真理源自一处** — `State.js` 是唯一状态管理中心，`State.setState()` → 事件通知 → 组件响应，单向数据流
2. **高内聚、低耦合** — 一个文件只做一件事，组件不直接操作其他组件 DOM
3. **绝不硬编码** — 所有动态内容从单一数据源派生，禁止在代码中硬编码技能命令、Agent 列表等
4. **契约设计** — 模块间交互通过明确契约（接口签名、事件格式、数据结构）
5. **退化安全** — 任何外部依赖都可能失败，必须有 fallback

### 技术约束

- 全部使用 `const/let`（零 `var`）
- 所有异步回调和 session 操作必须 try-catch 包裹
- 修改 `State.setState` 的字段必须检查所有引用文件
- `chat-view.js` 是核心但最脆弱的文件，改之前先画依赖图
- 会话框 UI 设计已冻结，修改需与用户确认

### 设计模式

| 模式 | 应用 |
|------|------|
| 观察者模式 | `State.on/off/_emit` 事件系统 |
| 代理模式 | `proxy.js` 代理 Gateway 请求 |
| 委托模式 | `ChatView` 委托 `ChatController` 处理业务逻辑 |
| 双写模式 | `SessionStore` 同时写入 localStorage 和服务器 |
| 缓存模式 | `agent-routes.js` 30 秒 Agent 列表缓存，`render.js` LRU Markdown 缓存 |
| 降级模式 | WS 订阅失败→HTTP 轮询，目录不可写→fallback 路径 |

---

## 14. 已知踩坑经验

> 详细踩坑记录请参见 [project_rules.md](file:///f:/fzz-Project/openclaw-web-ui/.trae/rules/project_rules.md)，以下为关键摘要：

| # | 问题 | 根因 | 教训 |
|---|------|------|------|
| 1 | 环境变量为空时路径计算错误 | `path.dirname("")` 返回 `"."` | 空字符串是 falsy，路径计算前必须检查 |
| 2 | fs-store 闭包变量不更新 | `init("")` 时 SESSIONS_DIR 未设置 | 模块闭包变量只在 init() 时设置一次 |
| 3 | 绕过模块直接写文件 | 在 server.js 中用 fs.writeFileSync 绕过 store | 绕过模块 = 违反"真理源自一处" |
| 4 | PowerShell 5.1 兼容性 | `?.`、`$IsWindows` 在 PS 5.1 不支持 | Windows 默认 PS 是 5.1，不是 7 |
| 5 | Start-Job 进程被清理 | 作业与脚本生命周期绑定 | 持久进程用 `Start-Process` |
| 6 | Session ID 路径遍历 | 用户输入直接拼接文件路径 | 所有用户路径参数必须校验 |
| 7 | 调试时死磕 | 未从执行路径倒推根因 | 第一性原理 + 逻辑推理，从结果倒推 |
| 8 | Start-Process EPERM | Windows 文件权限差异 | 不能假设目录可写，必须有 fallback |
| 9 | URL 编码绕过安全检查 | `%5C` 未解码即校验 | HTTP 路径参数必须 `decodeURIComponent` |
| 10 | 硬编码技能命令 | AGENTS.md 中手动写入技能 | 绝不硬编码动态内容 |
| 11 | 配置校验失败导致 Gateway 无法启动 | 未知字段 + 引用不存在 Agent | Gateway schema 严格校验，升级后必须验证 |
