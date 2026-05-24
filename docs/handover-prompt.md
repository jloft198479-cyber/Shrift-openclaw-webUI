# OpenClaw Web UI 助理 — 新会话接手指令

> 将以下内容完整粘贴到新任务的首条消息中。

---

你好，你需要接手一个正在开发中的项目。请先完整阅读以下内容，然后开始工作。

## 第一步：必读文档

📄 **F:\fzz-Project\openclaw-web-ui\docs\progress.md** — 项目进度上下文（完整）

📄 **F:\fzz-Project\openclaw-web-ui\.trae\rules\project_rules.md** — 项目最高宪法（**必须读完**）

## 第二步：最近工作记录（2026-05-22，当前会话）

### 已完成

#### 第一阶段：代码调研
- 完整梳理 15 个 JS 文件的依赖关系（调用图、全局变量表）
- 标记 State 所有字段和事件映射
- 标记 6 个最危险的跨文件调用（State.setState 被 6 个文件调用）

#### 第二阶段：加固（⚠️ 有踩坑，见下方教训）
1. **try-catch 保护** — chat-view.js 的 onDone 回调（SessionStore.save/updateList）、session-manager.js 的 selectSession（ChatView.appendMessage）和 loadSessions 加上了 try-catch
2. **var → const/let 统一** — 15 个 JS 文件全部转换完成，当前零 var 残留、零语法错误
3. **state.js 补全** — `userScrolledUp` 加入 keyToEvent 映射
4. **僵尸文件清理** — `web/js/ui/input-area.js` 已删除（与 event-router 功能重复）

#### 当前功能状态
- 页面可以正常加载和展示
- 聊天消息可以发送给主 Agent（HTTP API）
- @提及 弹出菜单正常，但 delegate 模式触发后子 Agent 回复会说"好，身份切换"

### ⚠️ 已知问题

#### A. var→const 转换遗留的 bug（已修复 ✅）
| 问题 | 变量 | 原因 | 已修 |
|------|------|------|------|
| 按钮点不动 | attachmentPaths, agentId, displayText (chat-view.js) | const 被重赋值 | ✅ |
| 内容渲染 | contentEl (chat-view.js 305) | const 被重赋值 | ✅ |
| @提及 badge 不显示 | avatar (mention-completer.js 94) | const 被重赋值 | ✅ |
| Agent 编辑不能保存 | selectedAvatar (agent-modal.js 247) | const 被重赋值 | ✅ |

**教训：** 所有批量替换都必须逐条核对该变量是否在同一函数作用域内被重赋值。上次没做逐条验证，导致 4 个运行时报错。

#### B. 子Agent "身份切换"问题（未修复 🔴）
**根本原因不是缺 AGENTS.md，是架构问题。**
- 当前前端 @提及 走的是 `x-openclaw-agent-id` 直接路由（HTTP API），等效于"切换 Agent 对话"
- 这不是 OpenClaw 真正的子 Agent 模式（`sessions_spawn`）
- 正统模式是：主 Agent 识别 @提及 → 调用 sessions_spawn → 子 Agent 在**独立会话**中执行 → 通过 **WebSocket 通告** 异步回传结果
- 当前纯 HTTP 架构下，子 Agent 看到的是完整的对话历史 + "轮到你了"，自然会觉得自己在"切换身份"
- **修复需要实现 WebSocket 接收异步结果 + 前端解析通告**

#### C. 我的 Agent 信息路径查找错误（记录教训）
- 配置文件里 workspace 写的是 `~/.openclaw/workspace-jobs`，`~` 是用户主目录
- 我最初错误地到 `D:\AppData\openclaw\agents\jobs\` 下查找
- **实际目录**：`C:\Users\fzz198479\.openclaw\workspace-jobs\AGENTS.md`
- `openclaw.json` 和 `progress.md` 里记录的主目录 `~` 写法需要理解其含义

### 未来工作计划（按优先级）

1. **实现 WebSocket 连接** — 接收子 Agent 异步结果（sessions_spawn 的通告）
2. **改造 @提及 流程** — 不再走 x-openclaw-agent-id 直连，改为主 Agent 识别后 spawn
3. **完善子 Agent AGENTS.md**（已在 userprofile 下存在，需确认是否完整）
4. **启用记忆系统**
5. **Skills 绑定**

## 第三步：关键约束（用户反复强调，不可违反）

请详细阅读 `.trae/rules/project_rules.md`，尤其注意：
1. **实事求是** — 不瞎蒙不猜测，不确定的事必须验证
2. **策略大于行动** — 先想清楚方案再动手
3. **取得共识再行动** — 任何改动前必须沟通确认
4. **分步骤行动** — 每阶段完成后验证，不一次跑完
5. **任务不是结果，能用好用才是结果** — 写完代码必须站在用户角度实测
6. **沉淀经验** — 同样的错误不犯第二次

## 第四步：关键技术细节

### 启动命令
```powershell
# Gateway（普通终端，不能在 TRAE 内）
$env:OPENCLAW_STATE_DIR = 'D:\AppData\openclaw'
openclaw gateway --port 18789 --verbose

# Web UI 服务器（TRAE 内即可）
D:\nodejs\node F:\fzz-Project\openclaw-web-ui\server.js

# 浏览器
http://localhost:3001
```

### 关键路径
| 项目 | 路径 |
|------|------|
| 项目根目录 | `F:\fzz-Project\openclaw-web-ui\` |
| 前端 JS 文件 | `F:\fzz-Project\openclaw-web-ui\web\js\` |
| 配置 | `D:\AppData\openclaw\openclaw.json` |
| 子 Agent workspace | `C:\Users\fzz198479\.openclaw\workspace-{agentId}\` |
| Gateway Token | `hermes-local-dev` |

### HTTP API（已验证）
- POST `http://127.0.0.1:18789/v1/chat/completions`
- 认证：`Authorization: Bearer hermes-local-dev`
- Agent 选择：`x-openclaw-agent-id: <agentId>` 或 `model: "openclaw:<agentId>"`
- 用户输入放 `messages` 数组

### sessions_spawn 关键特征
- 调用立即返回 `{ status: "accepted" }`
- 子 Agent 结果通过 WebSocket 通告异步回传
- **纯 HTTP 无法获取子 Agent 结果，必须用 WebSocket**

### 子 Agent 上下文注入
- **会注入**：AGENTS.md + TOOLS.md
- **不会注入**：SOUL.md / IDENTITY.md / USER.md / HEARTBEAT.md
- 子 Agent 人设必须写在 AGENTS.md 中

## 第五步：开始工作

1. 先读 progress.md 全文
2. 先读 project_rules.md 全文
3. 跟用户讨论当前最优先要处理什么
4. 先讨论再动手，每一步完成后证实
