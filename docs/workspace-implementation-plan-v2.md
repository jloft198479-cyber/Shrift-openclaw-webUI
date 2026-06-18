# 虾指挥 — 工作目录（Workspace）功能实施方案

> 版本：v2.0 | 日期：2026-06-16 | 状态：待审核
> 基于 v1.0 审核反馈修订，修复 P0 阻塞问题，补充遗漏项。

---

## 一、用户诉求

1. **核心需求**：让虾指挥支持"选择工作文件夹"功能，类似 QoderWork 的体验——用户指定一个项目文件夹后，虾指挥根据该文件夹内的提示文件（AGENTS.md、SOUL.md 等）和项目文件进行工作。

2. **全局生效**：工作目录是全局配置，所有 agent 共享，不是 per-session 的。

3. **优先级**：工作目录的项目上下文优先，全局 awareness 目录（`~/.qoderworkcn/awareness/`）作为兜底。

4. **不重复造轮子**：和 OpenClaw 官方保持一致，UI 层只做配置写入和界面展示，不自行读取文件、不拼接 prompt、不处理上下文加载——这些由 Gateway 负责。

5. **UI 层职责**：只做两件事——选路径 + 写配置。

6. **UI 位置**：工作目录指示器放在模型切换器右侧，两者在同一行 `.model-bar` 内：
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

当前 `openclaw.json` 顶层未设置 `workspace` 字段。所有 agent 的项目上下文来源是全局 awareness 目录。

### 2.3 per-agent workspace 与全局 workspace 的区别

| 维度 | 全局 workspace（我们要做的） | per-agent workspace（已有） |
|------|---------------------------|---------------------------|
| 路径 | 用户项目目录（绝对路径） | agent 配置目录（相对路径，如 `workspace-虾指挥`） |
| 内容 | 用户写的 AGENTS.md、SOUL.md | 系统生成的 TOOLS.md、IDENTITY.md |
| 维护者 | 用户选择 | roster-sync.js 自动同步 |
| 用途 | 项目上下文 | agent 配置 |
| 存储位置 | openclaw.json 顶层 | openclaw.json agents.list[].workspace |

两者职责不同、目录不同、不冲突。

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
5. **浏览器兼容**：不依赖 `webkitdirectory`（无法获取绝对路径），改用后端目录浏览 API

### 3.2 v1.0 → v2.0 关键变更

| 变更项 | v1.0 方案 | v2.0 方案 | 原因 |
|--------|----------|----------|------|
| 文件夹选择方式 | `<input webkitdirectory>` | 后端目录浏览 API + 前端文本输入 | 浏览器安全策略禁止获取绝对路径 |
| 后端 API 数量 | 3 个 | 4 个（新增 `/api/workspace/browse`） | 支持目录浏览 |
| 白名单缓存失效 | 未处理 | PUT/DELETE 后主动清缓存 | 避免 403 |
| PROTECTED_DIRS | 7 个 | 12 个（补充驱动器根目录、macOS 系统目录） | 防止误选整盘 |
| State 事件映射 | 未提及 | 新增 `workspace` 事件映射 | 确保 UI 响应式更新 |
| 修改文件数 | 5（实际 7） | 8 | 补齐遗漏 |

### 3.3 模块划分

**后端 4 个模块**：

| 模块 | 职责 | 文件 | 行数预估 |
|------|------|------|----------|
| 路径校验器 | 验证路径合法性、安全性、有效性 | `workspace-validator.js`（已有，需增强） | ~80 |
| 配置读写 | 从 openclaw.json 读写 workspace 字段 | `fs-store.js`（加 2 个函数） | ~25 |
| 目录浏览 | 列出指定目录的子目录，供前端选择 | `workspace-validator.js`（加 1 个函数） | ~25 |
| 路由 + 白名单 | API 接口处理 + 文件代理白名单更新 | `routes.js`（加路由） + `server.js`（白名单+缓存失效） | ~60 |

**前端 3 个模块**：

| 模块 | 职责 | 文件 | 行数预估 |
|------|------|------|----------|
| workspace-picker | UI 组件：显示路径、选择/清除按钮、目录浏览面板 | `components/workspace-picker.js`（新建） | ~120 |
| API 调用 | workspace 的 HTTP 请求封装 | `api.js`（加 4 个函数） | ~30 |
| 状态 + 渲染集成 | workspace 状态管理 + model-bar 渲染集成 | `state.js`（加字段+事件映射） + `model-switcher.js`（集成） | ~25 |

**总计**：新建 1 个文件（前端 workspace-picker.js），修改 7 个现有文件，约 365 行代码。

---

### 3.4 后端 API 设计

| 方法 | 路径 | 职责 | 请求体 | 返回 |
|------|------|------|--------|------|
| GET | `/api/workspace` | 返回当前 workspace 配置 + 目录有效性 | 无 | `{ path: "F:\\...", exists: true }` 或 `{ path: "", exists: false }` |
| PUT | `/api/workspace` | 设置 workspace（写入 openclaw.json） | `{ path: "F:\\..." }` | `{ success: true, path: "F:\\..." }` 或 `{ success: false, reason: "..." }` |
| DELETE | `/api/workspace` | 清除 workspace 配置 | 无 | `{ success: true }` |
| POST | `/api/workspace/browse` | 列出指定目录的子目录 | `{ path: "F:\\fzz-Project" }` | `{ path: "F:\\fzz-Project", children: [{name: "openclaw-web-ui", path: "F:\\fzz-Project\\openclaw-web-ui"}] }` 或 `{ error: "..." }` |

#### PUT 接口流程

1. 调 `workspace-validator.validateWorkspacePath(body.path)`
2. 校验通过 → `fs-store.writeWorkspace(validated.resolved)` 写入 openclaw.json
3. 清除 `_getWorkspaceAllowedDirs` 缓存（`_wsAllowedDirsCache = null; _wsAllowedDirsCacheTime = 0;`）
4. 返回成功 + 标准化后的路径

#### GET 接口流程

1. `fs-store.readWorkspace()` 读取配置中的 workspace
2. `workspace-validator.checkWorkspaceExists(path)` 检查目录是否仍存在
3. 返回路径 + exists 标记（前端据此显示警告）

#### POST /api/workspace/browse 流程

1. 调 `workspace-validator.validateBrowsePath(body.path)` — 基本校验（存在+是目录+非系统目录）
2. `fs.readdirSync` 读取子目录列表（仅目录，不返回文件）
3. 返回 `{ path, children: [{name, path}] }`

#### DELETE 接口流程

1. `fs-store.writeWorkspace('')` 清除 workspace 字段
2. 清除白名单缓存
3. 返回成功

### 3.5 前端 UI 设计

#### 3.5.1 workspace-picker 组件

位于 `.model-bar` 内，模型选择器右侧：

```
.model-bar: [模型: DeepSeek ▼]  ·  [📂 openclaw-web-ui  [改]]
```

**交互方式**（替代 webkitdirectory）：

采用**文本输入 + 目录浏览面板**双模式：

1. 点击"选/改"按钮 → 弹出 workspace 面板
2. 面板包含：
   - 文本输入框：用户可直接粘贴绝对路径
   - "浏览"按钮：打开目录浏览面板
   - "确认"按钮：提交路径
   - "清除"按钮：清除当前 workspace（仅在已设置时显示）
3. 目录浏览面板：
   - 显示当前路径的子目录列表
   - 点击子目录进入下一级
   - 点击"选择此目录"确认当前路径
   - 面板顶部显示当前路径，可点击任意段跳转

**面板 HTML 结构**：

```html
<div class="workspace-panel">
  <div class="workspace-panel-header">
    <input type="text" class="workspace-path-input" placeholder="输入或粘贴目录路径…">
    <button class="workspace-browse-btn">浏览</button>
  </div>
  <div class="workspace-browse-area" style="display:none">
    <div class="workspace-breadcrumb"><!-- 路径面包屑 --></div>
    <div class="workspace-dir-list"><!-- 子目录列表 --></div>
    <button class="workspace-select-btn">选择此目录</button>
  </div>
  <div class="workspace-panel-footer">
    <button class="workspace-confirm-btn">确认</button>
    <button class="workspace-clear-btn">清除</button>
  </div>
</div>
```

**指示器状态**：

| 状态 | 显示 | 样式 |
|------|------|------|
| 未设置 | `📂 未设置 [选]` | 默认色 |
| 已设置且有效 | `📂 openclaw-web-ui [改]` | 默认色 |
| 已设置但目录丢失 | `📂 openclaw-web-ui [改]` | 名称红色 + tooltip "目录不可访问" |

**设置成功后**：显示 toast "工作目录已更新，新会话生效"

### 3.6 文件代理白名单更新

`server.js` 的 `_getWorkspaceAllowedDirs()` 当前只包含 agent workspace 目录、全局 skills 目录和 uploads 目录。加入全局 workspace 后，前端 `/api/file` 代理才能访问项目目录的文件。

修改位置：`_getWorkspaceAllowedDirs()` 函数内，在 agent workspace 循环之后加：

```javascript
// 全局 workspace 目录
var globalWs = store.resolveHome(data.workspace || '');
if (globalWs) dirs.push(path.resolve(globalWs));
```

**缓存失效**：PUT/DELETE workspace 成功后，需清除白名单缓存。由于 `_wsAllowedDirsCache` 和 `_wsAllowedDirsCacheTime` 是 server.js 内的局部变量，需导出清除函数：

```javascript
// server.js 新增导出
function invalidateAllowedDirsCache() {
  _wsAllowedDirsCache = null;
  _wsAllowedDirsCacheTime = 0;
}
```

在 routes.js 的 PUT/DELETE handler 中调用。

### 3.7 workspace-validator.js 增强

已有文件需增强以下内容：

1. **PROTECTED_DIRS 扩展**：

```javascript
const PROTECTED_DIRS = [
  // Windows
  'c:\\windows', 'c:\\program files', 'c:\\program files (x86)',
  'c:\\programdata', 'c:\\users',
  // macOS
  '\\system', '\\library', '\\applications',
  // Linux
  '\\etc', '\\usr', '\\var', '\\sys', '\\bin', '\\sbin', '\\boot',
];
```

2. **驱动器根目录保护**：不允许选择整个驱动器根目录（如 `C:\`、`D:\`）

```javascript
// 在 validateWorkspacePath 中增加
if (/^[a-zA-Z]:\\?$/.test(resolved)) {
  return { valid: false, reason: '不允许选择驱动器根目录' };
}
```

3. **新增 `browseDirectory` 函数**：

```javascript
function browseDirectory(dirPath) {
  var result = validateBrowsePath(dirPath);
  if (!result.valid) return { error: result.reason };

  var children = [];
  try {
    var entries = fs.readdirSync(result.resolved);
    for (var i = 0; i < entries.length; i++) {
      var full = path.join(result.resolved, entries[i]);
      try {
        if (fs.statSync(full).isDirectory()) {
          children.push({ name: entries[i], path: full });
        }
      } catch (e) {}
    }
  } catch (e) {
    return { error: '无法读取目录内容' };
  }
  children.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { path: result.resolved, children: children };
}

function validateBrowsePath(dirPath) {
  // 与 validateWorkspacePath 类似但不要求"必须是项目目录"
  // 只检查：非空、存在、是目录、非系统保护目录
  if (!dirPath || typeof dirPath !== 'string') {
    return { valid: false, reason: '路径不能为空' };
  }
  var resolved = path.resolve(dirPath);
  var lower = resolved.toLowerCase();
  for (var i = 0; i < PROTECTED_DIRS.length; i++) {
    if (lower.startsWith(PROTECTED_DIRS[i])) {
      return { valid: false, reason: '不允许浏览系统目录' };
    }
  }
  try {
    if (!fs.statSync(resolved).isDirectory()) {
      return { valid: false, reason: '路径不是目录' };
    }
  } catch (e) {
    return { valid: false, reason: '目录不存在或无法访问' };
  }
  return { valid: true, resolved: resolved };
}
```

### 3.8 fs-store.js 新增函数

```javascript
function readWorkspace() {
  var data = readConfig();
  return (data && data.workspace) || '';
}

function writeWorkspace(absPath) {
  var data = readConfig();
  if (!data) return false;
  data.workspace = absPath || '';
  return writeConfig(data);
}
```

导出新增：`readWorkspace`、`writeWorkspace`

### 3.9 State 事件映射

在 `state.js` 中：

1. 新增 `workspace` 分组：

```javascript
/** 工作目录状态 */
workspace: {
  path: '',
  exists: true,
},
```

2. `groupKeyToEvent` 新增：

```javascript
'workspace.path': 'workspace',
'workspace.exists': 'workspace',
```

3. `flatKeyToEvent` 新增：

```javascript
workspace: 'workspace',
```

4. `flatToGroup` 新增：

```javascript
workspace: 'workspace.path',
```

5. 向后兼容 getter/setter：

```javascript
get workspace() { return this.workspace.path; },
set workspace(val) { this.workspace.path = val; },
```

> **注意**：这里 `workspace` 既是分组对象名又是扁平 key，getter/setter 会与分组对象冲突。因此不添加 getter/setter，统一使用 `State.workspace.path` 访问。

### 3.10 Api.js 新增函数

```javascript
getWorkspace: async function () {
  return await this._fetch('/api/workspace');
},

setWorkspace: async function (path) {
  return await this._fetch('/api/workspace', {
    method: 'PUT',
    body: JSON.stringify({ path: path }),
  });
},

clearWorkspace: async function () {
  return await this._fetch('/api/workspace', {
    method: 'DELETE',
  });
},

browseDirectory: async function (path) {
  return await this._fetch('/api/workspace/browse', {
    method: 'POST',
    body: JSON.stringify({ path: path }),
  });
},
```

### 3.11 model-switcher.js 集成

`updateBar()` 方法内，在模型选择器 HTML 之后追加 workspace 指示器：

```javascript
updateBar: function () {
  const bar = document.querySelector('.model-bar');
  if (!bar) return;
  // ... 现有模型选择器渲染 ...

  // workspace 指示器
  const wsPath = State.workspace.path;
  const wsExists = State.workspace.exists;
  const wsName = wsPath ? wsPath.split(/[/\\]/).pop() : '未设置';
  const wsBtn = wsPath ? '改' : '选';
  const wsClass = wsPath && !wsExists ? ' workspace-warning' : '';

  html += '<span class="bar-separator">·</span>';
  html += '<span class="workspace-indicator' + wsClass + '">';
  html += '<span class="workspace-icon">📂</span>';
  html += '<span class="workspace-name">' + escapeHtml(wsName) + '</span>';
  html += '<button class="workspace-btn" id="workspace-change-btn">' + wsBtn + '</button>';
  html += '</span>';

  bar.innerHTML = html;

  // 现有 model-select 事件绑定 ...

  // workspace 按钮事件
  const wsBtnEl = bar.querySelector('#workspace-change-btn');
  if (wsBtnEl) {
    wsBtnEl.addEventListener('click', function () {
      WorkspacePicker.toggle();
    });
  }
},
```

同时在 `State.on('workspace', ...)` 事件中调用 `ModelSwitcher.updateBar()` 刷新。

---

## 四、实施步骤

每步改完后自检（diff + grep），确认无误再继续。

### Phase 1：后端基础

**Step 1**：增强 `workspace-validator.js`

- 扩展 `PROTECTED_DIRS`（补充 `c:\users`、macOS、Linux 系统目录）
- 新增驱动器根目录保护（`/^[a-zA-Z]:\\?$/` 正则）
- 新增 `validateBrowsePath(dirPath)` 函数
- 新增 `browseDirectory(dirPath)` 函数
- 更新 `module.exports`

**Step 2**：修改 `fs-store.js`

- 新增 `readWorkspace()` — 从 openclaw.json 顶层读 workspace 字段
- 新增 `writeWorkspace(absPath)` — 写入 workspace 字段到 openclaw.json
- 复用现有 `readConfig/writeConfig`，不新增存储机制
- 更新 `module.exports`

**Step 3**：修改 `server.js`

- `_getWorkspaceAllowedDirs()` 加全局 workspace 白名单
- 新增 `invalidateAllowedDirsCache()` 函数并导出
- 在 `routes.init()` 的 deps 中传入 `invalidateAllowedDirsCache`

**Step 4**：修改 `routes.js`

- 加 4 个路由（GET/PUT/DELETE `/api/workspace` + POST `/api/workspace/browse`）
- PUT/DELETE 成功后调 `invalidateAllowedDirsCache()`
- PUT 调 `workspace-validator.validateWorkspacePath` + `fs-store.writeWorkspace`
- GET 调 `fs-store.readWorkspace` + `workspace-validator.checkWorkspaceExists`
- browse 调 `workspace-validator.browseDirectory`

### Phase 2：前端 UI

**Step 5**：修改 `api.js` + `state.js`

- `api.js`：加 `getWorkspace()`、`setWorkspace(path)`、`clearWorkspace()`、`browseDirectory(path)`
- `state.js`：加 `workspace` 分组（path + exists），加事件映射（`workspace.path` → `workspace` 事件）

**Step 6**：创建 `components/workspace-picker.js`

- `WorkspacePicker.toggle()` — 显示/隐藏面板
- `WorkspacePicker.render()` — 渲染面板 HTML
- `WorkspacePicker.onConfirm()` — 文本输入确认
- `WorkspacePicker.onBrowse()` — 打开目录浏览
- `WorkspacePicker.onSelectDir()` — 选择浏览中的子目录
- `WorkspacePicker.onClear()` — 清除 workspace
- `WorkspacePicker.hide()` — 关闭面板
- 组件自包含，不依赖外部 UI 框架

**Step 7**：修改 `model-switcher.js` + `index.html`

- `model-switcher.js`：`updateBar()` 方法内加 workspace 指示器渲染 + 事件绑定
- `model-switcher.js`：监听 `State.on('workspace', ...)` 事件刷新
- `index.html`：加 `<script>` 标签引入 workspace-picker.js（在 model-switcher.js 之后）

**Step 8**：修改 `app.js`

- `init()` 函数中，在 `Api.fetchModels()` 之后加 `Api.getWorkspace()` 调用
- 将返回数据写入 `State.setState({ workspace: { path, exists } })`

### Phase 3：样式 + 验证

**Step 9**：修改 `style.css`

- 新增 workspace 相关样式（`.workspace-indicator`、`.workspace-panel`、`.workspace-path-input`、`.workspace-browse-area`、`.workspace-dir-list`、`.workspace-warning` 等）
- 复用现有 `.model-pill` 风格保持视觉一致性

**Step 10**：最终验证

- git diff 全量检查
- grep 确认无遗漏引用
- 手动测试：
  - 选目录 → 写配置 → 新会话验证上下文加载 → 清除目录 → 检查警告
  - 浏览目录 → 进入子目录 → 选择 → 确认
  - 直接粘贴路径 → 确认
  - 边界测试：选系统目录（应拒绝）、选驱动器根目录（应拒绝）、选不存在目录（应提示）、选后删除目录（应警告）

---

## 五、注意事项

### 5.1 安全策略

- **路径校验**：PUT 接口必须走 `validateWorkspacePath`，拒绝空值、穿越、系统目录、驱动器根目录、不存在的路径
- **浏览校验**：browse 接口必须走 `validateBrowsePath`，拒绝系统保护目录
- **白名单更新**：`_getWorkspaceAllowedDirs` 必须加全局 workspace，否则 `/api/file` 代理返回 403
- **缓存失效**：PUT/DELETE 后必须清除白名单缓存，否则 30s 内新目录不可访问
- **配置写入**：复用 `fs-store.writeConfig`，不自行写文件（保持原子性和一致性）
- **前端信任**：不信任前端传入的路径格式，后端 `path.resolve()` 标准化后再校验

### 5.2 已知风险

| 风险 | 影响 | 应对 |
|------|------|------|
| 两份 AGENTS.md | 项目目录和 per-agent workspace 可能都有 AGENTS.md，Gateway 优先级不确定 | 先观察实际行为，如冲突再在 UI 加提示 |
| 目录丢失 | 用户设置后删除了该目录 | GET 返回 `exists: false`，前端红色警告 |
| 会话固化 | 换工作目录后已有会话不更新 | toast 提示"新会话生效" |
| 并发写入 | 两个请求同时写 openclaw.json 可能丢数据 | 写入频率极低，风险可接受；`writeConfig` 的 tmp+rename 有一定保护 |
| `c:\users` 保护 | 用户可能想选 `C:\Users\xxx\projects` | 只保护 `c:\users` 根目录，子目录允许（`startsWith` 匹配） |

> **关于 `c:\users` 保护的细化**：实际使用中用户项目常在 `C:\Users\xxx\projects` 下，直接保护整个 `c:\users` 会阻止正常使用。改为只保护 `c:\users` 本身（不允许选用户根目录），子目录允许。实现方式：`lower === PROTECTED_DIRS[i] + '\\'` 或 `lower === PROTECTED_DIRS[i]`（精确匹配而非 startsWith）。**最终决定：`c:\users` 从 PROTECTED_DIRS 移除，改为单独的"不允许选择用户主目录"规则。**

### 5.3 不改什么

以下模块 **不修改**，因为职责不在 UI 层：

- `message-builder.js` — 不拼 system prompt，Gateway 负责
- `proxy.js` — 不传 workspace header，Gateway 从配置读
- `roster-sync.js` — per-agent workspace 是另一回事，和全局 workspace 不冲突
- `session-sync.js` — 跟工作目录无关
- `chat-controller.js` — 跟工作目录无关
- `model-picker.js` — 是 agent 编辑弹窗内的模型选择器，与 model-bar 无关

### 5.4 路径存储约定

- 全局 workspace 存绝对路径（如 `F:\fzz-Project\openclaw-web-ui`）
- 写入前 `path.resolve()` 标准化（消除 `./`、`..`、混合分隔符）
- `fs-store.resolveHome()` 可处理 `~` 开头路径，绝对路径直接返回，无需特殊处理

### 5.5 配置文件监听联动

`server.js` 已有 `fs.watch` 监听 `openclaw.json` 变更（line 199-220），写入 workspace 后会自动触发：
- `rosterSync.syncAllRosters()`
- `sseManager.broadcast({ type: 'agents-updated' })`

前端可通过 SSE `agents-updated` 事件感知配置变更。但 workspace 状态更新走独立的 API 响应返回更直接，不需要依赖此监听。

---

## 六、改动量估算

| 类型 | 文件 | 行数 |
|------|------|------|
| 增强 | `workspace-validator.js`（已有） | ~40 新增 |
| 修改 | `fs-store.js` | ~25 |
| 修改 | `server.js` | ~15 |
| 修改 | `routes.js` | ~60 |
| 修改 | `api.js` | ~30 |
| 修改 | `state.js` | ~25 |
| 新建 | `components/workspace-picker.js` | ~120 |
| 修改 | `components/model-switcher.js` | ~20 |
| 修改 | `app.js` | ~8 |
| 修改 | `index.html` | ~1 |
| 修改 | `css/style.css` | ~60 |
| **总计** | **11 个文件（1 新建 + 10 修改）** | **~404** |

---

## 七、文件影响矩阵

```
workspace-validator.js  ████████░░  增强（+40行）
fs-store.js             ███░░░░░░  修改（+25行）
server.js               ██░░░░░░░  修改（+15行）
routes.js               ██████░░░  修改（+60行）
api.js                  ███░░░░░░  修改（+30行）
state.js                ███░░░░░░  修改（+25行）
workspace-picker.js     ██████████  新建（~120行）
model-switcher.js       ██░░░░░░░  修改（+20行）
app.js                  █░░░░░░░░  修改（+8行）
index.html              ░░░░░░░░░  修改（+1行）
style.css               ██████░░░  修改（+60行）
```

---

*本文档提交审核，审核通过后按步骤依次执行，每步改完自检确认无误再继续。*
