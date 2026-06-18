# 虾指挥 · OpenClaw Web UI

> 让每个用户都能轻松指挥一支 AI 专家团队

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Gateway-blue.svg)](https://github.com/openclawai/openclaw)

---

## 这是什么

**虾指挥**是一款基于 [OpenClaw](https://github.com/openclawai/openclaw) Gateway 的轻量级 Web UI，让你通过浏览器指挥一支 AI Agent 团队完成复杂任务。

核心能力：**主 Agent 智能调度 + 子 Agent 一对一私聊**，两种模式自由切换。

### 与其他 OpenClaw Web UI 的区别

| 能力 | 通用 Web UI | 虾指挥 |
|------|------------|--------|
| 主 Agent 智能调度 | ✅ | ✅ |
| **子 Agent 一对一私聊** | ❌ | ✅ |
| **@提及直接指定 Agent** | ❌ | ✅ |
| 子 Agent 可视化创建 | 部分 | ✅ 创建即用，自动注册 |
| 任务执行进度可视化 | ❌ | ✅ 实时显示哪个 Agent 在做什么 |
| 流式输出 + 中途停止 | 部分 | ✅ 真正停止（chat.abort） |

---

## 三种交互模式

### 1. 私聊（Direct）— 和某个 Agent 直接对话

```
用户：@知乎搜搜 搜索 AI Agent 的最新讨论
       ↓
知乎搜搜：执行搜索 → 返回结果
```

通过 `@` 提及直接指定 Agent，绕过主 Agent，一对一交流。适合精准、单点任务。

### 2. 委派（Delegate）— 让主 Agent 转交给指定 Agent

```
用户：让知乎搜搜去搜一下 AI Agent 的最新讨论
       ↓
虾指挥（主 Agent）：收到，我来安排 → spawn 知乎搜搜
       ↓
知乎搜搜：执行搜索 → 返回结果
       ↓
虾指挥：知乎搜搜找到了以下内容...
```

告诉主 Agent "让 XX 去做某事"，主 Agent spawn 指定的子 Agent 执行。

### 3. 智能调度（Dispatch）— 主 Agent 自行决定

```
用户：帮我写一篇关于 AI 的爆款文案
       ↓
虾指挥（主 Agent）：判断任务类型 → spawn 咪蒙（文案专家）
       ↓
咪蒙：搜索热点 → 撰写文案 → 返回
       ↓
虾指挥：咪蒙完成了文案，内容如下...
```

只描述任务，主 Agent 自动判断交给谁。适合复杂、多步骤任务。

---

## 核心特性

### Agent 团队管理
- **可视化创建**：填写名称、描述、绑定技能、选择模型，一键创建
- **自动注册**：创建即写入 openclaw.json，自动同步花名册，主 Agent 立即可调用
- **专属工作区**：每个 Agent 有独立的工作目录和身份文件（SOUL/IDENTITY/MEMORY）
- **头像系统**：32 套预设头像，创建时自动分配

### 实时交互体验
- **流式输出**：SSE 流式渲染，打字机效果
- **中途停止**：基于 OpenClaw 官方 `chat.abort` RPC，真正停止 Agent 运行（不是假停止）
- **进度可视化**：dispatch 模式下实时显示"🔄 知乎搜搜 正在执行"、"✓ 知乎搜搜 已完成"
- **Agent 切换感知**：流式输出中自动识别当前发言的 Agent

### 会话管理
- **多会话并行**：每个会话独立上下文，互不干扰
- **历史持久化**：会话自动保存，重启后恢复
- **会话切换保护**：切换前自动停止旧会话的 Agent、清理状态

### 工作区管理
- **临时办公室**：可切换工作目录，不同项目用不同 workspace
- **路径安全**：所有用户输入的路径参数经过校验，防止路径遍历

### 工程质量
- **零依赖前端**：纯原生 JS + CSS，无 React/Vue/构建工具
- **轻量后端**：仅依赖 `ws` 一个包
- **组件化架构**：高内聚低耦合，每个组件可独立渲染/销毁
- **错误边界**：单组件崩溃不拖垮全局
- **资源节约**：rAF 节流、Map 队列去重、SSE offset 精准控制

---

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [OpenClaw Gateway](https://github.com/openclawai/openclaw)（`npm install -g openclaw`）

### 安装

```bash
git clone https://github.com/jloft198479-cyber/Shrift-openclaw-webUI.git
cd Shrift-openclaw-webUI
npm install
```

### 配置

复制配置模板并修改：

```bash
cp config.example.json config.json
```

```json
{
  "port": 3001,
  "host": "127.0.0.1",
  "gatewayUrl": "http://127.0.0.1:18789",
  "gatewayToken": "your-gateway-token",
  "openclawConfigPath": ""
}
```

### 启动

**方式一：一键启动（推荐）**

Windows 双击 `虾指挥.bat`，或运行：

```powershell
.\start.ps1
```

启动脚本自动完成：
1. 设置环境变量
2. 检测并启动 OpenClaw Gateway
3. 启动 Web UI 服务
4. 打开浏览器

**方式二：手动启动**

```bash
# 终端 1：启动 Gateway
openclaw gateway --port 18789 --verbose

# 终端 2：启动 Web UI
node server.js
```

打开浏览器访问 `http://localhost:3001`。

### 停止

```powershell
.\stop.ps1
```

---

## 使用指南

### 创建你的第一个子 Agent

1. 点击左侧栏的 **新建 Agent** 按钮
2. 填写信息：
   - **名称**：比如"知乎搜搜"
   - **描述**：比如"擅长在知乎寻找答案"
   - **技能**：选择已安装的技能（如 `zhihu-search`）
   - **模型**：选择合适的大模型
3. 点击 **完成**

系统自动完成注册，Agent 立即可用。

### 三种方式使用 Agent

| 方式 | 操作 | 适用场景 |
|------|------|---------|
| **私聊** | 输入 `@知乎搜搜 搜索...` | 精准单点任务 |
| **委派** | 输入 `让知乎搜搜去搜...` | 指定执行者 |
| **智能调度** | 直接描述任务 `帮我搜...` | 复杂任务，让主 Agent 决定 |

### 中途停止

任务执行中，发送按钮会变为 **停止按钮**（黑色方块）。点击即可停止 Agent 运行——这是基于 OpenClaw 官方 `chat.abort` RPC 的真正停止，不是假停止。

---

## 项目结构

```
openclaw-web-ui/
├── server.js              # HTTP 服务器入口
├── proxy.js               # Gateway 请求代理
├── routes.js              # API 路由
├── ws-client.js           # Gateway WebSocket 客户端
├── sse-manager.js         # SSE 连接管理
├── session-sync.js        # 会话同步（announce 检测）
├── fs-store.js            # 文件存储（session/config）
├── agent-routes.js        # Agent CRUD + 花名册同步
├── roster-sync.js         # Agent 花名册同步
├── workspace-validator.js # 工作区校验
├── launcher.js            # PWA 模式启动器
├── config.example.json    # 配置模板
├── start.ps1 / stop.ps1   # 一键启停脚本
├── web/                   # 前端静态文件
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── api.js         # Gateway API 封装
│   │   ├── state.js       # 全局状态管理（单一数据源）
│   │   ├── app.js         # 应用入口
│   │   ├── components/    # UI 组件
│   │   ├── controllers/   # 控制器（业务逻辑）
│   │   ├── utils/         # 工具函数
│   │   ├── ui/            # UI 交互
│   │   └── lib/           # 第三方库（marked/purify）
│   ├── avatars/           # Agent 头像
│   └── fonts/             # 本地字体
├── workspace-files/       # 主 Agent 身份文件模板
├── docs/                  # 项目文档
└── skills/                # 技能定义
```

---

## 架构设计

### 单向数据流

```
用户操作 → State.setState() → 事件通知 → 组件响应 → UI 更新
```

`State.js` 是唯一的状态管理中心，所有状态修改通过 `setState()` 触发事件，组件订阅事件响应。单向数据流，可预测、可追踪。

### 三层架构

```
┌─────────────────────────────────┐
│         前端（Web UI）           │
│  components / controllers / api │
└───────────────┬─────────────────┘
                │ HTTP + SSE + WebSocket
┌───────────────┴─────────────────┐
│      后端（Node.js Server）      │
│  routes / proxy / ws-client     │
└───────────────┬─────────────────┘
                │ WebSocket RPC
┌───────────────┴─────────────────┐
│      OpenClaw Gateway            │
│  主 Agent + 子 Agent 团队        │
└─────────────────────────────────┘
```

### 关键设计决策

1. **原生能力优先**：用 Gateway 的 `sessions_spawn` + announce，不自造轮子
2. **双通道通信**：HTTP SSE 流式输出 + WebSocket RPC 控制命令
3. **会话切换收敛**：`_beforeSwitch()` 统一清理（停止 Agent + 清理状态 + 隐藏指示器）
4. **SSE offset 精准控制**：无客户端时 offset 不推进，重连后重读，不丢消息

---

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 前端 | 原生 JS + CSS | 零框架，零构建工具 |
| Markdown | marked + DOMPurify | 安全渲染 |
| 后端 | Node.js | 仅依赖 `ws` |
| 通信 | HTTP + SSE + WebSocket | 三通道协同 |
| Gateway | OpenClaw | Agent 编排引擎 |

---

## 开发

### 项目规则

项目遵循严格的架构原则和工作规范，详见 `.trae/rules/` 目录：

- `architecture.md` — 架构原则（真理源自一处、高内聚低耦合、决策阶梯）
- `project_rules.md` — 工作原则（实事求是、第一性原理、渐进实现）
- `product-context.md` — 产品上下文
- `tech-rules.md` — 技术规则与踩坑记录

### 文档

完整文档在 `docs/` 目录：

- `虾指挥-产品介绍.md` — 产品定位与核心场景
- `CODE-WIKI.md` — 完整技术架构与模块详解
- `虾指挥-经验沉淀合集.md` — 踩坑经验与解决方案

---

## License

MIT

---

## 联系方式

- **微信**：简乐（fzz198479）
- **GitHub Issues**：[提交反馈](https://github.com/jloft198479-cyber/Shrift-openclaw-webUI/issues)

---

*虾指挥 — 前端极简如水，后端硬核如钢*
