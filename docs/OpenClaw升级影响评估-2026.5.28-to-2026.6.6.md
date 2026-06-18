# OpenClaw 升级影响评估报告

> 评估范围：OpenClaw 2026.5.28 → 2026.6.6（跨越 3 个正式版本）  
> 评估对象：虾指挥（Shrift）OpenClaw Web UI v1.0.0  
> 评估时间：2026-06-13  
> 结论：**可安全升级，无需修改 Web UI 代码**

---

## 总结

| # | 影响点 | 原评级 | 验证结论 | 是否需改代码 |
|:-:|--------|:------:|:--------:|:------------:|
| 1 | WebSocket 协议版本 | 高 | 无影响 | 否 |
| 2 | config.patch 数组语义变更 | 高 | 无影响 | 否 |
| 3 | Session JSONL 格式 | 中 | 无影响 | 否 |
| 4 | reasoning_content SSE 流 | 中 | 无影响 | 否 |
| 5 | extraDirs 功能变更 | 低 | 无影响 | 否 |
| 6 | Gateway CLI 内部接口 | 低 | 无影响 | 否 |

---

## 逐项验证详情

### 1. WebSocket 协议版本 — 无影响

**原始担忧：** `ws-client.js` 硬编码 `minProtocol: 4, maxProtocol: 4`，如果新版提升了协议版本会导致握手失败。

**验证结果：** 新版 `packages/gateway-protocol/src/version.ts` 中 `PROTOCOL_VERSION = 4`，`MIN_CLIENT_PROTOCOL_VERSION = 4`，与虾指挥完全一致。Swift 客户端和 Control UI 前端也均为 4。CHANGELOG 中无协议版本变更记录。

**证据文件：**
- 虾指挥：`ws-client.js` 第 86-87 行
- 新版：`packages/gateway-protocol/src/version.ts`

---

### 2. config.patch 数组语义变更 — 无影响

**原始担忧：** v2026.6.5 改了 config 结构，`roster-sync.js` 操作 config 字段可能写出不兼容数据。

**验证结果：** 虾指挥**不使用** Gateway 的 `config.patch` RPC 方法。所有配置修改通过 `fs-store.js` 直接读写 `openclaw.json` 文件（`readConfig → 修改 → writeConfig`），完全绕过了 Gateway 的 merge-patch 逻辑。Gateway 的文件 watcher 检测到变化后重新读取完整文件，不走 merge-patch 路径。

`config.patch` 的变更（新增 `replacePaths` 参数）只影响通过 WebSocket RPC 调用该方法的客户端。

**证据文件：**
- 虾指挥：`fs-store.js` 第 52-75 行（readConfig/writeConfig）
- 虾指挥：`roster-sync.js` 第 388-399 行（syncAllRosters）
- 新版：`src/gateway/server-methods/config.ts` 第 139-200 行
- CHANGELOG 第 31 行（#91551）

---

### 3. Session JSONL 格式 — 无影响

**原始担忧：** 新版改了 session 序列化格式会导致 Web UI 的 session 恢复和对话历史出问题。

**验证结果：** 新版 `session-manager.ts` 中 `SessionMessageEntry` 结构不变（`type`, `id`, `parentId`, `timestamp`, `message`）。`CURRENT_SESSION_VERSION = 3` 未变。JSONL 序列化方式仍为 `JSON.stringify(entry) + "\n"`。文件路径模式 `agents/main/sessions/*.jsonl` 不变。CHANGELOG 中无 session 格式变更记录。

**证据文件：**
- 虾指挥：`session-sync.js` 第 273-297 行（_parseAssistantMessages）
- 新版：`src/agents/sessions/session-manager.ts` 第 932-941 行
- 新版：`src/config/sessions/version.ts`
- 新版：`src/config/sessions/transcript-jsonl.ts`

---

### 4. reasoning_content 在 SSE 流中的处理方式 — 无影响

**原始担忧：** 新版改了 SSE 流结构，思考内容可能丢失或重复。

**验证结果：** Gateway 的 `/v1/chat/completions` OpenAI 兼容端点（无论流式还是非流式）从未在 SSE delta 中包含 `reasoning_content` 字段。虾指挥 `api.js` 中 `delta.reasoning_content` 的检查是一个**从未激活的代码路径**——升级前后行为一致。

虽然 Gateway 内部确实从 provider 接收 `reasoning_content`（在 `openai-transport-stream.ts` 中处理），但这些 thinking 事件通过 WebSocket 会话通道消费，不会转发到 OpenAI HTTP SSE 端点。

**额外发现：** 这是一个预存问题，与升级无关。如果需要 thinking 折叠功能生效，需要通过 Gateway WebSocket 事件通道获取 thinking 数据，或等 OpenClaw 在 OpenAI 兼容端点中添加 reasoning_content 输出。

**证据文件：**
- 虾指挥：`web/js/api.js` 第 64-65 行、第 116-117 行
- 虾指挥：`proxy.js`（纯透传，不修改响应内容）
- 新版：`src/gateway/openai-http.ts` 第 273-290 行（writeAssistantContentChunk）

---

### 5. extraDirs 功能变更 — 无影响

**原始担忧：** 新版可能改了 extraDirs 的加载时机或路径解析。

**验证结果：** `skills.load.extraDirs` 的类型定义（`string[]`，可选）在两个版本间完全一致。路径解析逻辑（读目录 → 找 SKILL.md → 识别技能）无结构性变化。CHANGELOG 在 v2026.5.28 → v2026.6.6 范围内无 extraDirs 相关条目。

新版在 watcher 方面有性能优化（共享 watcher、减少文件描述符），对虾指挥是透明且正面的改进。

**证据文件：**
- 虾指挥：`fs-store.js` 第 195-217 行（scanExtraDirsSkills）
- 新版：`src/config/types.skills.ts` 第 20-35 行
- 新版：`src/config/zod-schema.ts` 第 1237 行
- 新版：`src/skills/runtime/refresh.ts` 第 112-172 行

---

### 6. Gateway CLI 内部接口 — 无影响

**原始担忧：** CLI 参数或行为变化可能导致 Gateway 启动失败。

**验证结果：** 虾指挥 `launcher.js` 使用的启动命令 `openclaw gateway --port <port> --verbose` 在新版中完全兼容。`--port` 和 `--verbose` 两个参数均保留且签名未变。`--openclaw-config` 不是实际的 CLI 参数（配置路径通过环境变量和标准路径探测）。CHANGELOG 中无影响启动参数的 CLI 变更。

**证据文件：**
- 虾指挥：`launcher.js` 第 342 行
- 新版：`src/cli/gateway-cli/run-command.ts` 第 11-61 行

---

## 升级建议

**结论：可以安全升级，无阻塞项。**

升级步骤建议：

1. 停止虾指挥服务（`stop.bat` 或关闭 shrift.bat 窗口）
2. 执行 `npm update -g openclaw` 升级到 2026.6.6
3. 重启虾指挥（`shrift.bat`）
4. 验证基本功能：对话、Agent 管理、技能列表、会话历史

**已知预存问题（非升级引入）：** thinking 折叠功能依赖的 `reasoning_content` 字段在 OpenAI HTTP SSE 端点中从未输出过，这不是升级导致的新问题。

---

## 附录：架构耦合点验证状态

| Web UI 文件 | 依赖的 OpenClaw 行为 | 状态 |
|:-----------|:---------------------|:----:|
| `ws-client.js` | WebSocket 协议版本、Gateway 端口分配 | 兼容 |
| `agent-routes.js` | Session JSONL 格式、announce 回传格式 | 兼容 |
| `roster-sync.js` | openclaw.json config 结构、skills 目录约定 | 兼容 |
| `sse-manager.js` | SSE 流格式（reasoning_content vs content） | 兼容 |
| `api.js` | chat completions API 响应结构 | 兼容 |
| `launcher.js` | `openclaw gateway` CLI 启动参数 | 兼容 |
