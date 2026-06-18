# Per-Session Workspace 补充调研 — OpenClaw 源码深挖

> 基于对 OpenClaw 源码和文档的深挖，修正原调研报告的关键认知偏差，并提出修正建议。
> 调研日期：2026-06-17
> 源码版本：openclaw@2026.6.6

---

## 一、核心发现：调研报告有一个关键事实偏差

### 调研报告说的

> "Gateway 在会话创建时读取 AGENTS.md，组装 system prompt——此时项目上下文固化"
> "会话中途修改 workspace，已有会话的 system prompt 不会更新（设计如此）"

### 源码实际说的

`docs/concepts/context.md` L102：
> **"The system prompt is OpenClaw-owned and rebuilt each run."**

`docs/gateway/config-agents.md` L88-99 `agents.defaults.contextInjection`：
> Default: `"always"` — 每次请求都注入 workspace bootstrap files（AGENTS.md 等）
> `"continuation-skip"` — 续聊时跳过 re-injection（可选优化）

### 修正

**AGENTS.md 不是"会话创建时固化"，而是每次 run 都重新读取注入。** 如果 AGENTS.md 内容变了，下一次请求（续聊）就会拿到新内容。

这意味着调研报告方案 A 的核心限制——"已有会话继续对话时，system prompt 中的项目上下文是旧的，只能靠消息注入兜底"——**被高估了**。续聊时 system prompt 会自动跟随当前 AGENTS.md。

---

## 二、这个发现如何改变方案评估

### 方案 A 的真实限制（修正后）

| 场景 | 原报告评估 | 修正后评估 |
|------|-----------|-----------|
| 新会话 | ✅ 上下文正确 | ✅ 不变 |
| 同项目旧会话续聊 | ⚠️ 靠消息注入兜底 | ✅ AGENTS.md 没变，续聊自动正确 |
| 切了项目后旧会话续聊 | ⚠️ system prompt 固化，靠注入 | ⚠️ AGENTS.md 已变，续聊会拿到新项目上下文（不是"固化旧上下文"，而是"跟随全局"） |
| 多项目并行活跃 | ⚠️ 限制 | ❌ 全局 AGENTS.md 只能对应一个项目，另一项目续聊拿到错误上下文 |

**关键变化**：原报告最担心的"旧会话上下文固化需要消息注入兜底"基本不存在了。真正的问题收窄为：**同一时间只能有一个活跃项目**（全局 workspace 单例）。

### 对审核意见的修正

我上一轮审核意见中"风险 2：消息注入兜底与原则冲突"这一条，前提是"续聊时 system prompt 固化"。既然 system prompt 每次 run 重建，消息注入兜底**根本不需要**——续聊时 AGENTS.md 会自动重新注入。

所以审核意见的"不做消息注入兜底"建议更加成立，理由从"与原则冲突"升级为"根本不需要"。

---

## 三、Gateway 原生能力清单（调研报告遗漏的）

深挖源码发现三个调研报告未提及的原生机制：

### 1. Per-agent workspace（原生支持）

`docs/gateway/config-agents.md` L1050 + `docs/concepts/multi-agent.md`：

```json5
agents: {
  list: [
    { id: "home", default: true, workspace: "~/.openclaw/workspace-home" },
    { id: "work", workspace: "~/.openclaw/workspace-work" },
  ],
}
```

每个 agent 有独立的 workspace、session store、auth profiles。Session key 格式 `agent:<agentId>:<mainKey>`，不同 agent 的 session 天然隔离。

**这意味着**：Gateway 原生支持 per-agent 的项目隔离。调研报告的方案 C 思路是对的，但低估了它的原生程度——这不是 workaround，而是 Gateway 的设计用途。

### 2. contextInjection 控制 bootstrap 注入时机

`agents.defaults.contextInjection`：
- `"always"`（默认）：每次 run 都注入 AGENTS.md
- `"continuation-skip"`：续聊跳过 re-injection（减少 prompt 体积）
- `"never"`：完全不注入

**这意味着**：项目可以选择续聊时跳过 re-injection 来省 token，此时 system prompt 中的项目上下文确实"固化"在首次注入的版本。但默认是 always。

### 3. Sandbox scope: "session"（过重，不适合虾指挥）

`agents.defaults.sandbox.scope: "session"` 提供 per-session 容器+workspace，但需要 Docker backend。对本地单用户场景过重，排除。

---

## 四、修正后的方案推荐

### 仍然推荐方案 A 收窄版作为第一步，但理由更充分了

原审核意见建议"只做新会话绑定+列表展示+不匹配提示"。结合 system prompt 每次 run 重建的发现，这个方案比之前评估的**更可行**：

1. **新会话**：创建前确保 AGENTS.md 对应当前项目 → 上下文正确 ✅
2. **同项目续聊**：AGENTS.md 没变 → 续聊自动正确 ✅
3. **切项目后旧会话续聊**：提示"当前项目是 B，该会话属于 A" → 用户选择新开会话 → 上下文正确 ✅
4. **多项目并行活跃**（低频）：全局 AGENTS.md 只能对应一个项目 → 提示用户 → 可接受

**体验比原报告评估的好得多**——因为续聊不需要消息注入，AGENTS.md 自动跟随。唯一需要用户配合的是"切项目后请新开会话"，而这本来就是 Trae/Cursor 的默认行为（它们每个窗口/会话只属于一个项目）。

### 方案 D（per-agent workspace）作为长期路径

如果未来需要支持多项目并行活跃（多个会话同时属于不同项目），方案 D 是 Gateway 原生的干净解法：

**核心思路**：每个项目对应一个 agent，workspace 指向项目专属目录，AGENTS.md 包含虾指挥宪法 + 项目上下文。

**改动量**：中高
- 动态创建/管理项目 agent
- roster-sync 为每个项目 agent 同步 AGENTS.md
- 会话绑定 agent（session 记录 projectAgentId）
- 私聊/调度模式都用 `model: openclaw/<projectAgentId>`

**何时做**：当用户反馈"我想同时开着项目 A 和项目 B 的会话"时。当前单用户本地场景，方案 A 收窄版够用。

### 方案 B（改 Gateway）仍是终极路径

如果 Gateway 未来开放 per-request workspace header（`x-openclaw-workspace-dir`），所有方案都可以简化为"session 携带 workspace + proxy 转发 header"。这是最干净的，但依赖上游。

---

## 五、对原审核意见的修正

| 审核意见条目 | 原评估 | 修正 |
|-------------|--------|------|
| 风险 2 "消息注入兜底与原则冲突" | 与 token 控制 + 硬编码原则冲突 | **前提不成立**——system prompt 每次 run 重建，根本不需要消息注入。建议不做消息注入的理由更充分了 |
| 风险 1 "自动切换全局 workspace 污染面" | 仍然成立 | 不变。dispatch 等待期切换仍会污染 |
| 风险 3 "切换=写入改变语义" | 仍然成立 | 不变 |
| "只做新会话绑定+提示" | 低风险高价值 | **可行性提升**——续聊自动正确，体验比预期好 |

---

## 六、一句话总结

原调研报告的事实调查扎实，但有一个关键认知偏差：**误以为 system prompt 在会话创建时固化，实际上每次 run 都重建**。这个偏差导致方案 A 的限制被高估、消息注入兜底被误认为必要。修正后，方案 A 收窄版（session 携带 workspace 快照 + 不匹配提示 + 不做自动切换 + 不做消息注入）比之前评估的更可行、体验更好。Gateway 的 per-agent workspace 机制是多项目并行活跃的长期解法，但当前不必做。

---

*补充调研者：CodeReviewExpert · 基于 OpenClaw 源码深挖*
