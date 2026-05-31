# OpenClaw Web UI 助理 — 项目完整进度文档

> 本文档是项目上下文的唯一来源。任何新会话的 AI 助手必须先完整阅读本文档再开始工作。

---

## 一、产品定义

### 产品名称
OpenClaw Web UI 助理

### 核心定位
主从架构多 Agent 对话平台。用户通过主助理进行日常对话，遇到特定领域问题时通过 `@助手名` 召唤专属子 Agent，获得独立、专业的响应或行动。

### 用户第一性原理
用户希望获得一种**独立的体验**——日常问题由主 Agent 处理；遇到特殊难题时，需要一个专属专家，能提供专业指导，甚至直接行动（写文件、修 bug、写代码、撰文、发布内容）。

### 核心设计原则（用户反复强调，不可违反）
1. **先讨论再动手**——不要上来就改代码，先说清楚原因和方案
2. **从用户角度思考体验**——第一性原理
3. **不要写死代码**——保持灵活性
4. **组件化原子化**——可复用、可组合
5. **路由不应该是 LLM 的自由意志**——应该是明确的、可复现的决策点
6. **稳定第一**——不稳定的产品没有意义

---

## 二、技术路线决策

### 已放弃：Hermes 框架

**放弃原因**：
1. **稳定性不可控**：Hermes Gateway（8648端口）频繁拒绝连接，根因是 Hermes 自身 skills_sync.py 的原子写入机制在进程异常退出时残留 .tmp 文件，导致 Gateway 启动卡死。这不是我们的代码导致的，我们无法修复。
2. **架构天花板**：API 模式下子 Agent 只是换 instructions（角色切换），不是独立实例。toolsets 不可自定义，所有请求使用全量工具集。每次 @子Agent 都是全新对话，无跨会话记忆。
3. **黑盒依赖**：核心逻辑依赖 Hermes API Server，没有控制权，出了问题只能手动删文件、重启。

### 当前选择：OpenClaw

**选择原因**：
1. **SubAgent 机制**：独立工作区 + 独立 SOUL.md + 独立工具策略 + 独立记忆，从架构层面保证子 Agent 独立性
2. **Skills 系统**：每 Agent 独立 Skills 目录，三层加载（内置→托管→工作区），门控机制
3. **记忆系统**：每 Agent 独立 memory/ + 向量搜索 + 自动记忆刷新
4. **显式主从调用**：sessions_spawn 是程序化调用，不是 LLM 自由意志
5. **稳定性**：有 openclaw doctor 诊断、严格配置验证、模型故障转移、健康检查
6. **国产模型支持**：DeepSeek/Qwen/GLM 等原生支持
7. **HTTP/WebSocket API**：可对接自定义 Web UI

### 调研参考链接
- OpenClaw 官网：https://openclawlab.com/zh-cn/docs/
- OpenClaw GitHub：https://github.com/openclaw/openclaw
- SubAgent 文档：https://openclawlab.com/zh-cn/docs/tools/subagents/
- 多 Agent 路由：https://openclawlab.com/zh-cn/docs/concepts/multi-agent/
- Skills 系统：https://openclawlab.com/zh-cn/docs/tools/skills/
- 记忆系统：https://openclawlab.com/zh-cn/docs/concepts/memory/
- HTTP API：https://openclawlab.com/zh-cn/docs/reference/http-api/
- OpenAI 兼容接口：https://openclawlab.com/zh-cn/docs/gateway/openai-http-api/
- Gateway 协议：https://openclawlab.com/zh-cn/docs/gateway/protocol/
- 国产模型接入：https://openclawlab.com/zh-cn/docs/providers/china/
- 多 Agent 沙箱与工具：https://openclawlab.com/zh-cn/docs/tools/multi-agent-sandbox-tools/
- Agent 运行时：https://openclawlab.com/zh-cn/docs/concepts/agent/
- Agent 循环：https://openclawlab.com/zh-cn/docs/concepts/agent-loop/
- 会话工具：https://openclawlab.com/zh-cn/docs/concepts/session-tool/
- 配置参考：https://openclawlab.com/zh-cn/docs/gateway/configuration/
- Windows 安装：https://openclawlab.com/zh-cn/docs/platforms/windows/
- WebChat：https://openclawlab.com/zh-cn/docs/web/webchat/

---

## 三、当前环境

### 已安装软件

| 软件 | 版本 | 位置 |
|------|------|------|
| Node.js | v24.16.0 | D:\nodejs\ |
| npm | 11.13.0 | D:\nodejs\ |
| Claude Code | 最新 | D:\nodejs\npm-global\ |
| OpenClaw | 2026.5.19 | D:\nodejs\npm-global\ |

### OpenClaw 配置

| 项目 | 值 |
|------|------|
| 配置文件 | D:\AppData\openclaw\openclaw.json |
| 数据目录 | D:\AppData\openclaw\（通过 OPENCLAW_STATE_DIR 环境变量） |
| npm 缓存 | D:\AppData\npm-cache\ |
| Gateway 端口 | 18789 |
| Gateway 认证 | token 模式，token = hermes-local-dev |
| 默认模型 | deepseek/deepseek-chat |
| DeepSeek API Key | sk-8015c8cbaf22479ab3bdc3c75a4a8d50 |
| HTTP API | 已启用（chatCompletions） |
| WebSocket | 已启用，protocol v4 |
| 控制台安全 | allowInsecureAuth + dangerouslyDisableDeviceAuth（开发阶段） |
| 允许来源 | allowedOrigins: ["*"]（开发阶段） |

### 已配置的 Agent

| Agent ID | 名称 | 工作区 | 头像 | 可 spawn 子 Agent |
|----------|------|--------|------|-------------------|
| main | 虾指挥 | ~/.openclaw/workspace | /logo.svg | jobs, mrbeast, ppt 等 |
| jobs | 乔布斯 | ~/.openclaw/workspace-jobs | avatars/male-james.svg | — |
| mrbeast | MrBeast | ~/.openclaw/workspace-mrbeast | avatars/male-michael.svg | — |
| ppt | 小王 | ~/.openclaw/workspace-ppt | avatars/male-james.svg | — |

### 环境变量（已设置，用户级永久）

| 变量 | 值 |
|------|------|
| OPENCLAW_STATE_DIR | D:\AppData\openclaw |

### 启动命令

```powershell
# 启动 Gateway（必须在普通终端，不能在 TRAE 内）
$env:OPENCLAW_STATE_DIR = 'D:\AppData\openclaw'
openclaw gateway --port 18789 --verbose

# 测试对话（嵌入式模式，TRAE 内可用）
$env:OPENCLAW_STATE_DIR = 'D:\AppData\openclaw'
$env:OPENCLAW_GATEWAY_TOKEN = 'hermes-local-dev'
openclaw agent --agent main --message "你好"
```

### 用户磁盘使用原则
- **C 盘**：仅系统绝对必要的文件，已写入的通过符号链接挪到 F:\Links_F
- **D 盘**：高频数据（程序、AppData）
- **F 盘**：低频数据（项目代码、文档）

---

## 四、旧项目文件（归档参考，不再修改）

### 位置
F:\fzz-Project\claude-ui\hermes\

### 关键文件清单

| 文件 | 说明 |
|------|------|
| hermes\core\server.py | 旧后端服务，含 Gateway 检测逻辑和 WS 处理 |
| hermes\core\engine.py | 旧核心引擎，含 _build_delegate_context 子Agent上下文构建 |
| hermes\core\store.py | 旧数据持久化层，含首条消息自动命名逻辑 |
| hermes\core\config.py | 旧配置层，端口 20766/8648 |
| hermes\core\static\js\components\chat-view.js | 旧前端聊天视图 |
| hermes\core\static\js\api.js | 旧前端 API 通信层 |
| hermes\core\static\js\state.js | 旧响应式状态管理 |
| hermes\core\static\js\controllers\session-manager.js | 旧会话管理 |
| hermes\core\static\js\controllers\event-router.js | 旧事件路由+前端重试 |
| hermes\core\static\css\style.css | 旧样式（设计师已优化） |
| hermes\core\static\images\logo.png | 设计师添加的 logo |
| hermes\agents.json | Agent 定义（乔布斯、MrBeast 等） |
| hermes\scripts\cleanup_and_start.ps1 | 手动清理+启动脚本 |
| hermes\scripts\启动.bat | 一键启动脚本 |

### 旧项目已完成的改动（供参考，不需要再改）

1. 会话标题"新对话"→首条消息自动命名
2. _build_delegate_context 只传用户消息，不传助理回复
3. 修复 isNew is not defined 错误
4. sendChat 新增 sessionName 参数
5. _ensure_gateway() 改为仅检测+日志提示
6. 新增 /images/{name} 路由
7. Gateway 缓存排查（根因：Hermes 自身 .tmp 文件残留）

---

## 五、核心验证结果（2026-05-22 亲手验证）

### ✅ 已验证通过

| 测试项 | 结果 | 说明 |
|--------|------|------|
| 多 Agent 配置 | ✅ 通过 | openclaw agents list 正确显示 main/jobs/mrbeast |
| 主 Agent HTTP API 对话 | ✅ 通过 | POST /v1/chat/completions, Status 200, 正常回复 |
| 子 Agent HTTP API 对话 | ✅ 通过 | x-openclaw-agent-id: jobs, 回复体现乔布斯风格 |
| HTTP API 流式输出（SSE） | ✅ 通过 | stream: true, Content-Type: text/event-stream, delta 模式与 OpenAI 兼容 |
| sessions_spawn 子 Agent 调用 | ✅ 通过 | 主 Agent 成功 spawn jobs 子 Agent，子 Agent 独立运行 |
| WebSocket 连接 + 认证 | ✅ 通过 | protocol v4, connect 成功, health 查询正常 |
| Gateway 健康检查 | ✅ 通过 | 3 个 Agent 全部在线, event loop 正常 |

### ⚠️ 重要发现

1. **子 Agent 上下文只注入 AGENTS.md + TOOLS.md**
   - SOUL.md / IDENTITY.md / USER.md 不会被注入子 Agent
   - **对策**：人设信息必须放在 AGENTS.md 中，不能只放在 SOUL.md
   - 这意味着子 Agent 的"独立身份感"主要靠 AGENTS.md 中的指令实现

2. **Gateway 必须从普通终端启动**
   - TRAE 沙盒会阻止 Gateway 写入 D:\AppData\openclaw\ 下的文件
   - 导致 HTTP API 返回 500（EBADF: bad file descriptor）
   - **对策**：用户需在普通 PowerShell 终端启动 Gateway

3. **sessions_spawn 是非阻塞的**
   - HTTP API 的 chat/completions 请求中，spawn 立即返回 `{ status: "accepted" }`
   - 子 Agent 结果通过通告步骤异步回传，不在同一 HTTP 响应中
   - **前端设计影响**：需要 WebSocket 接收子 Agent 的异步结果，纯 HTTP API 无法获取

4. **WebSocket connect 参数要求严格**
   - 必须指定 minProtocol: 4, maxProtocol: 4
   - client.mode 枚举值：["backend", "cli", "node", "probe", "test", "ui", "webchat"]
   - 开发阶段需要 gateway.controlUi.allowInsecureAuth + dangerouslyDisableDeviceAuth
   - 需要 gateway.controlUi.allowedOrigins: ["*"]

5. **HTTP API 默认禁用**
   - 必须在配置中设置 gateway.http.endpoints.chatCompletions.enabled: true

### 三大核心问题状态更新

| 问题 | 旧状态 | 新状态 | 说明 |
|------|--------|--------|------|
| A: 子 Agent 回复缺乏独立感 | 待实施 | ⚠️ 部分解决 | sessions_spawn 可独立运行子 Agent，但人设只通过 AGENTS.md 注入，需精心编写 |
| B: Skills 绑定未接入执行层 | 待实施 | ✅ 架构就绪 | 每 Agent 独立 workspace/skills/ 已配置，待编写具体 Skills |
| C: 子 Agent 无独立记忆 | 待实施 | ✅ 架构就绪 | 每 Agent 独立工作区已创建，记忆系统待启用 |

---

## 六、下一步工作计划

### 阶段 1：完善多 Agent 配置（优先级最高）

1. ~~在 openclaw.json 中配置多个 Agent~~ ✅ 已完成
2. ~~测试 sessions_spawn 子 Agent 调用~~ ✅ 已完成
3. 为每个子 Agent 编写完善的 AGENTS.md（人设必须在这里）
4. 启用记忆系统
5. 测试跨会话记忆持久化

### 阶段 2：Web UI 对接

1. 改造前端 api.js，对接 OpenClaw HTTP API（/v1/chat/completions）
2. 实现 WebSocket 实时通信（接收子 Agent 异步结果）
3. 实现 @agent_name 交互逻辑 → 前端解析后通过 x-openclaw-agent-id 路由
4. 适配流式输出（SSE delta 模式）
5. 适配会话管理

### 阶段 3：Skills 和记忆

1. 为每个 Agent 配置专属 Skills
2. 深度测试记忆系统
3. 验证子 Agent 跨会话记忆独立性

---

## 七、OpenClaw 关键技术要点（新助手必读）

### SubAgent 调用流程
```
用户: @乔布斯 帮我看看这个设计
  ↓
主Agent 解析 @乔布斯 → sessions_spawn({ task: "...", agentId: "jobs" })
  ↓
子Agent "jobs" 在独立会话中运行（独立工作区/工具/记忆）
  ↓
子Agent 完成后通过通告步骤（Announce）回传结果
  ↓
主Agent 聊天频道呈现结果
```

### ⚠️ 子 Agent 上下文注入规则
- **会注入**：AGENTS.md + TOOLS.md
- **不会注入**：SOUL.md / IDENTITY.md / USER.md / HEARTBEAT.md / BOOTSTRAP.md
- **对策**：子 Agent 的人设、风格、角色指令必须写在 AGENTS.md 中

### WebSocket connect 参数（已验证）
```json
{
  "type": "req", "id": "1", "method": "connect",
  "params": {
    "auth": { "token": "hermes-local-dev" },
    "role": "operator",
    "minProtocol": 4, "maxProtocol": 4,
    "client": { "id": "cli", "version": "1.0.0", "platform": "web", "mode": "webchat" },
    "scopes": ["operator.read", "operator.write"],
    "caps": [], "commands": [], "permissions": {},
    "locale": "zh-CN",
    "userAgent": "openclaw-web-ui/1.0.0"
  }
}
```

### OpenAI 兼容 HTTP API
- POST /v1/chat/completions
- 选择 Agent：x-openclaw-agent-id: <agentId> 或 model: "openclaw:<agentId>"
- 认证：Authorization: Bearer hermes-local-dev
- 流式：stream: true, 返回 SSE (text/event-stream)
- 需要在配置中启用：gateway.http.endpoints.chatCompletions.enabled: true

### 工具策略分层（单向收窄）
全局 → Agent → 沙箱 → 子Agent，每层只能进一步限制，不能恢复之前拒绝的工具

### 子 Agent 限制
- 不能再 spawn 子 Agent（防递归）
- 默认不获得会话工具（sessions_list/send/spawn）
- 结果通过通告步骤回传，不是直接输出
- cleanup 默认 keep，archiveAfterMinutes 默认 60

---

## 八、旧项目的 Agent 定义（迁移参考）

```json
{
  "agents": [
    {
      "name": "乔布斯",
      "instructions": "你是史蒂夫·乔布斯...",
      "emoji": "🍎"
    },
    {
      "name": "MrBeast",
      "instructions": "你是 MrBeast...",
      "emoji": "💰"
    }
  ]
}
```

迁移到 OpenClaw 后，每个 Agent 的人设信息**必须写在 AGENTS.md 中**（因为子 Agent 上下文只注入 AGENTS.md + TOOLS.md）：
- AGENTS.md — 人设、风格、角色指令（子 Agent 唯一能读到的文件）
- SOUL.md — 人设补充（仅主 Agent 直接对话时生效）
- memory/ — 记忆目录

---

## 九、注意事项

1. **不要修改 F:\fzz-Project\claude-ui\hermes\ 下的任何文件**——那是旧项目，归档参考
2. **新工作空间在 F:\fzz-Project\openclaw-web-ui\**——所有新代码写在这里
3. **OpenClaw 数据在 D:\AppData\openclaw\**——配置、工作区、会话、记忆
4. **C 盘零写入原则**——除非系统绝对必要
5. **先讨论再动手**——用户反复强调的核心原则
6. **每次启动 Gateway 前需要设置环境变量**：$env:OPENCLAW_STATE_DIR = 'D:\AppData\openclaw'
7. **Gateway 认证 token**：hermes-local-dev，前端连接时需要带上
8. **Gateway 必须从普通终端启动**——TRAE 沙盒会阻止文件写入导致 HTTP API 500
9. **子 Agent 人设必须写在 AGENTS.md**——SOUL.md 不会被注入子 Agent 上下文
10. **sessions_spawn 是非阻塞的**——前端需要 WebSocket 接收异步结果

---

## 十、最新会话工作记录（2026-05-31）

### 1. 头像系统清理（emoji→SVG）

| 问题 | 改动 | 文件 |
|------|------|------|
| `'🤖'` 硬编码 4 处 | 替换为 SVG 池分配或名字首字 | `utils.js`, `agent-list.js`, `welcome-view.js` |
| `normalizeAgents` 的 `id === 'main'` 特殊处理 | 去除，所有 agent 一视同仁 | `utils.js` |
| `renderAgentAvatar` 默认 emoji 回退 | 空头像 → 名字首字 | `utils.js` |
| `_getAgentLabel` 中多余的 emoji 检测分支 | 简化，直接返回首字 | `session-list.js` |
| 团队成员列表显示 emoji（如 `🍎 乔布斯`） | `_extractTeamFromMd` 解析时自动去掉前置 emoji | `agent-routes.js` |
| 主 Agent 头像 | 通过 `PUT /api/agents/main` 存为 `/logo.svg`，无需硬编码 | API 存储 |

### 2. 核心架构排查与修复（@直连 + 智能调度）

| 级别 | 问题 | 修复 | commit |
|------|------|------|--------|
| P0 | `const actualAgentId` agent 切换时 TypeError | `const`→`let`，允许回调中重新赋值 | `978d961` |
| P0 | session 回放丢失 dispatch 子 Agent 标签 | `announces[{agentId, content}]` 结构化存储，回放渲染为 DOM 块 | `c1c4013` |
| P1 | dispatch 超时 15s 过早关闭 + 120s 不足 | 30s 检查完成 / 300s 强制超时；新增 `_resetDispatchSafetyTimer` 活动保活 | `3f6b09f` |
| P2 | `chat-update` 空事件监听消耗带宽 | 删除无函数体的空监听 | `cf2ddd0` |
| P3 | `session-sync` 子 Agent 高频 `session.tool` 事件风暴 | 过滤含 `:subagent:` 的 tool/agent 事件 | `ac7887b` |
| P3 | `virtual-list.js` 降级渲染统一标 `'AI'` | 改为使用 `message.agentId` 首字符 | `6d4cadb` |

### 3. UI 修复

| 问题 | 修复 |
|------|------|
| 气泡内标题字号过大（h1=30px） | 气泡内 h1-h6 加上比例字号（h1=1.2em~h6=0.9em） |

### 可回滚基线

```bash
git reset --hard 2c053fd
```

### 当前服务状态

| 服务 | 端口 | 状态 |
|------|------|------|
| Web UI 服务器 | localhost:3001 | ✅ 运行中 |
| OpenClaw Gateway | 127.0.0.1:18789 | ✅ 运行中 |

### 启动方式

```powershell
# Gateway（必须在普通终端，TRAE 外）
openclaw gateway

# Web UI（TRAE 内）
cd F:\fzz-Project\openclaw-web-ui\; node server.js
```

### 后续待验证

1. @子Agent 直连路径 — `onAgentSwitch` 回调正常
2. 智能调度路径 — announce 结构化存储 + 回放渲染
3. dispatch 长任务 — 安全定时器不再提前关闭
4. 新 session 回看 — announces 渲染为 `bubble-content-block`
