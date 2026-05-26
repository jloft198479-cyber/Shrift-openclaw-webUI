# 🦐 虾指挥 — Shrift OpenClaw Web UI

> ⚠️ **这不是一个独立产品。** 虾指挥是 [OpenClaw](https://github.com/nicepkg/openclaw) 的 Web 控制面板，你需要**先安装并配置好 OpenClaw**，再用它来管理对话和 Agent。

## ✨ 功能特性

- **💬 智能对话** — 流式输出、思考过程展示、多轮对话
- **🤖 Agent 管理** — 创建/编辑/删除 Agent，查看技能列表
- **📨 @提及** — 输入 `@` 快速召唤指定 Agent 协作
- **📁 会话持久化** — 聊天记录存储在服务器端，不依赖浏览器 localStorage 容量
- **🔒 安全防护** — DOMPurify XSS 防护、上传文件类型白名单、路径遍历防护、请求体大小限制
- **📡 SSE 实时事件** — Gateway 状态实时推送，断线自动重连
- **🖥️ 一键启动** — 自动探测 Node.js 和 OpenClaw 路径，无需手动配置

## 🚀 快速开始

### 前置条件

> 虾指挥**不会**自动安装或配置 OpenClaw，以下事项需要你先准备好。

**① 安装 OpenClaw**

```bash
npm install -g openclaw
```

**② 配置 OpenClaw**

确保 OpenClaw 已有配置文件。默认位置：

| 系统 | 路径 |
|------|------|
| Windows | `%APPDATA%\openclaw\openclaw.json` |
| macOS / Linux | `~/.openclaw/openclaw.json` |

如果还没有，先创建 OpenClaw 的配置文件（至少配置一个 Agent，否则 Web UI 显示为空）。

**③ 安装 Node.js**

- [Node.js](https://nodejs.org/) >= 18（推荐 LTS 版本）

### 安装

```bash
git clone https://github.com/jloft198479-cyber/Shrift-openclaw-webUI.git
cd Shrift-openclaw-webUI
npm install
```

### 启动

**Windows（推荐）：双击 `shrift.bat`**

项目文件夹中的 `shrift.bat` 是最佳启动方式：

1. 双击 `shrift.bat`，弹出命令行窗口自动启动服务
2. 首次运行会自动打开**配置向导**（setup.html），引导你设置 OpenClaw 配置文件路径
3. 配置保存后自动进入主界面
4. 再次双击直接进入，跳过配置
5. **关闭应用窗口后，服务自动停止**，无需额外操作

> 你也可以在浏览器中打开 `http://localhost:3001` 手动访问。

**备用方案：双击 `start.bat`**

效果与 `shrift.bat` 相同，但会在默认浏览器中打开（非独立窗口）。

**停止：双击 `stop.bat`**

**或者使用 PowerShell：**

```powershell
.\start.ps1
```

### 配置

首次启动时，页面会自动检测 OpenClaw 配置文件位置。配置向导会引导你：

1. 点击 **自动检测** 扫描常见安装位置
2. 手动输入路径后点击 **验证路径** 确认文件有效
3. 验证通过后点击 **保存配置**，自动进入主界面

如需自定义端口或 Token，复制配置文件模板：

```bash
cp config.example.json config.json
```

编辑 `config.json`：

```json
{
  "port": 3001,
  "gatewayUrl": "http://127.0.0.1:18789",
  "gatewayToken": "hermes-local-dev",
  "openclawConfigPath": ""
}
```

**手动启动：**

```bash
# 终端 1：启动 Gateway
openclaw gateway --port 18789 --verbose

# 终端 2：启动 Web UI
node server.js
```

> **更进一步：** 在虾指挥页面打开后，你可以点击 Edge 地址栏右侧的安装按钮，将其安装为 PWA 应用。安装后会在桌面生成快捷方式，但请注意：**PWA 快捷方式不会自动启动后端服务**，仍需先运行 `shrift.bat`。我们建议使用 `shrift.bat` 作为统一入口。

## 🏗️ 项目结构

```
├── server.js              # HTTP 服务器 + API 路由
├── fs-store.js            # 文件存储层（配置读写、会话持久化）
├── proxy.js               # Gateway API 代理
├── ws-client.js           # Gateway WebSocket 事件桥
├── agent-routes.js        # Agent CRUD API
├── start.ps1              # 一键启动（Windows）
├── stop.ps1               # 一键停止（Windows）
├── config.example.json    # 配置模板
├── web/
│   ├── setup.html         # 首次启动配置向导
│   ├── index.html         # 入口页面
│   ├── css/style.css      # 样式
│   └── js/
│       ├── app.js             # 应用初始化
│       ├── state.js           # 响应式状态管理
│       ├── api.js             # API 调用层
│       ├── controllers/
│       │   ├── session-manager.js  # 会话管理（API + localStorage 双写）
│       │   ├── event-router.js     # 事件路由
│       │   └── ws-bridge.js        # SSE 事件桥
│       ├── components/
│       │   ├── chat-view.js        # 对话视图
│       │   ├── message-renderer.js # 消息渲染
│       │   ├── stream-renderer.js  # 流式渲染
│       │   ├── session-list.js     # 会话列表
│       │   ├── agent-list.js       # Agent 列表
│       │   └── ...
│       └── ui/
│           ├── menu-system.js      # 菜单系统
│           └── mention-completer.js # @提及补全
└── docs/                  # 文档
```

## 🔧 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/agents` | Agent 列表 |
| GET | `/api/models` | 可用模型列表 |
| GET | `/api/sessions` | 会话列表 |
| GET | `/api/sessions/:id` | 获取会话详情 |
| PUT | `/api/sessions/:id` | 保存会话 |
| DELETE | `/api/sessions/:id` | 删除会话 |
| POST | `/api/upload` | 文件上传 |
| GET | `/api/events` | SSE 事件流 |
| POST | `/api/setup` | 保存配置 |
| POST | `/api/setup/detect` | 自动检测 OpenClaw 配置路径 |
| POST | `/api/setup/verify` | 验证配置路径有效性 |

## 🛡️ 安全特性

- **XSS 防护** — DOMPurify sanitize 所有 Markdown 输出
- **上传安全** — 文件扩展名白名单 + 10MB 大小限制
- **路径遍历防护** — Session ID 校验，拒绝 `../` 等路径遍历攻击
- **请求体限制** — 超大请求返回 413，防止资源耗尽

## 📄 License

MIT

---

**作者：** 简乐  
**微信：** fzz198479
