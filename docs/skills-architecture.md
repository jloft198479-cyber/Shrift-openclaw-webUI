# OpenClaw Web UI — 技能系统架构与工作记录

> 文档日期：2026-05-27
> 本文档记录技能绑定链路修复、回退机制实现、以及项目整体架构说明

---

## 一、项目概述

**OpenClaw** 是一个本地 AI Agent 网关系统，核心架构是**主从式多 Agent 协作**：

- **Gateway**（端口 18789）：本地 AI 网关，管理所有 agent 的生命周期、会话、技能加载，通过 HTTP SSE + WebSocket 通信
- **Web UI**（端口 3001）：前端界面，通过代理层与 Gateway 交互
- **主 Agent**（id: `main`）：协调者，负责理解用户意图、分发任务给子 agent
- **子 Agent**：技能容器，每个有独立人设、独立 workspace、独立技能绑定

**核心产品定位**：子 agent 是**可调用的技能容器**，人设只是外壳，技能才是核心。用户 @子 agent 时在主会话中临时委托任务，不切换到私聊模式。

---

## 二、Agent 协作机制

### 2.1 直连路由（Direct Agent Routing）

用户在主会话中 `@子agent` 时：

```
用户输入 "@乔布斯 帮我分析一下这个产品"
  → mention-completer.js 设置 State.pendingDelegation = { agentId: 'jobs', agentName: '乔布斯' }
  → 显示 delegate-badge "委托给 乔布斯"
  → 用户输入任务后按 Enter
  → chat-view.js sendMessage() 读取 pendingDelegation.agentId
  → api.js chat() 发送请求，带 x-openclaw-agent-id: jobs + x-openclaw-session-key: agent:jobs:webui
  → proxy.js 转发到 Gateway
  → Gateway 直连 jobs agent，SSE 流式返回
  → 回复显示在主会话中，标记为 [乔布斯 said]
```

**关键设计**：不切换 currentAgent，不进入私聊模式。pendingDelegation 是一次性消费，发送后立即清除。

### 2.2 主 Agent 派任务（sessions_spawn）

主 agent 通过内置工具 `sessions_spawn` 异步派任务：

```
用户："让 PPT agent 帮我做一个关于月球的演示"
  → 主 agent 调用 sessions_spawn(agentId: "ppt", task: "Create a 1-slide HTML presentation about the moon")
  → Gateway 创建子 agent 的独立 session，非阻塞
  → 子 agent 在自己的 session 中执行任务
  → 完成后结果注入主 agent session（announce 机制）
```

### 2.3 两种路径的区别

| 维度 | 直连路由（@mention） | sessions_spawn |
|------|---------------------|----------------|
| 触发方式 | 用户主动 @ | 主 agent 自动判断 |
| 阻塞性 | 同步等待回复 | 非阻塞，后台执行 |
| 上下文 | 复用主会话消息历史 | 子 agent 独立 session |
| 额外 token 消耗 | 零（直连，无 announce） | 有 announce 回传开销 |
| 技能可用性 | ✅ 已验证可用 | ✅ 已验证可用 |

---

## 三、技能（Skills）系统原理

### 3.1 技能是什么

技能是 `SKILL.md` 文件定义的可扩展能力，与内置工具（tools）不同：

- **工具（tools）**：Gateway 内置能力，如 `web_search`、`exec`、`file_write`，所有 agent 自动拥有
- **技能（skills）**：SKILL.md 定义的可扩展能力，需要绑定到 agent 才可见，按需加载

### 3.2 技能加载的 6 个源（优先级从高到低）

| 优先级 | 源 | 路径 | 可见范围 |
|--------|---|------|----------|
| 1 | Workspace skills | `<workspace>/skills` | 仅该 agent |
| 2 | Project agent skills | `<workspace>/.agents/skills` | 仅该 workspace |
| 3 | Personal agent skills | `~/.agents/skills` | 所有 agent |
| 4 | **Managed/local skills** | **`~/.openclaw/skills`** | **所有 agent** |
| 5 | Bundled skills | 随安装包发布 | 所有 agent |
| 6 | Extra skill folders | `skills.load.extraDirs` | 所有 agent |

**我们的方案**：技能统一安装到 `~/.openclaw/skills/`（优先级4），通过 `openclaw.json` 的 `skills` 数组控制每个 agent 可见哪些技能。

### 3.3 技能两阶段加载

1. **阶段1（菜单注入）**：session 启动时，Gateway 将 agent 允许的技能以紧凑 XML 列表注入 system prompt，每技能约 97 字符 + 名称/描述
2. **阶段2（内容加载）**：agent 决定使用技能时，Gateway 加载完整 SKILL.md 内容到上下文

### 3.4 skills 数组过滤机制

```json
{
  "agents": {
    "defaults": {
      "skills": ["github", "weather"]
    },
    "list": [
      { "id": "writer" },
      { "id": "docs", "skills": ["docs-search"] },
      { "id": "locked-down", "skills": [] }
    ]
  }
}
```

规则：
- 省略 `agents.defaults.skills` → 默认不限制
- 省略 `agents.list[].skills` → 继承 defaults
- 设置 `agents.list[].skills: []` → 无技能
- **非空 skills 数组是最终集合，不与 defaults 合并**

### 3.5 当前技能注册情况

全局注册目录 `C:\Users\fzz198479\.openclaw\skills\` 下 8 个技能：

| 技能 | 绑定 agent |
|------|-----------|
| web-search | jobs, mrbeast, agent-mpls0tivyzea |
| zhihu-search | agent-mpls0tivyzea |
| md2wechat | agent-mpls0tivyzea |
| html-ppt-skill | ppt |
| browser | （未绑定） |
| find-skills | （未绑定） |
| naval-perspective | （未绑定） |
| skillhub-preference | （未绑定） |

---

## 四、核心修复：技能绑定链路从断裂到贯通

### 4.1 问题

`syncSkills` 只在 workspace 目录创建 SKILL.md 文件，**不更新 `openclaw.json` 的 `skills` 数组** → Gateway 不知道技能绑定 → 技能僵死

具体断裂点：
1. `listAgents` / `getAgentDetail` 用 `scanSkills(ws)` 扫描 workspace 目录 → 返回的不是 config 中的绑定信息
2. `syncSkills` / `_doSkillAction` 在 workspace 创建/删除 SKILL.md 文件 → 不写 config
3. `createAgent` 不处理 skills 字段 → 新建 agent 时技能绑定丢失
4. `updateAgent` 不处理 skills 字段 → 编辑 agent 时技能绑定丢失
5. `listSkills` 不扫描全局 `~/.openclaw/skills/` → UI 看不到可用技能
6. `Api.updateAgent` 并行发送 PUT agents/:id 和 PUT agents/:id/skills → 两个请求都读写 openclaw.json，存在竞态条件

### 4.2 修复

所有技能操作改为读写 `openclaw.json` 的 `skills` 数组：

| 文件 | 改动 | 目的 |
|------|------|------|
| `fs-store.js` | +48 行 | 新增 `scanGlobalSkills()` 扫描 `~/.openclaw/skills/`；新增 `_buildSkillUsageSection()` 自动生成技能使用指令 |
| `agent-routes.js` | 重构 ~80 行 | `_resolveSkills()` 从 config 解析技能；`listAgents`/`getAgentDetail`/`listSkills`/`getAgentSkills` 改为读 config；`syncSkills`/`_doSkillAction` 改为写 config；`createAgent`/`updateAgent` 支持 skills 字段 |
| `api.js` | -6 行 | `updateAgent` 合并 skills 到主 PUT 请求，消除竞态条件 |

### 4.3 修复前后对比

**修复前链路**（断裂）：
```
UI 选技能 → syncSkills → 创建 workspace/skills/xxx/SKILL.md → ❌ openclaw.json 不变 → Gateway 不知道 → 技能僵死
```

**修复后链路**（贯通）：
```
UI 选技能 → updateAgent(含skills) → 更新 openclaw.json skills 数组 → Gateway 读取 → 技能生效
```

---

## 五、技能回退机制：工具失败时自动寻找替代

### 5.1 问题

咪蒙 agent 在 `web_search` 超时后直接回答"无法搜索"，没有回退到 `zhihu-search.py` 脚本。

### 5.2 根因

1. SKILL.md 触发器只写了"知乎"关键词，没写"web_search 失败时回退"
2. AGENTS.md 缺少通用技能使用指令
3. agent 把工具和技能当独立能力，没意识到后者是前者的回退

### 5.3 修复：三层防御

| 层 | 机制 | 修改内容 |
|---|---|---|
| 1 | SKILL.md 回退触发器 | zhihu-search 新增"回退触发"段：web_search 超时/失败/空结果时必须使用 zhihu-search.py |
| 2 | SKILL.md 回退触发器 | web-search 新增"回退触发"段：内置 web_search 工具失败时必须使用脚本回退 |
| 3 | AGENTS.md Skill Usage Rules | `_buildSkillUsageSection()` 在 roster sync 时自动注入：工具失败必须检查技能、绝不能因工具失败放弃、技能脚本调用方式、绑定技能列表 |

### 5.4 Skill Usage Rules 自动注入机制

`fs-store.js` 中的 `_buildSkillUsageSection()` 函数：

- 读取 agent 的 skills 数组
- 如果有技能绑定，生成 "Skill Usage Rules" 段
- 在 `syncSubAgentRoster()` 时自动追加到 AGENTS.md
- `_extractSection()` 确保每次 sync 时旧段被替换，不会重复

注入内容示例（咪蒙 agent）：
```
## Skill Usage Rules

You have the following skills bound to you. When a built-in tool fails, you **MUST** check if a skill script can accomplish the same task before giving up.

General fallback rules:
- If `web_search` times out or fails, use a search skill script as fallback
- If any built-in tool returns an error, check your skills for an alternative approach
- **NEVER** say "I cannot search" or "I cannot do X" when you have a skill that can do it
- Skill scripts are invoked via `python skills/<skill-name>/<script>.py`

Your bound skills: web-search, zhihu-search, md2wechat
```

---

## 六、当前架构全景

### 6.1 配置与存储

```
openclaw.json (唯一真相源)
  ├── agents.list[].skills  ←── 技能绑定的唯一存储位置
  │     ├── jobs: ["web-search"]
  │     ├── mrbeast: ["web-search"]
  │     ├── ppt: ["html-ppt-skill"]
  │     └── agent-mpls0tivyzea: ["web-search", "zhihu-search", "md2wechat"]
  │
  ├── ~/.openclaw/skills/   ←── 技能的物理存储位置
  │     ├── web-search/SKILL.md
  │     ├── zhihu-search/SKILL.md
  │     ├── html-ppt-skill/SKILL.md
  │     ├── md2wechat/SKILL.md
  │     ├── browser/SKILL.md
  │     ├── find-skills/SKILL.md
  │     ├── naval-perspective/SKILL.md
  │     └── skillhub-preference/SKILL.md
  │
  └── Gateway 读取流程：
        1. 读 openclaw.json → 获取 agent 的 skills 数组
        2. 扫描 ~/.openclaw/skills/ → 匹配 SKILL.md
        3. skills 数组过滤 → 只注入允许的技能
        4. session 启动时 → XML 列表注入 system prompt
        5. agent 决定使用时 → 加载完整 SKILL.md
```

### 6.2 Web UI 技能绑定流程

```
用户编辑 agent → 点击技能标签选中/取消
  → Api.updateAgent(data) 含 skills 数组
  → PUT /api/agents/:id { name, description, avatar, model, skills: [...] }
  → agent-routes.updateAgent() 写入 openclaw.json
  → store.writeConfig() + invalidateCache() + syncAllRosters()
  → AGENTS.md 自动更新 Skill Usage Rules 段
  → Gateway watch 检测 openclaw.json 变化 → 下一个 session 生效
```

### 6.3 关键文件职责

| 文件 | 职责 |
|------|------|
| `fs-store.js` | 数据层：读写 openclaw.json、扫描技能目录、同步 roster |
| `agent-routes.js` | API 层：CRUD agent、技能绑定、模型管理 |
| `api.js` | 前端通信层：HTTP 请求封装、SSE 流处理 |
| `proxy.js` | 代理层：转发请求到 Gateway，注入 x-openclaw-agent-id 等头 |
| `mention-completer.js` | UI 层：@mention 交互、delegate-badge 显示 |
| `chat-view.js` | UI 层：消息发送、pendingDelegation 读取 |
| `agent-modal.js` | UI 层：agent 创建/编辑表单，技能标签选择 |
| `state.js` | 状态管理：pendingDelegation、agents、skills 等 |

---

## 七、测试记录

### 7.1 API 端点测试

| 测试项 | 结果 |
|--------|------|
| GET /api/skills — 8 个全局技能列出，boundAgents 正确 | ✅ |
| GET /api/agents — 每个 agent 的 skills 从 config 正确解析 | ✅ |
| PUT /api/agents/:id (含 skills) — 编辑技能绑定 | ✅ |
| PUT /api/agents/:id/skills — syncSkills 更新 config | ✅ |
| POST /api/agents (含 skills) — 创建 agent 带技能 | ✅ |
| DELETE /api/agents/:id — 删除 agent 技能自动清理 | ✅ |

### 7.2 技能调用测试

| 测试项 | 结果 |
|--------|------|
| 直连 PPT agent → 使用 html-ppt-skill 创建 cats-presentation.html | ✅ |
| 主 agent sessions_spawn → PPT agent 创建 moon-presentation.html | ✅ |
| 技能过滤：PPT 只有 html-ppt-skill，Jobs 只有 web-search | ✅ |

### 7.3 创建/编辑/删除全链路测试

| 测试项 | 结果 |
|--------|------|
| 创建 TestAgent + 绑定 [web-search, md2wechat] | ✅ |
| 编辑 TestAgent 技能为 [zhihu-search, html-ppt-skill] | ✅ |
| 删除 TestAgent | ✅ |

### 7.4 Skill Usage Rules 注入测试

| Agent | 注入结果 |
|-------|---------|
| 咪蒙 (agent-mpls0tivyzea) | ✅ "Your bound skills: web-search, zhihu-search, md2wechat" |
| 乔布斯 (jobs) | ✅ "Your bound skills: web-search" |
| PPT小王 (ppt) | ✅ "Your bound skills: html-ppt-skill" |

---

## 八、待办事项

| 项目 | 状态 | 说明 |
|------|------|------|
| 咪蒙 agent 身份未加载 | 未解决 | workspace 路径 `~/.openclaw/workspace-agent-mpls0tivyzea` 可能存在 `~` 解析问题，或 agent ID 格式（长 ID vs 短 ID）导致 Gateway workspace 解析差异 |
| 技能回退实际效果验证 | 待测试 | SKILL.md 和 AGENTS.md 的回退指令已注入，但需要实际场景验证 agent 是否会在 web_search 超时后主动调用 zhihu-search.py |
| 技能安装 UI 完善 | 未实现 | 前端 UI 已有框架（agent-modal.js 中的 skills-grid），需验证与新的 config 写入逻辑完全兼容 |

---

## 九、踩坑经验

### 9.1 技能绑定只写文件不写配置 = 技能僵死

- **现象**：UI 上选了技能，但 agent 实际调用时技能不可用
- **根因**：`syncSkills` 只在 workspace 目录创建 SKILL.md，不更新 `openclaw.json` 的 `skills` 数组，Gateway 不知道技能绑定
- **教训**：**技能绑定的唯一真相源是 `openclaw.json` 的 `skills` 数组**，不是 workspace 目录中的文件。所有技能操作必须读写 config

### 9.2 并行请求写同一配置文件 = 竞态条件

- **现象**：编辑 agent 保存后，技能绑定偶尔丢失
- **根因**：`Api.updateAgent` 并行发送 `PUT /api/agents/:id` 和 `PUT /api/agents/:id/skills`，两个请求都读写 `openclaw.json`，后者可能覆盖前者的修改
- **教训**：**同一个配置文件的写操作必须串行化**。修复：将 skills 合并到主 PUT 请求中，一次写入

### 9.3 工具失败不回退 = 另一种技能僵死

- **现象**：`web_search` 超时后 agent 直接回答"无法搜索"，不尝试技能脚本
- **根因**：SKILL.md 触发器只写了直接触发条件，没写回退触发条件；AGENTS.md 缺少通用技能使用指令
- **教训**：**技能的触发器必须包含"当 XX 工具失败时作为回退"的场景**，否则 agent 不知道何时使用技能作为替代方案

### 9.4 roster sync 可能覆盖 skills 字段

- **现象**：`syncAllRosters` 执行后，某些 agent 的 skills 被清空
- **根因**：`syncSubAgentRoster` 调用 `writeConfig` 写整个 data 对象，如果之前 readConfig 和 writeConfig 之间有其他进程修改了 config，skills 字段可能被旧值覆盖
- **教训**：**roster sync 操作应该只修改它负责的字段（Team Members、Skill Usage Rules 段），不应影响其他字段**。当前实现通过 `_extractSection` 只替换特定段，但 `writeConfig` 写整个对象，需要注意并发安全
