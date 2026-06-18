# 虾指挥 — 工作目录（Workspace）功能实施方案

> 版本：v1.1 | 日期：2026-06-16 | 状态：审核通过，可执行
> 第三方审核后修正 P0（webkitdirectory → 文本输入）、补充安全策略、修正文件数统计。

---

## 一、用户诉求

1. **核心需求**：让虾指挥支持"选择工作文件夹"功能，类似 QoderWork 的体验——用户指定一个项目文件夹后，虾指挥根据该文件夹内的提示文件（AGENTS.md、SOUL.md 等）和项目文件进行工作。

2. **全局生效**：工作目录是全局配置，所有 agent 共享，不是 per-session 的。

3. **优先级**：工作目录的项目上下文优先，全局 awareness 目录（`~/.qoderworkcn/awareness/`）作为兜底。

4. **不重复造轮子**：和 OpenClaw 官方保持一致，UI 层只做配置写入和界面展示，不自行读取文件、不拼接 prompt、不处理上下文加载——这些由 Gateway 负责。

5. **UI 层职责**：只做两件事——选路径 + 写配置。

6. **模块化/原子化**：按职责拆分模块，每个模块只做一件事，方便日后排查问题和单独优化。

7. **UI 位置**：工作目录指示器放在模型切换器右侧，两者在同一行 `.model-bar` 内：
   ```
   .model-bar: [模型: DeepSeek ▼]  ·  [📂 openclaw-web-ui  [改]]
   ```
   未设置时：
   ```
   .model-bar: [模型: DeepSeek ▼]  ·  [📂 未设置  [选]]
   ```

---

## 二、OpenClaw 技术支持现状

### 2.1 Gateway 原生支持

OpenClaw Gateway 在 `openclaw.json` 顶层有一个 `workspace` 字段（schema line 3888-3891）：

```json
"workspace": {
  "type": "string",
  "title": "Workspace",
  "description": "Default workspace path exposed to agent runtime tools 
    for filesystem context and repo-aware behavior."
}
```

**含义**：设置后，Gateway 在启动会话时自动从该目录读取项目上下文文件（AGENTS.md、SOUL.md、USER.md、HEARTBEAT.md 等），注入到 agent 的 system prompt 中。UI 层不需要自己做文件读取和 prompt 注入。

### 2.2 当前配置状态

当前 `openclaw.json`（`D:\AppData\openclaw\openclaw.json`）顶层未设置 `workspace` 字段。所有 agent 的项目上下文来源是全局 awareness 目录。

### 2.3 per-agent workspace 与全局 workspace 的区别

代码中每个 agent 有自己的 `workspace` 字段（如 `workspace-虾指挥`），这是 **per-agent 配置目录**，存放 agent 专属的系统生成文件（TOOLS.md、IDENTITY.md、BOOTSTRAP.md 等），由 `roster-sync.js` 维护。

**两者职责不同、目录不同、不冲突**：

| 维度 | 全局 workspace（我们要做的） | per-agent workspace（已有） |
|------|---------------------------|---------------------------|
| 路径 | 用户项目目录（绝对路径） | agent 配置目录（相对路径，如 `workspace-虾指挥`） |
| 内容 | 用户写的 AGENTS.md、SOUL.md | 系统生成的 TOOLS.md、IDENTITY.md |
| 维护者 | 用户选择 | roster-sync.js 自动同步 |
| 用途 | 项目上下文 | agent 配置 |
| 存储位置 | openclaw.json 顶层 | openclaw.json agents.list[].workspace |

### 2.4 会话生效机制

OpenClaw 的 system prompt 在会话启动时固化。因此：
- **改 workspace 后不需要重启服务**——Gateway 从配置文件运行时读取
- **但需要新开会话**——已有会话的 system prompt 已固化，不会中途更新

---

## 三、实现方案

### 3.1 设计原则

1. **职责单一**：每个模块只做一件事
2. **与官方一致**：只写 `workspace` 字段到配置，不越权处理上下文
3. **无代码冗余**：不引入新依赖，复用现有 `fs-store.js` 的 `readConfig/writeConfig`
4. **安全优先**：路径校验、白名单更新、丢失检测

### 3.2 模块划分

**后端 3 个模块**：

| 模块 | 职责 | 文件 | 行数预估 |
|------|------|------|----------|
| 路径校验器 | 验证路径合法性、安全性、有效性 | `workspace-validator.js`（新建） | ~60 |
| 配置读写 | 从 openclaw.json 读写 workspace 字段 | `fs-store.js`（加 2 个函数） | ~20 |
| 路由 + 白名单 | API 接口处理 + 文件代理白名单更新 | `routes.js`（加路由） + `server.js`（白名单） | ~40 |

**前端 3 个模块**：

| 模块 | 职责 | 文件 | 行数预估 |
|------|------|------|----------|
| workspace-picker | UI 组件：显示路径、选择/清除按钮、警告提示 | `components/workspace-picker.js`（新建） | ~50 |
| API 调用 | workspace 的 HTTP 请求封装 | `api.js`（加 3 个函数） | ~20 |
| 状态 + 渲染集成 | workspace 状态管理 + model-bar 渲染集成 | `state.js`（加字段） + `model-switcher.js`（集成） | ~15 |

**总计**：新建 2 个文件（后端 1 + 前端 1），修改 5 个现有文件，约 205 行代码。

### 3.3 后端 API 设计

| 方法 | 路径 | 职责 | 请求体 | 返回 |
|------|------|------|--------|------|
| GET | `/api/workspace` | 返回当前 workspace 配置 + 目录有效性 | 无 | `{ path: "F:\\...", exists: true }` 或 `{ path: "", exists: false }` |
| PUT | `/api/workspace` | 设置 workspace（写入 openclaw.json） | `{ path: "F:\\..." }` | `{ success: true, path: "F:\\..." }` 或 `{ success: false, reason: "..." }` |
| DELETE | `/api/workspace` | 清除 workspace 配置 | 无 | `{ success: true }` |

PUT 接口流程：
1. 调 `workspace-validator.validateWorkspacePath(body.path)`
2. 校验通过 → `fs-store.writeWorkspace(validated.resolved)` 写入 openclaw.json
3. 返回成功 + 标准化后的路径

GET 接口流程：
1. `fs-store.readWorkspace()` 读取配置中的 workspace
2. `workspace-validator.checkWorkspaceExists(path)` 检查目录是否仍存在
3. 返回路径 + exists 标记（前端据此显示警告）

### 3.4 前端 UI 设计

workspace-picker 组件在 `.model-bar` 内渲染，位于模型 `<select>` 右侧。

**默认状态**（路径文本显示 + 操作按钮）：
```html
<div class="model-bar">
  <!-- 模型切换器（已有） -->
  <select id="model-select" class="model-select">...</select>
  <!-- 分隔符 -->
  <span class="bar-separator">·</span>
  <!-- 工作目录指示器（新增） -->
  <span class="workspace-indicator">
    <span class="workspace-icon">📂</span>
    <span class="workspace-name">openclaw-web-ui</span>
    <button class="workspace-btn" data-action="edit">✎</button>
    <button class="workspace-btn" data-action="clear">✕</button>
  </span>
</div>
```

**编辑状态**（点击 ✎ 按钮后切换为文本输入）：
```html
<span class="workspace-indicator editing">
  <span class="workspace-icon">📂</span>
  <input type="text" class="workspace-input" value="F:\fzz-Project\openclaw-web-ui"
         placeholder="输入项目目录路径...">
  <button class="workspace-btn" data-action="confirm">✓</button>
  <button class="workspace-btn" data-action="cancel">✕</button>
</span>
```

**为什么不用 `<input type="file" webkitdirectory>`**：现代浏览器出于安全考虑，`webkitdirectory` 返回的 `file.path` 为空字符串，`webkitRelativePath` 只有相对路径，前端无法获取用户选择的绝对路径。因此改为文本输入 + 后端校验的方案。

交互流程：
1. 点击 ✎ 按钮 → 切换为文本输入框，显示当前路径（或空值）
2. 用户输入/粘贴路径 → 点击 ✓ 确认
3. 前端调 `Api.setWorkspace(path)` → 后端校验 + 写入 openclaw.json
4. 成功：更新 `State.workspace` + 重新渲染 + toast 提示"新会话生效"
5. 失败（路径不合法）：输入框下方显示红色错误提示（如"目录不存在"、"不允许选择系统目录"）
6. 目录已配置但被删除 → 名称显示红色 + tooltip 提示"目录不可访问"
7. 点击 ✕ 清除 → 调 `Api.clearWorkspace()` → 重新渲染为"未设置"
8. 点击 ✕ 取消编辑 → 恢复默认状态

### 3.5 文件代理白名单更新

`server.js` 的 `_getWorkspaceAllowedDirs()` 当前只包含 agent workspace 目录和全局 skills 目录。加入全局 workspace 后，前端 `/api/file` 代理才能访问项目目录的文件（如展示 AGENTS.md 内容）。

修改位置：`_getWorkspaceAllowedDirs()` 函数内，在 agent workspace 循环之后加：

```javascript
// 全局 workspace 目录
var globalWs = store.resolveHome(data.workspace || '');
if (globalWs) dirs.push(path.resolve(globalWs));
```

**缓存失效**：`_getWorkspaceAllowedDirs()` 有 30s 缓存（`_wsAllowedDirsCache`）。PUT/DELETE workspace 成功后必须立即清除缓存，否则用户在 30s 内访问 workspace 内文件会被 403：
```javascript
_wsAllowedDirsCache = null;
_wsAllowedDirsCacheTime = 0;
```

---

## 四、实施步骤

每步改完后自检（diff + grep），确认无误再继续。

### Phase 1：后端基础

**Step 1**：创建 `workspace-validator.js`（纯路径校验逻辑）
- `validateWorkspacePath(dirPath)` — 空值检查、路径穿越、系统目录保护、存在性验证
- `checkWorkspaceExists(dirPath)` — 已配置路径的有效性检测
- 导出两个函数，不引入外部依赖

**Step 2**：修改 `fs-store.js`（配置读写）
- 新增 `readWorkspace()` — 从 openclaw.json 顶层读 workspace 字段
- 新增 `writeWorkspace(absPath)` — 写入 workspace 字段到 openclaw.json
- 复用现有 `readConfig/writeConfig`，不新增存储机制

**Step 3**：修改 `routes.js` + `server.js`
- `routes.js`：加 3 个路由（GET/PUT/DELETE `/api/workspace`）
- `server.js`：`_getWorkspaceAllowedDirs()` 加全局 workspace 白名单
- `server.js`：PUT/DELETE 路由成功后清除白名单缓存（`_wsAllowedDirsCache = null`）

### Phase 2：前端 UI

**Step 4**：修改 `state.js` + `api.js`
- `state.js`：加 `workspace` 字段（默认空字符串），`flatKeyToEvent` 加 workspace 映射
- `api.js`：加 `getWorkspace()`、`setWorkspace(path)`、`clearWorkspace()` 三个函数

**Step 5**：创建 `components/workspace-picker.js`
- `WorkspacePicker.update()` — 根据 State.workspace 渲染指示器（默认态 + 编辑态）
- `WorkspacePicker.onEdit()` — 点击 ✎ 切换编辑态
- `WorkspacePicker.onConfirm()` — 文本输入确认 + API 调用 + toast
- `WorkspacePicker.onCancel()` — 取消编辑恢复默认态
- `WorkspacePicker.onClear()` — 清除 workspace + API 调用
- 组件自包含，监听 State workspace 变化自动重渲染

**Step 6**：修改 `model-switcher.js` + `index.html`
- `model-switcher.js`：`updateBar()` 方法内渲染 workspace-picker 区域（模型右侧 + 分隔符 `·`）
- `index.html`：加 `<script>` 标签引入 workspace-picker.js（放在 model-switcher.js 之后）

### Phase 3：验证

**Step 7**：最终验证
- git diff 全量检查
- grep 确认无遗漏引用
- 手动测试：输入路径 → 写配置 → 新会话验证上下文加载 → 清除目录 → 检查警告
- 边界测试：输入系统目录（应拒绝）、输入不存在目录（应提示）、输入后删除目录（应警告）、输入驱动器根目录（应拒绝）

---

## 五、注意事项

### 5.1 安全策略

- **路径校验**：PUT 接口必须走 `validateWorkspacePath`，拒绝空值、穿越、系统目录、不存在的路径
- **驱动器根目录保护**：拒绝选择 `C:\`、`D:\` 等驱动器根目录（用路径长度判断，不逐个枚举盘符）
- **系统目录保护**：`PROTECTED_DIRS` 列表需覆盖 Windows（`C:\Windows`、`C:\Program Files`、`C:\ProgramData`）、macOS（`/System`、`/Library`、`/Applications`）、Linux（`/etc`、`/usr`、`/var`、`/sys`）
- **白名单更新**：`_getWorkspaceAllowedDirs` 必须加全局 workspace，否则 `/api/file` 代理返回 403
- **白名单缓存失效**：PUT/DELETE 成功后立即清除 `_wsAllowedDirsCache`
- **配置写入**：复用 `fs-store.writeConfig`，不自行写文件（保持原子性和一致性）
- **前端信任**：不信任前端传入的路径格式，后端 `path.resolve()` 标准化后再校验

### 5.2 State 事件映射

`state.js` 的 `flatKeyToEvent` 需新增 `workspace` 映射，否则 `State.setState({ workspace: ... })` 不会触发 UI 更新。workspace-picker 需监听此事件重新渲染。

### 5.3 配置监听联动

`server.js` 已有 `fs.watch` 监听 `openclaw.json` 变更并广播 `agents-updated` 事件。PUT workspace 写入后会自动触发此监听。workspace 变更不需要额外广播机制——前端在 PUT 响应成功时直接更新 `State.workspace` 即可。

### 5.4 并发写入

`fs-store.writeConfig` 是"读-改-写"模式，两个并发请求可能丢失数据。但 workspace 写入频率极低（用户手动操作），实际风险可忽略。不在本功能范围内加锁机制。

### 5.5 已知风险

- **两份 AGENTS.md**：项目目录和 per-agent workspace 可能都有 AGENTS.md。Gateway 如何处理两者的优先级取决于 Gateway 内部逻辑，不在 UI 层控制范围内。建议先观察实际行为，如出现冲突再在 UI 层加提示。
- **目录丢失**：用户设置工作目录后删除了该目录，GET 接口通过 `checkWorkspaceExists` 返回 `exists: false`，前端显示红色警告。Gateway 会静默跳过上下文加载，不会崩溃。
- **会话固化**：换工作目录后已有会话不更新 system prompt，需新开会话。UI 应在设置成功后 toast 提示"新会话生效"。

### 5.6 不改什么

以下模块 **不修改**，因为职责不在 UI 层：

- `message-builder.js` — 不拼 system prompt，Gateway 负责
- `proxy.js` — 不传 workspace header，Gateway 从配置读
- `roster-sync.js` — per-agent workspace 是另一回事，和全局 workspace 不冲突
- `session-sync.js` — 跟工作目录无关
- `chat-controller.js` — 跟工作目录无关

### 5.7 路径存储约定

- 全局 workspace 存绝对路径（如 `F:\fzz-Project\openclaw-web-ui`）
- 写入前 `path.resolve()` 标准化（消除 `./`、`..`、混合分隔符）
- `fs-store.resolveHome()` 可处理 `~` 开头路径，绝对路径直接返回，无需特殊处理

---

## 六、改动量估算

| 类型 | 文件数 | 行数 |
|------|--------|------|
| 新建 | 2（workspace-validator.js + workspace-picker.js） | ~110 |
| 修改 | 7（fs-store.js + routes.js + server.js + api.js + state.js + model-switcher.js + index.html） | ~95 |
| 总计 | 9 | ~205 |

预计执行时间：1.5-2 小时（含每步自检）。

---

## 七、前置依赖

- Step 1 创建的 `workspace-validator.js` 已写好（代码已存在但未 commit），需审核后确认是否保留或重写
- 其余 Step 均未开始执行

---

*本文档提交第三方审核，审核通过后按步骤依次执行，每步改完自检确认无误再继续。*
