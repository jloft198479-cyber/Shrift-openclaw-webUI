# 🦐 虾指挥 — Shrift OpenClaw Web UI

一个为 [OpenClaw](https://github.com/nicepkg/openclaw) 打造的轻量级 Web 控制面板，提供对话、Agent 管理、会话持久化等核心功能。

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

- [Node.js](https://nodejs.org/) >= 18
- [OpenClaw](https://github.com/nicepkg/openclaw) (`npm install -g openclaw`)

### 安装

```bash
git clone https://github.com/你的用户名/Shrift-openclaw-webUI.git
cd Shrift-openclaw-webUI
npm install
```

### 配置

复制配置模板并按需修改：

```bash
cp config.example.json config.json
```

`config.json` 说明：

```json
{
  "port": 3001,
  "gatewayUrl": "http://127.0.0.1:18789",
  "gatewayToken": "hermes-local-dev",
  "openclawConfigPath": ""
}
```

- `openclawConfigPath` 留空即可，启动脚本会自动探测 OpenClaw 配置路径

### 启动

**Windows（推荐）：**

```powershell
.\start.ps1
```

脚本会自动：
1. 探测 Node.js 路径
2. 启动 OpenClaw Gateway
3. 启动 Web UI
4. 打开浏览器

**手动启动：**

```bash
# 终端 1：启动 Gateway
openclaw gateway --port 18789 --verbose

# 终端 2：启动 Web UI
node server.js
```

### 停止

```powershell
.\stop.ps1
```

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
