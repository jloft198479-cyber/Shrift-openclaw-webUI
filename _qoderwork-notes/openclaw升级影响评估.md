## OpenClaw 升级影响评估：2026.5.28 → 2026.6.6

**当前版本**: 2026.5.28 (e932160)
**最新稳定版**: 2026.6.6 (2026-06-12)
**跨越版本**: 3 个正式版 (2026.6.1, 2026.6.5, 2026.6.6)

---

### 一、高风险项（可能导致功能失效）

**1. WebSocket 协议版本锁死**

虾指挥 `ws-client.js` 握手时硬编码 `minProtocol: 4, maxProtocol: 4`。如果 2026.6.x 将协议版本升至 5，WebSocket 握手会直接失败。降级后果：虾指挥会回退到 HTTP 轮询（每 5 秒一次），实时事件推送（子 agent 进度、工具调用状态、session 变更通知）全部降级为延迟轮询，用户体验显著恶化。

目前 release notes 中没有明确提及协议版本变更，但 v2026.6.6 的 "Gateway 安全边界收紧" 和 v2026.6.1 的 "code mode namespaces" 都涉及 Gateway 通信层，存在隐性升级的可能。

**建议**: 升级前先在测试环境验证 WebSocket 握手是否成功。如果失败，需要调整 `ws-client.js` 的 `maxProtocol` 值并适配新的消息格式。

**2. config.patch 数组替换语义变更**

v2026.6.5 明确修复了 `config.patch` 的行为：「对没有 merge key 的数组，替换而非合并」。这影响 `fs-store.js` 的 `writeConfig` — 我们用的是原子替换（tmp + rename），所以整个配置文件是全量写入，不受 patch 语义影响。但如果 OpenClaw Gateway 内部用 `config.patch` 来处理我们的配置变更通知，行为可能改变。

具体风险：`roster-sync.js` 修改 `agents.list[].skills` 数组后，如果 Gateway 侧的 patch 语义从 "合并" 变成 "替换"，可能导致其他 agent 的配置项被意外清除。

**建议**: 升级后验证技能安装/卸载流程，确认 `agents.list` 数组写入后配置完整性。

**3. reasoning_content 字段处理**

虾指挥 `chat-controller.js` 依赖 SSE delta 中的 `reasoning_content` 字段来展示思考过程（可折叠区块）。

v2026.6.6 有一个直接相关的修复：「preserve Gemma 4 `reasoning_content`」— 说明之前版本存在 reasoning_content 丢失的情况，新版本修复了这个问题。这是**正面影响**，正好解决我们之前发现的 "思考内容折叠不保存" 问题。

但 v2026.6.5 的 「QQBot strips reasoning/thinking tags before sending」表明 OpenClaw 在通道层面区分了 `reasoning_content`（SSE 流）和 `<thinking>` 标签（模型原始输出）。如果这个剥离逻辑影响到 SSE 流本身的 `reasoning_content` 字段（而非仅影响通道投递），我们的思考展示会失效。

**建议**: 升级后用 Gemma 4 或其他支持 reasoning 的模型测试思考折叠功能。

---

### 二、中风险项（可能导致部分功能异常）

**4. 技能系统重构**

v2026.6.1 引入了两项重大变更：
- "add the core skills index and centralize skills runtime loading, status, filtering, and prompt formatting" — 技能加载集中化
- "Skill Workshop" — 新的技能提案/审核工作流

虾指挥的 `roster-sync.js` 直接操作技能目录（junction 链接）和配置文件（`agents.list[].skills`），绕过了 OpenClaw 的技能运行时。集中化加载意味着：

- 技能索引可能缓存在 SQLite 或内存中，我们直接写目录/junction 后，Gateway 可能不会立即感知变更（之前依赖 filesystem watcher 刷新，v2026.6.5 又优化了 watcher — "avoid one filesystem watcher per skill file"）
- Skill Workshop 的提案流程与我们的直接安装方式并行，不冲突但也不互通

**建议**: 升级后测试技能安装 → 刷新 → agent 可见的完整流程。如果技能不立即可见，可能需要在 roster-sync 完成后触发一次 Gateway 侧的技能刷新（比如通过 REST API 或 WebSocket RPC）。

**5. 安全边界全面收紧**

v2026.6.6 的安全变更覆盖面很广：transcripts、sandbox binds、host environment inheritance、MCP stdio、exec approvals fail closed on timeout 等。

对虾指挥的潜在影响：
- 如果 exec approvals 超时自动拒绝，而 Web UI 的工具调用需要人工确认，用户可能看不到确认弹窗就因为超时被自动拒绝
- sandbox 收紧可能影响技能脚本（如 web-search.py、zhihu-search.py）的执行权限
- "elevated sender checks" 可能影响 BFF 代理的请求鉴权

**建议**: 升级后测试完整的工具调用链路（用户发消息 → 模型调用工具 → 工具执行 → 结果返回），特别关注需要 approval 的工具。

**6. session JSONL 格式和 metadata**

v2026.6.1 提到 "session metadata optimization"，v2026.6.5 又推迟了 SQLite 迁移（"defer the session-metadata SQLite migration"），说明 session 存储格式处于过渡期。

虾指挥 `session-sync.js` 直接读取 JSONL 文件，依赖：
- 文件路径 `agents/main/sessions/*.jsonl`
- 每行 `{ type: "message", sessionKey, message: { role, content } }` 格式
- content 为 `[{ text }]` 数组或纯字符串

如果 session 格式有调整（比如新增字段、content 结构变化），消息提取会静默失败。

**建议**: 升级后对比 JSONL 文件内容，确认格式兼容。

---

### 三、低风险项（影响有限或可控）

**7. Gateway 启动延迟优化**

v2026.6.6 的 "cached model metadata"、"lazy slash-command loading" 等改进对虾指挥是正面的 — Gateway 启动更快，BFF 代理的健康检查更快通过。

**8. MCP 工具结果类型强制转换**

v2026.6.5 将 `resource_link`、`audio` 等非文本/图片的 MCP 结果强制转为文本，防止 Anthropic 400 错误。这对虾指挥是正面的 — 减少了工具调用报错的概率。

**9. auth profiles 迁移到 SQLite**

v2026.6.5 将鉴权配置从 JSON 文件迁移到 SQLite。虾指挥不直接读取 auth profiles，但如果 Gateway token 的存储位置变了，`fs-store.js` 读取 `gateway.auth.token` 可能需要适配。

---

### 四、正面影响（升级收益）

- **reasoning_content 保留修复**: 解决 Gemma 4 等模型的思考内容丢失问题，直接改善我们的思考折叠功能
- **MCP 工具结果兼容性**: 减少工具调用因非标准返回类型导致的 400 错误
- **安全加固**: exec approval 超时机制防止工具调用无限挂起
- **性能优化**: Gateway 启动更快，内存占用更低，watcher 资源更省
- **技能索引集中化**: 为未来 Skill Workshop 集成预留空间

---

### 五、建议的升级策略

1. **先在测试环境升级**，不直接动生产
2. **验证清单**（按优先级）：
   - WebSocket 握手成功（看控制台有无协议版本错误）
   - 基本对话 → SSE 流 → 消息渲染
   - 思考过程展示（用支持 reasoning 的模型）
   - 工具调用完整链路（发消息 → 工具调用 → 结果返回）
   - 技能安装/卸载 → agent 可见性
   - 子 agent dispatch（sessions_spawn）
   - 配置文件读写（agents.list 数组操作）
3. **最可能需要改的代码**：`ws-client.js` 的协议版本号
4. **回退方案**：保留 2026.5.28 的安装包，随时可降级
