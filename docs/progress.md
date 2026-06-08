# OpenClaw Web UI 助理 — 项目进度文档

> **最新状态（2026-06-01）**：v0.5.0 已提交至 GitHub。主 Agent/Skills/TOOLS.md 关系已梳理完毕，编辑弹窗已重构，所有改动已验证通过。
>
> **新会话快速入口**：先读 `_handoff-next-session.md` 了解当前快照，再回来看本文档深度上下文。

---

## 一、产品定位

### 产品名称
Shrift（虾指挥）— OpenClaw Web UI

### 核心定位
主从架构多 Agent 对话平台。两个核心模式：
1. **私聊模式**：`model = openclaw/agentId`，直接和指定 Agent 对话
2. **智能调度**：`model = openclaw/main` + `sessions_spawn` + announce，自动分配任务

### 架构原则
- 零框架，纯原生 JS，15 个文件，启动即用
- 单向数据流：`State.setState()` → 事件通知 → 组件响应
- 真理源自一处：config.json 是唯一数据源

---

## 二、技术栈

| 组件 | 技术 |
|------|------|
| 后端 | Node.js（原生 http，无框架） |
| 前端 | 原生 JS（无 React/Vue），零打包链 |
| Markdown 渲染 | marked.js |
| Markdown 编辑 | contenteditable + marked + turndown.js |
| 样式 | 原生 CSS，CSS 变量化 |

---

## 三、启动方式

```powershell
# 一键启动（推荐）— shrift.bat
# 自动：安装依赖 → 启动 Gateway → 启动 Web UI → Edge PWA 模式打开 → 关闭窗口自动停服务

# 一键停止
F:\fzz-Project\openclaw-web-ui\stop.ps1
```

---

## 四、关键架构决策

### AGENTS.md vs TOOLS.md

| 文件 | 定位 | 谁写入 |
|------|------|--------|
| AGENTS.md | Agent 的人设和指令 | **用户**（Web UI 编辑弹窗"详情介绍"Tab） |
| TOOLS.md | 环境备忘录（团队信息 + 技能说明） | **系统**（syncAllRosters 自动同步） |

**关键原则**：
- AGENTS.md 的内容有两个作者（用户 + 系统），会互相覆盖、破坏 LLM prefix cache
- **已修复**：系统生成信息从 AGENTS.md 迁移到 TOOLS.md，AGENTS.md 只保留用户内容
- TOOLS.md 系统段用 `<!-- system-sync-start/end -->` 标记区分，用户编辑时自动剥离，保存后自动恢复

### Skill vs Tool vs TOOLS.md

| 概念 | 定义 | 示例 |
|------|------|------|
| Tool | Gateway 内置原子动作 | `exec python`、`web-search` |
| Skill | 操作教程/办事套路 | `skills/web-search/` |
| TOOLS.md | 环境特定的工具备忘录和决策偏好 | "搜索知乎优先用 API" |

### Junction vs Symlink

Windows 上 Junction 不需要管理员权限，Symlink 需要。我们统一用 Junction。

---

## 五、当前 Agent 配置

| Agent ID | 名称 | 工作区 | 技能 |
|----------|------|--------|------|
| main | 虾指挥 | `~/.openclaw/workspace` | 无 |
| jobs | 乔布斯 | `~/.openclaw/workspace-jobs` | web-search |
| mrbeast | MrBeast | `~/.openclaw/workspace-mrbeast` | web-search |
| ppt | 小王 | `~/.openclaw/workspace-ppt` | html-ppt-skill, md2wechat |
| 咪蒙 | 咪蒙 | `~/.openclaw/workspace-咪蒙` | md2wechat, web-search, zhihu-search |
| 小李子 | 小李子 | `~/.openclaw/workspace-小李子` | zhihu-search |
| 小周 | 小周 | `~/.openclaw/workspace-小周` | zhihu-search |

---

## 六、已验证的核心功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 私聊模式 | ✅ | `model = openclaw/agentId` |
| 智能调度 | ✅ | `sessions_spawn` + announce |
| Agent CRUD | ✅ | Web UI 编辑弹窗 |
| 技能绑定 | ✅ | 缺失技能标记 ⚠ |
| 会话管理 | ✅ | SessionStore |
| 流式渲染 | ✅ | SSE delta 模式 |
| 文件附件 | ✅ | 自动压缩 + 文本内联 |
| 图片上传 | ✅ | Canvas 压缩 + MiMo 多模态 |
| 复制按钮 | ✅ | 输出原始 Markdown |
| WYSIWYG 编辑 | ✅ | Tab + marked + turndown |
| 药丸标签 | ✅ | 插入光标位置，保存时转 `**标签名**` |
| 符号链接 | ✅ | Junction + 断头清理 |
| 环境自适应 | ✅ | OpenClaw 配置自动探测 |

---

## 七、已知技术债务（下次优先处理）

| # | 问题 | 优先级 | 说明 |
|---|------|:------:|------|
| 1 | 自动化测试缺失 | 高 | 核心路径全靠手动验证 |
| 2 | 新用户引导缺失 | 中 | 第一次打开没有 onboarding |
| 3 | 设置页面缺失 | 中 | API Key 管理等全靠手动改 config |
| 4 | 深色模式缺失 | 低 | 暂无主题切换 |
| 5 | chat-view.js 570 行 | 低 | 核心但脆弱，改前先画依赖图 |
| 6 | 跨平台启动脚本 | 低 | 当前只有 Windows |

---

## 八、关键文件索引

| 文件 | 职责 |
|------|------|
| `server.js` | HTTP 主服务，路由分发 |
| `routes.js` | 路由表和静态文件 |
| `fs-store.js` | OpenClaw 配置读写，Agent 数据 |
| `agent-routes.js` | Agent CRUD API |
| `roster-sync.js` | 技能链接同步，TOOLS.md 生成 |
| `session-sync.js` | 会话文件同步 |
| `ws-client.js` | Gateway WebSocket 桥接 |
| `sse-manager.js` | SSE 连接管理 |
| `web/js/state.js` | 前端状态管理 |
| `web/js/api.js` | 前端 API 调用 |
| `web/js/components/agent-modal.js` | Agent 编辑弹窗（4 Tab + WYSIWYG） |
| `web/js/components/chat-view.js` | 聊天视图（最核心也最脆弱） |
| `web/css/style.css` | 样式，CSS 变量化 |

---

## 九、工作规矩

1. 只做你明确让我做的，不代劳、不提前动手
2. 讨论时不执行，等你说"执行"或"要"再动
3. 抓本质逻辑，不堆表面代码
4. 绝不硬编码动态内容
