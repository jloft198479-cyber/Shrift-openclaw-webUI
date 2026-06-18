## Per-Session Workspace 调研报告

**日期**：2026-06-17
**状态**：调研完成，待多方评估

---

### 一、问题背景

虾指挥（openclaw-web-ui）当前的工作目录（workspace）是**全局单例**设计：所有会话共享同一个项目目录，存储在 `openclaw.json` 的 `agents.defaults.repoRoot` 字段中。

这导致的问题是：当用户切换工作目录（比如从项目 A 切到项目 B）后，**所有历史对话都"看起来"属于新项目**。用户无法像 Trae 那样——会话 1 对应项目 A，会话 2 对应项目 B，按需灵活切换。

期望行为：每个会话在创建时绑定当时的项目目录，切换历史会话时自动恢复到对应的项目上下文。

---

### 二、现状架构分析

#### 2.1 会话数据结构——不携带 workspace

`session-interaction.js` 的 `ensureSession()` 创建会话时，对象只有以下字段：

```js
const newSession = {
  id: sessionId,
  name: cleanName,
  agent: State.currentAgent || '...',
  created_at: Date.now(),
  updated_at: Date.now(),
  messages: [],
  // ← 没有 workspace 字段
};
```

后端 `fs-store.js` 的 `getSessionList()` 返回 `{ id, name, agent, tag, created_at, updated_at }`，同样不含 workspace。抽查 `sessions/` 目录下的 6 个 session JSON 文件，确认无任何 workspace 相关 key。

#### 2.2 全局 workspace 的读写

`fs-store.js` 中两个函数管理 workspace：

```js
// 读取：从 openclaw.json → agents.defaults.repoRoot
function readWorkspace() {
  var data = readConfig();
  if (!data || !data.agents || !data.agents.defaults) return '';
  return data.agents.defaults.repoRoot || '';
}

// 写入：写入 openclaw.json → agents.defaults.repoRoot
function writeWorkspace(absPath) {
  var data = readConfig();
  data.agents.defaults.repoRoot = absPath || '';
  // 清除旧版错误写入的字段
  if ('workspace' in data) delete data.workspace;
  if (data.meta && 'webuiWorkspace' in data.meta) delete data.meta.webuiWorkspace;
  return writeConfig(data);
}
```

前端 `state.js` 的 workspace 状态也是全局单例：

```js
workspace: {
  path: '',
  exists: true,
},
```

#### 2.3 workspace 如何到达 Agent

workspace 并**不直接**传给 Gateway。项目上下文通过 AGENTS.md 注入机制间接传达：

1. 用户通过 UI 设置 workspace → `PUT /api/workspace` → `routes.js` 的 `handleWorkspacePut()`
2. 写入 `agents.defaults.repoRoot`
3. 调用 `roster-sync.js` 的 `syncProjectContext()` 在 Agent 的 AGENTS.md 中注入引导段落：

```markdown
<!-- project-context-start -->
## 当前项目

项目目录（代码工作目录，非物理办公室）: F:\fzz-Project\openclaw-web-ui
执行项目相关任务时，请先读取该目录下的 AGENTS.md，遵循其中的项目规范和约定。
<!-- project-context-end -->
```

4. OpenClaw Gateway 在**会话创建时**读取 AGENTS.md，组装 system prompt——此时项目上下文固化
5. 会话中途修改 workspace，已有会话的 system prompt 不会更新（设计如此）

#### 2.4 Proxy 转发的 Headers

`proxy.js` 转发到 Gateway 的请求只携带 4 个 header：

| Header | 来源 |
|--------|------|
| `Authorization` | config.json 的 gatewayToken |
| `Content-Type` | 客户端透传 |
| `x-openclaw-agent-id` | 客户端设置 |
| `x-openclaw-session-key` | 客户端设置，格式 `agent:<id>:webui:<sessionId>` |

没有任何 workspace 相关的 header。

---

### 三、Gateway 侧调查

#### 3.1 Gateway HTTP 端点识别的 Headers

查了 Gateway 编译产物（`openclaw@2026.6.6`，`D:\nodejs\npm-global\node_modules\openclaw\dist/`），OpenAI 兼容的 `/v1/chat/completions` 端点识别的自定义 header 共 4 个：

| Header | 用途 |
|--------|------|
| `x-openclaw-agent-id` / `x-openclaw-agent` | 选择目标 agent |
| `x-openclaw-model` | 覆盖后端 LLM 模型 |
| `x-openclaw-session-key` | 设置稳定的 session key |
| `x-openclaw-message-channel` | 消息通道（默认 webchat） |

**不存在** `x-openclaw-workspace`、`x-openclaw-repo-root` 或任何 workspace 相关的 HTTP header。

#### 3.2 Gateway 内部的 workspace 解析

Gateway 的 `resolveAgentWorkspaceDir()` 解析链：

1. Per-agent config: `agents.list[].workspace`
2. Agent defaults: `agents.defaults.workspace`
3. 环境变量: `OPENCLAW_WORKSPACE_DIR`
4. 默认值: `~/.openclaw/workspace`

repoRoot 的解析链（`resolveRepoRoot()`）：

1. Config: `agents.defaults.repoRoot`（目录需存在）
2. Git root 探测（从 workspaceDir 或 cwd）
3. Fallback: undefined

#### 3.3 关键发现：内部 API 支持 workspaceDir，但 HTTP 不暴露

Gateway 内部的 `buildAgentCommandInput()` 构建的字段包括 message、sessionKey、model 等，**没有 workspaceDir**：

```js
function buildAgentCommandInput(params) {
  return {
    message, extraSystemPrompt, images, clientTools,
    model, sessionKey, runId, deliver, messageChannel,
    bestEffortDeliver, allowModelOverride, abortSignal, streamParams
    // ← 没有 workspaceDir
  };
}
```

但 agent 命令管道里确实读取 `workspaceDir`：

```js
const workspaceDirRaw = normalizedSpawned.workspaceDir
  ?? resolveAgentWorkspaceDir(cfg, sessionAgentId);
```

这个 `workspaceDir` 在子 agent spawn 时使用，说明内部机制支持 per-call workspace，只是 HTTP 端点没有暴露入口。

**结论：不改 Gateway 的情况下，无法通过请求 header 或参数实现 per-session workspace 覆盖。**

---

### 四、两个"workspace"概念辨析

系统中存在两个容易混淆的 workspace 概念：

| 维度 | 全局项目目录 (`agents.defaults.repoRoot`) | Per-agent 配置目录 (`agents.list[].workspace`) |
|------|------------------------------------------|----------------------------------------------|
| 路径示例 | `C:\Users\...\Desktop\测试` | `D:/AppData/openclaw/workspace-乔布斯` |
| 内容 | 用户的代码项目文件 | 系统生成的 AGENTS.md、TOOLS.md、IDENTITY.md |
| 维护者 | 用户通过 UI 选择 | `roster-sync.js` 自动同步 |
| 用途 | 项目上下文引导 | Agent 身份与技能配置 |
| 数量 | 全局唯一 | 每个 agent 一个 |

本调研讨论的是前者（全局项目目录）的 per-session 化问题。

---

### 五、方案评估

#### 方案 A：纯 Web UI 层改造（不改 Gateway）

**核心思路**：workspace 从"全局单例"变为"跟着 session 走，创建时固化"。

**改动点**：

1. **数据层** — `session-interaction.js` 的 `ensureSession()` 在创建 session 时快照 `State.workspace.path` 写入 session 对象的 `workspace` 字段，前端 localStorage 和后端 session JSON 均持久化。

2. **新建会话流程** — 用户创建新会话前，确保当前 workspace 已写入 `agents.defaults.repoRoot` + 调用 `syncProjectContext()` 更新 AGENTS.md。Gateway 创建 session 时读到正确的项目上下文。

3. **切换历史会话** — 加载历史 session 时，比较 `session.workspace` 与当前全局 workspace：
   - 若一致：无操作
   - 若不一致：自动切换全局 workspace（写 repoRoot + syncProjectContext），或提示用户"该会话属于项目 X，是否切换"
   - UI 侧 workspace 指示器显示该 session 绑定的目录名

4. **已有会话继续对话** — Gateway session 的 system prompt 已固化，无法中途更改。兜底策略：当检测到 session.workspace ≠ 当前全局 workspace 时，在首条用户消息前注入一条上下文提示（类似 system hint），告诉 agent 当前项目目录已变更为 X。

5. **会话列表展示** — `getSessionList()` 返回 workspace 字段，前端会话列表项显示关联的项目名/图标。

**优点**：
- 不依赖 Gateway 改动，完全在 Web UI 可控范围内
- 新会话的项目上下文完整正确（通过 AGENTS.md 注入）
- 改动范围集中：`session-interaction.js`、`session-manager.js`、`routes.js`、`state.js`，以及 UI 组件

**限制**：
- 已有会话继续对话时，system prompt 中的项目上下文是旧的，只能靠消息注入兜底
- 切换 session 时如果自动切换全局 workspace，会影响并发场景（多个 tab/窗口同时操作）
- workspace 切换后需要新开会话才能获得完整的新上下文

**适用场景**：大多数日常使用场景，用户在一个会话周期内专注一个项目。

---

#### 方案 B：改 Gateway，加 per-request header

**核心思路**：给 Gateway 的 HTTP 端点加一个 `x-openclaw-workspace-dir` header，实现真正的 per-request workspace 覆盖。

**改动点**：

1. Gateway 的 `buildAgentCommandInput()` 增加 `workspaceDir` 字段，从请求 header 读取
2. agent 命令管道优先使用 request-level 的 `workspaceDir`
3. Web UI 的 `proxy.js` 在转发时附加 `x-openclaw-workspace-dir` header（值来自 session 绑定的 workspace）

**优点**：
- 架构上最干净，真正的 per-request 粒度
- 不需要"切换全局 workspace"的副作用
- 历史会话续聊时也能拿到正确的项目上下文

**限制**：
- 需要修改 Gateway 源码（TypeScript），Gateway 是 npm 全局包
- 每次 Gateway 升级都需要重新 patch（除非上游合入）
- 修改范围涉及 Gateway 核心管道，风险较高
- 需要等上游发版或维护 fork

**适用场景**：如果团队有 Gateway 的修改权限和发版能力，这是最优解。

---

#### 方案 C：利用 per-agent workspace 机制，虚拟"项目 agent"

**核心思路**：每个项目目录对应一个虚拟 agent，复用现有的 `workspace-<name>` 机制。不同项目的会话路由到不同 agent。

**改动点**：

1. 用户新建/切换项目时，自动创建对应的虚拟 agent（如 `project-openclaw-web-ui`）
2. 每个虚拟 agent 有独立的 `workspace-project-XXX` 配置目录，AGENTS.md 包含各自的项目上下文
3. 会话创建时绑定到对应 agent，Gateway 天然支持 per-agent 的独立 system prompt
4. 会话切换时通过 `x-openclaw-agent-id` header 路由到正确 agent

**优点**：
- 完全利用现有机制，不需要新的基础设施
- 每个 agent 的 system prompt 独立且完整
- Gateway 天然支持，无需任何修改

**限制**：
- 会污染 agent 列表——用户看到的 agent 列表会混入大量"项目 agent"
- sub-agent 调度关系变复杂（项目 agent 的 sub-agents 怎么配？）
- agent 创建/删除的生命周期管理增加了额外逻辑
- 用户心智模型不匹配——"项目"和"agent"是两个不同概念

**适用场景**：不推荐，除非项目数量很少且固定。

---

### 六、方案对比总结

| 维度 | 方案 A（纯 UI 改造） | 方案 B（改 Gateway） | 方案 C（虚拟 agent） |
|------|---------------------|---------------------|---------------------|
| Gateway 改动 | 无 | 需改源码 | 无 |
| 项目上下文完整性 | 新会话完整，旧会话靠兜底 | 所有场景完整 | 所有场景完整 |
| 改动复杂度 | 中（4-5 个文件） | 高（Gateway 核心 + UI） | 高（agent 生命周期 + UI） |
| 升级兼容性 | 好（纯 UI 层） | 差（每次升级需 patch） | 中（agent 膨胀问题） |
| 用户体验 | 好（自动切换+提示） | 最好（无感） | 差（agent 列表污染） |
| 实现风险 | 低 | 高 | 中 |

---

### 七、建议

**优先评估方案 A**。理由：

1. 完全在 Web UI 控制范围内，不依赖外部改动
2. 改动范围集中且可分阶段实施（先数据层 → 再 UI → 最后兜底逻辑）
3. 覆盖了最高频的使用场景（新会话绑定当前项目）
4. 已有会话续聊的 system prompt 固化问题，可通过消息注入兜底，体验断层不大

如果后续 Gateway 开放了 per-request workspace header（方案 B），可以平滑迁移——只需在 proxy.js 加一个 header 转发，数据层和 UI 层不需要改动。方案 A 可以作为方案 B 的前置准备。

---

### 附录：关键文件索引

| 文件 | 作用 |
|------|------|
| `web/js/components/session-interaction.js` (L18-25) | 会话创建，缺 workspace 字段 |
| `web/js/state.js` (L55-59) | 全局 workspace 状态（单例） |
| `fs-store.js` (L395-411) | workspace 读写（agents.defaults.repoRoot） |
| `proxy.js` (L10-19) | Gateway 请求转发，4 个 header |
| `routes.js` (L284-294) | workspace PUT handler |
| `roster-sync.js` (L351-377) | syncProjectContext() AGENTS.md 注入 |
| `web/js/components/workspace-picker.js` | 前端 workspace 选择 UI |
| `web/js/components/model-switcher.js` (L25-55) | workspace 指示器渲染 |
| `web/js/api.js` (L54-58) | 前端请求 header 设置 |
| `docs/workspace-implementation-plan.md` | 现有 workspace 设计文档 |
| `docs/workspace-implementation-plan-v2.md` | 现有 workspace v2 设计文档 |
| Gateway: `dist/openai-http-DJ7nlIMd.js` | Gateway HTTP handler（buildAgentCommandInput） |
| Gateway: `dist/agent-scope-config-CgCYpZfK.js` | Gateway workspace 解析链 |
| Gateway: `dist/system-prompt-params-DZ5pfh4w.js` | Gateway repoRoot 解析 |
