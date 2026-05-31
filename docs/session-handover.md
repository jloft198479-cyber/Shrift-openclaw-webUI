# Session Handover — 2026-05-31

> 新会话 AI 请先完整阅读本文档，再阅读 `docs/progress.md`，然后开始工作。
> 本文档记录上一轮会话结束时的项目快照。

---

## 一、项目身份

**项目**：OpenClaw Web UI 助理（Shrift）
**目录**：`F:\fzz-Project\openclaw-web-ui\`
**Git 分支**：`ui-optimize-claude-style`
**最新 commit**：`7dd8fbc` — "fix: 补上CSS变量化丢失部分（复查修复）"

---

## 二、当前服务状态（快照）

| 服务 | 端口 | 状态 |
|------|------|------|
| Web UI 服务器 | `localhost:3001` | ✅ 运行中 |
| OpenClaw Gateway | `127.0.0.1:18789` | ✅ 运行中 |
| 模型 | DeepSeek v4 Flash + 小米 MiMo v2.5 | ✅ 双模型可用 |
| 调度协作 | 主 Agent spawn 子 Agent + announce 回传 | ✅ 全链路验证通过 |

### 启动方式

```powershell
# Gateway（必须在普通终端，TRAE 外）
$env:OPENCLAW_STATE_DIR = 'D:\AppData\openclaw'
openclaw gateway --port 18789 --verbose

# Web UI（TRAE 内）
cd F:\fzz-Project\openclaw-web-ui\; node server.js
```

---

## 三、本轮完成的工作

### 3.1 功能（上一轮已完成）

| 功能 | commit |
|------|--------|
| MiMo 多模态接入（图片识别） | `72c8804` |
| 上传目录迁移至 `stateDir/uploads/` | `72c8804` |
| 文本文件内容内联嵌入消息（Open WebUI 最佳实践） | `72c8804` |
| 复制按钮优先复制原始 Markdown（`dataset.raw`） | `72c8804` |
| 分割线色系统一、间距加大 | `72c8804` |

### 3.2 代码质量重构（本轮核心）

**Step 0 — 安装工具链**

| 工具 | 用途 |
|------|------|
| stylelint + stylelint-declaration-strict-value | CSS 变量强制规则 |
| eslint | JS 代码质量检查 |
| husky + lint-staged | git pre-commit 自动检查 |
| 配置文件 | `stylelint.config.js`、`.eslintrc.json`、`.husky/pre-commit` |

**Step 1 — CSS 变量化**

`:root` 新增 3 个 CSS 变量：
- `--border-subtle: rgba(0,0,0,0.08)` — 消除 5 处重复（改颜色改 1 处即可）
- `--hover-bg: rgba(0,0,0,0.05)` — 供后续统一
- `--surface-hover: rgba(0,0,0,0.04)` — 供后续统一

**Step 2 — JS 函数抽取**（[message-renderer.js](file:///f:/fzz-Project/openclaw-web-ui/web/js/components/message-renderer.js)）

| 新函数 | 消除的重复 |
|--------|-----------|
| `_ensureActions(bubble)` | 3 份 msg-actions 创建代码 |
| `_renderContent(el, raw)` | 5 份 renderMarkdown + dataset.raw 模式 |
| `_buildAvatarEl(role, agent)` | 头像逻辑从主函数拆分（17→7 行） |
| `_buildMessageElement` 简化为 ~100 行 | 原 ~120 行 |

**Step 3 — Git hook 守门**
- pre-commit hook 已配置，`git commit` 时自动 lint-staged
- 宽松放行（`|| true`），后续可收紧

---

## 四、核心文件结构

```
F:\fzz-Project\openclaw-web-ui\
├── server.js              # ~350行 — Express 服务器
├── routes.js              # ~250行 — API 路由
├── fs-store.js            # ~380行 — 文件存储层
├── package.json           # 依赖 + lint-staged 配置
├── stylelint.config.js    # CSS lint 配置
├── .eslintrc.json         # JS lint 配置
├── .husky/pre-commit      # git hook
├── docs/
│   ├── progress.md        # 项目完整进度文档（新会话必读）
│   ├── session-handover.md # ← 本文档
│   └── code-quality-debt.md # 代码债务记录
└── web/
    ├── css/style.css       # 2500行（主样式表）
    ├── index.html          # 单页入口
    └── js/
        ├── app.js          # 应用入口
        ├── api.js          # API 通信层
        ├── state.js        # 状态管理
        ├── constants.js    # 常量
        ├── components/     # UI 组件
        │   ├── message-renderer.js  # ~470行 ← 本轮重构重点
        │   ├── message-builder.js
        │   ├── chat-view.js
        │   └── ...
        ├── controllers/    # 控制器
        │   ├── session-manager.js
        │   ├── ws-bridge.js
        │   └── event-router.js
        ├── ui/             # UI 工具
        ├── utils/          # 工具函数
        └── views/          # 视图
```

---

## 五、待办事项（下阶段优先）

### 5.1 功能待验证

| 项目 | 状态 |
|------|------|
| @子Agent 直连路径 — `onAgentSwitch` 回调 | 待验证 |
| 智能调度路径 — announce 结构化存储 + 回放渲染 | 待验证 |
| dispatch 长任务 — 安全定时器不再提前关闭 | 待验证 |
| 新 session 回看 — announces 渲染为 `bubble-content-block` | 待验证 |
| MiMo 图片识别 | ✅ 已通过 |
| 文本文件内联内容 | 已实现，待验证 |
| 复制按钮输出原始 MD | 已实现，待验证 |

### 5.2 代码质量债务（已记录在 `docs/code-quality-debt.md`）

| 问题 | 位置 | 难度 |
|------|------|:----:|
| `rgba(0,0,0,0.05)` 背景色重复 7 处 | style.css | 低 |
| `rgba(0,0,0,0.04)` 背景色重复 7 处 | style.css | 低 |
| `var(--border-light)` 在 border-top 使用 4 处 | style.css | 低 |
| `_buildMessageElement` 仍可进一步拆分 | message-renderer.js | 中 |
| 事件委托硬绑定 `.messages-inner` DOM 选择器 | message-renderer.js | 中 |

### 5.3 用户反复强调的原则

1. **先讨论再动手** — 不要上来就改代码，先说清楚原因和方案
2. **不要写死代码** — 保持灵活性
3. **组件化原子化** — 可复用、可组合
4. **代码高内聚低耦合** — 消除硬编码和重复逻辑
5. **稳定第一** — 不稳定的产品没有意义

---

## 六、工程师须知

### 关键环境信息

| 变量/配置 | 值 |
|-----------|-----|
| `OPENCLAW_STATE_DIR` | `D:\AppData\openclaw` |
| Gateway token | `hermes-local-dev` |
| 配置路径 | `D:\AppData\openclaw\openclaw.json` |
| API Key | 在 `openclaw.json` 中，不在代码里 |
| 数据盘 | **C 盘零写入原则** |
| SSO 登录 | **已禁用** |
| 不需要执行 `npm install` | 已安装完成 |

### 重要注意事项

- **不要修改** `F:\fzz-Project\claude-ui\hermes\` 下的任何文件（旧项目归档）
- **Agent 人设必须写在 AGENTS.md**（SOUL.md 不会被注入子 Agent 上下文）
- **sessions_spawn 是非阻塞的** — 前端需要 WebSocket 接收异步结果
- **Gateway 必须从普通终端启动** — TRAE 沙盒会阻止文件写入
- pre-commit hook 已配置，如果有报错不要直接 skip，先看是 stylelint 的旧代码报警还是自己的新问题

### git 恢复

```bash
# 当前 HEAD 为 7dd8fbc
git log --oneline -5
```

### 代码风格

- 无分号（Semistandard 风格）
- CSS 使用 CSS 变量（`--border-*`、`--text-*` 等），不写硬编码颜色
- JS 使用 `_ensureActions()` / `_renderContent()` 等工具函数，不做重复 DOM 创建
