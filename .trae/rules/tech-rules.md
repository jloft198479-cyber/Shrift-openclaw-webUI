# 技术规则

> 本文档记录技术细节、启动命令、关键路径和踩坑经验。
> 这些内容随产品演进可能变化，仅供参考。

---

## 一、启动命令

**AI 助手必须自行启动服务，不要让用户手动操作。**

```powershell
# 一键启动（Gateway + Web UI + 打开浏览器）
F:\fzz-Project\openclaw-web-ui\start.ps1

# 一键停止
F:\fzz-Project\openclaw-web-ui\stop.ps1
```

启动脚本自动完成：
1. 设置 `OPENCLAW_STATE_DIR` 环境变量
2. 检测 Gateway 是否已运行，未运行则启动（`D:\nodejs\node.exe D:\nodejs\npm-global\node_modules\openclaw\openclaw.mjs gateway --port 18789 --verbose`）
3. 等待 Gateway 就绪（轮询 `/v1/models`，最长 60 秒）
4. 检测 Web UI 是否已运行，未运行则启动（`D:\nodejs\node.exe server.js`）
5. 等待 Web UI 就绪（轮询 `/api/health`，最长 15 秒）
6. 自动打开浏览器 `http://localhost:3001`

停止脚本自动完成：
1. 按端口查找进程并终止
2. 验证端口已释放

**手动启动（备用，仅在脚本失败时使用）：**
```powershell
$env:OPENCLAW_STATE_DIR = 'D:\AppData\openclaw'
$env:PATH = 'D:\nodejs;D:\nodejs\npm-global;' + $env:PATH
D:\nodejs\node.exe D:\nodejs\npm-global\node_modules\openclaw\openclaw.mjs gateway --port 18789 --verbose
# 另一个终端：
D:\nodejs\node.exe F:\fzz-Project\openclaw-web-ui\server.js
```

## 二、关键路径

| 资源 | 路径 |
|------|------|
| 项目根目录 | `F:\fzz-Project\openclaw-web-ui\` |
| 前端静态文件 | `F:\fzz-Project\openclaw-web-ui\web\` |
| OpenClaw 配置 | `D:\AppData\openclaw\openclaw.json` |
| OpenClaw 数据 | `D:\AppData\openclaw\` |
| Gateway URL | `http://127.0.0.1:18789` |
| Web UI URL | `http://localhost:3001` |
| Gateway Token | `hermes-local-dev` |

## 三、技术要点

- **15 个 JS 文件全部使用 `const/let`**（零 `var`）
- 必须给 try-catch 包裹所有异步回调和 session 操作
- 修改 `State.setState` 的字段必须检查 5 个引用文件
- `chat-view.js` 是核心但也是最脆弱的——570 行，改之前先画依赖图

### ⛔ 冻结区域：会话框 UI

**用户已确认，会话框（聊天区域）的 UI 设计冻结，不再修改。**

冻结范围（以下文件的会话渲染相关样式和逻辑）：
- `web/css/style.css` — `.message`、`.bubble`、`.avatar`、`.agent-label`、`.msg-actions`、`.streaming-cursor`、`.mention-chip` 等会话区域样式
- `web/js/components/message-renderer.js` — 消息气泡渲染
- `web/js/components/stream-renderer.js` — 流式渲染
- `web/js/components/chat-view.js` — 聊天视图
- `web/js/components/message-builder.js` — 消息构建
- `web/js/utils/render.js` — `normalizeAgents`、`highlightMentions`、`renderAgentAvatar` 等渲染工具
- `web/js/ui/mention-completer.js` — @提及功能

备份位置：`F:\fzz-Project\openclaw-web-ui\_backup-会话UI设计\`

如需修改以上文件，必须先与用户确认。

---

## 四、踩坑经验

> 每次踩坑必须记录，**同样的错误不犯第二次**。
> 这些是具体问题的具体解法，仅供参考，不代表唯一正确路径。

### 1. 环境变量为空时的路径计算陷阱
- **现象**：`OPENCLAW_CONFIG` 为空字符串时，`path.dirname("")` 返回 `"."`，`path.join(".", "sessions")` 变成 `"./sessions"`（项目根目录），而非预期的 `D:\AppData\openclaw\sessions`
- **根因**：`config.json` 中 `openclawConfigPath` 设为 `""`，环境变量 `OPENCLAW_CONFIG_PATH` 未设置，导致 `OPENCLAW_CONFIG = ""`
- **教训**：**空字符串在 JavaScript 中是 falsy，但 `path.dirname("")` 不会报错，会静默返回 `"."`**。所有路径计算前必须检查源值是否有效
- **修复**：增加 `_detectOpenclawConfig()` 自动探测，在 `OPENCLAW_CONFIG` 为空时自动搜索 `%APPDATA%\openclaw\openclaw.json` 等候选路径

### 2. fs-store.js 闭包变量在 require 后不更新
- **现象**：`store.saveSession()` 在 server.js 路由中返回 false，但独立测试正常
- **根因**：`store.init("")` 时 `SESSIONS_DIR` 未被设置（`if (configPath)` 对空字符串为 false），之后即使 `OPENCLAW_CONFIG` 被正确设置，`SESSIONS_DIR` 也不会自动更新
- **教训**：**模块的闭包变量只在 `init()` 时设置一次，如果 init 参数不对，后续所有调用都会失败**。调试时要先确认 init 参数，而不是怀疑函数逻辑
- **修复**：确保 `store.init()` 传入有效的 configPath（通过 `_detectOpenclawConfig` 兜底）

### 3. 绕过模块直接写文件 = 代码堆砌
- **现象**：为了"快速修复" store.saveSession() 返回 false 的问题，在 server.js 中直接用 `fs.writeFileSync` 写文件，绕过了 store 模块
- **后果**：server.js 和 fs-store.js 各有一套 session 文件操作逻辑，维护时改一处忘改另一处
- **教训**：**绕过模块直接操作 = 违反"真理源自一处"原则 = 代码堆砌**。遇到模块方法不工作，应该找根因修复模块，而不是绕过它
- **修复**：找到根因（init 参数为空）后，回归调用 store 方法，删除 server.js 中的重复实现

### 4. PowerShell 5.1 兼容性
- **现象**：`start.ps1` 中 `?.Source`（null 条件运算符）和 `$IsWindows` 在 Windows 自带的 PowerShell 5.1 中不支持
- **教训**：**Windows 默认的 PowerShell 是 5.1，不是 7。`?.`、`$IsWindows`、`&&`、`||` 等 PS7 语法在 5.1 中全部报错**。写 PowerShell 脚本必须兼容 5.1
- **修复**：`?.Source` → `Select-Object -ExpandProperty Source`；`$IsWindows` → `$env:OS -eq 'Windows_NT'`

### 5. Start-Job 进程在脚本退出后被清理
- **现象**：`start.ps1` 用 `Start-Job` 启动 Gateway 和 Web UI，脚本退出后进程被杀，服务无法访问
- **教训**：**`Start-Job` 创建的作业与脚本生命周期绑定，脚本退出后作业被清理**。需要持久运行的后台进程应使用 `Start-Process`
- **修复**：改用 `Start-Process -WindowStyle Hidden`，进程独立于脚本生命周期

### 6. Session ID 路径遍历漏洞
- **现象**：`handleSessionGet`、`handleSessionSave`、`handleSessionDelete` 直接用用户输入的 id 拼接文件路径
- **隐患**：如果 `id` 包含 `../`，可以读写 sessions 目录之外的文件
- **教训**：**所有来自用户的路径参数，必须校验不含路径分隔符和 `..`**
- **修复**：增加 `_safeSessionId()` 校验函数，拒绝含 `/`、`\`、`..` 的 id

### 7. 遇到问题不要死磕
- **教训**：调试 `store.saveSession()` 返回 false 时，花了大量时间加日志、检查 require 缓存、验证函数源码，但始终没发现根因
- **正确做法**：**第一性原理 + 逻辑推理**。从 `saveSession` 的执行路径倒推：`saveSession → _ensureSessionsDir → !SESSIONS_DIR → return false`，问题出在 `SESSIONS_DIR` 为空，而 `SESSIONS_DIR` 由 `init()` 设置，`init()` 的参数来自 `OPENCLAW_CONFIG`，`OPENCLAW_CONFIG` 来自环境变量或 config.json——链路一清二楚，不需要死磕

### 8. Start-Process 启动的进程可能遇到 EPERM
- **现象**：通过 `start.ps1` 的 `Start-Process` 启动的 Web UI 服务器，写入 `D:\AppData\openclaw\sessions` 时报 `EPERM: operation not permitted`，但手动启动同一服务器写入正常
- **根因**：Windows 文件系统权限在某些启动上下文（如通过 `powershell.exe -File` 间接调用 `Start-Process`）下可能表现不同，导致目标目录不可写
- **教训**：**不能假设目标目录一定可写，必须有 fallback 机制**。文件写入操作应该先探测可写性，不可写时回退到备选目录
- **修复**：`fs-store.init()` 增加 `_canWriteDir()` 探测 + 项目目录 fallback。优先使用 openclaw 数据目录，不可写时自动回退到项目目录下的 `sessions/`

### 9. URL 路径参数必须 decodeURIComponent
- **现象**：`/api/sessions/a%5Cb` 中的 `%5C`（编码的反斜杠）未被解码，`_safeSessionId('a%5Cb')` 检测不到反斜杠
- **隐患**：虽然 `%5C` 作为文件名字面字符不会造成路径遍历，但与前端行为不一致，且违反 Web 标准
- **教训**：**HTTP 路径参数必须 `decodeURIComponent` 后再校验**，否则 URL 编码的恶意字符能绕过安全检查
- **修复**：路由 handler 中 `m[1]` 改为 `decodeURIComponent(m[1])`

### 10. 硬编码技能命令导致角色混乱和技能乱用
- **现象**：main agent 的 AGENTS.md 里硬编码了"🔍 搜索能力（对所有 Agent 通用）"section，列出所有搜索工具命令。导致：1) 虾指挥自己代答本应 spawn 给子 agent 的任务（角色混乱）；2) 小李子用了不该有的 web_search（技能乱用）
- **根因**：AGENTS.md 中的硬编码绕过了 config 中的技能绑定系统，让所有 agent 都以为自己有所有工具
- **教训**：**绝不硬编码动态内容**。技能命令必须从 config 的 skills 字段派生，通过 `_buildSkillUsageSection` 自动注入 AGENTS.md。任何手动写入的技能命令都是定时炸弹——config 改了，硬编码不会跟着改，数据就不一致了
- **修复**：删除 AGENTS.md 中的硬编码搜索 section，技能信息统一由 `syncSubAgentRoster` → `_buildSkillUsageSection` 从 config 派生

### 11. openclaw.json 配置校验失败导致 Gateway 无法启动
- **现象**：Gateway 启动报错 `agents.list.0.subagents: Invalid input`，服务完全不可用
- **根因**：两个问题叠加：1) `subagents` 中包含 `runTimeoutSeconds` 字段，当前 Gateway 版本的 schema 不支持（`additionalProperties: false`）；2) `allowAgents` 引用了不存在的 Agent ID
- **教训**：**Gateway 的配置 schema 是严格校验的，未知字段直接拒绝启动**。升级 Gateway 版本后必须重新验证配置兼容性。`openclaw config schema` 可以查看当前版本支持的完整 schema
- **修复**：1) 移除 `runTimeoutSeconds`（当前版本不支持）；2) 从 `allowAgents` 中移除不存在的 Agent ID；3) 修复 `jobs` Agent 的乱码字段；4) 考虑在 `agent-routes.js` 中增加引用完整性校验
