# 项目最高宪法

> 本文档是项目所有工作的最高准则。任何 AI 助手、任何开发者、任何会话，必须遵守以下原则。
> 违反其中任何一条，都视为工作不合格。

---

## 一、工作原则

### 实事求是
- 充分调研，以事实为基础
- **不瞎蒙，不猜测**——不确定的事情必须验证后再说
- 读源码、读文档、读实际文件，不准凭空推断

### 第一性原理
- 思考问题的本质，抓关键，不被表面现象迷惑
- 从用户角度出发，问"用户到底要什么"，而非"技术上能做什么"

### 最佳实践
- 务必结合成功实践，绝不闭门造车
- 参考 Claude UI 的质量标准——那是已证明的优秀架构

### 策略大于行动
- **最佳策略远胜于反复琢磨细节**
- 先想清楚整体方案，再动手。方向对了，细节才会对
- 想透再执行，不急着写代码

### 结构性看问题
- 结构性思维才能换来极简操作
- 先看全局依赖关系，再动局部代码

### 取得共识再行动
- 任何改动前必须与用户沟通确认
- **绝不允许"用户一说完就噼里啪啦敲代码"**

### 分步骤行动
- 不要一次性完成所有工作
- 每阶段完成后停下来，确认无误再继续
- 每步都要复查验证

---

## 二、执行纪律

### 搞清楚再执行
- 搞清楚指令、搞清楚问题、搞清楚影响范围再动手
- 不理解的地方必须问，不准猜

### 自检与验证
- 每改一处，立刻复查语法、逻辑、交叉引用
- 修改完成后必须站在用户角度体验结果
- 改了前端就刷新页面实测，不要假设"应该没问题"

### 任务不是结果，能用、好用才是结果
- 提交了代码 ≠ 完成了工作
- 用户打不开、点不动、没反应 = 工作不合格
- 每一步完成后必须站在用户角度实测，确认"能用且好用"才算完成

### 沉淀经验
- 每次被批评后，必须把教训沉淀到记忆和经验里
- **同样的错误不犯第二次**

---

## 三、架构原则

### 真理源自一处，全局引用
- 配置、状态、常量只有一份，其他地方只引用
- `State.js` 是唯一的状态管理中心
- `State.setState()` → 事件通知 → 组件响应，单向数据流

### 高内聚、低耦合
- 一个文件只做一件事
- 组件不直接操作其他组件的 DOM
- 控制器不直接知道视图的细节，视图不直接调 API

### 模块化、组件化、原子化
- UI 组件可独立渲染、独立销毁（有 `init/destroy`）
- 工具函数是纯函数，不依赖全局状态
- 功能单元可单独测试

### 更轻、更快、更强
- 不引入不必要的依赖
- DOM 操作节流（requestAnimationFrame）
- 错误边界保护，一处崩溃不影响全局

### 重结构，轻代码
- 好的结构比多的代码重要十倍
- 先搭架子，再填内容
- 拆分优于堆砌

---

## 四、启动命令

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

## 五、关键路径

| 资源 | 路径 |
|------|------|
| 项目根目录 | `F:\fzz-Project\openclaw-web-ui\` |
| 前端静态文件 | `F:\fzz-Project\openclaw-web-ui\web\` |
| OpenClaw 配置 | `D:\AppData\openclaw\openclaw.json` |
| OpenClaw 数据 | `D:\AppData\openclaw\` |
| Gateway URL | `http://127.0.0.1:18789` |
| Web UI URL | `http://localhost:3001` |
| Gateway Token | `hermes-local-dev` |

## 六、技术要点

- **15 个 JS 文件全部使用 `const/let`**（零 `var`）
- 必须给 try-catch 包裹所有异步回调和 session 操作
- 修改 `State.setState` 的字段必须检查 5 个引用文件
- `chat-view.js` 是核心但也是最脆弱的——570 行，改之前先画依赖图

---

## 七、踩坑经验

> 每次踩坑必须记录，**同样的错误不犯第二次**。

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
