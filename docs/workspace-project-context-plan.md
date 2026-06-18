# 项目上下文引导语方案

> 状态：已确认，待实施
> 日期：2026-06-16

## 一、背景

虾指挥的"临时办公室"功能通过 `agents.defaults.repoRoot` 配置项目目录。OpenClaw 的 `repoRoot` 仅在 Runtime 行显示路径，不自动读取项目目录下的任何文件。三份外部调研（GLM、qclaw、第三方）一致确认：在不修改 Gateway 源码的前提下，没有完美的自动注入方案。

## 二、方案选择过程

### 被否决的方案

| 方案 | 否决原因 |
|------|---------|
| symlink/mount 挂载 | 依赖操作系统行为，跨平台不一致，重启可能失效，`resolveRootPath` 可能拦截 |
| 镜像文件复制到 workspace | 需要同步管理，glob pattern 需动态更新，切换项目需改配置重启 Gateway |
| 子 Agent workspace 指向项目目录 | 管理复杂，`skipBootstrap` 需手动配置，污染项目目录风险 |
| 自定义 hook 插件 | 开发成本高，Gateway 升级可能破坏兼容性 |
| 会话指令触发 | 不够自动化，消耗额外 token |

### 核心判断

所有自动注入方案都在**对抗 OpenClaw 的设计意图**，天然脆弱。而 OpenClaw 的设计哲学是 Agent 按需获取信息，这本身是合理的。我们只需要让 Agent **知道该读什么**，而非强行把内容灌入 prompt。

## 三、最终方案：AGENTS.md 引导语

### 原理

利用 OpenClaw 最核心、最稳定的机制——workspace 目录下的 AGENTS.md 自动注入 prompt。在 AGENTS.md 中追加一段"项目上下文"引导语，告诉 Agent 当前项目目录及应读取的规则文件。

### 工作流程

```
用户设置 repoRoot = "F:\fzz-Project\openclaw-web-ui"
  ↓
虾指挥后端在 AGENTS.md 末尾追加引导段落：
  ## 当前项目
  项目目录: F:\fzz-Project\openclaw-web-ui
  执行项目相关任务时，请先读取该目录下的规则文件（CLAUDE.md、.cursorrules 等）。
  ↓
Gateway 下次组装 prompt 时自动加载 AGENTS.md → 引导语生效
  ↓
用户清除 repoRoot
  ↓
虾指挥后端移除该段落 → 引导语消失
```

### 引导语格式

```markdown
## 当前项目

项目目录: {repoRoot绝对路径}
执行项目相关任务时，请先读取该目录下的规则文件（如 CLAUDE.md、.cursorrules、.trae/rules/*.md 等），遵循其中的项目规范和约定。
```

### 优势

| 维度 | 评估 |
|------|------|
| 新增代码 | 极少——roster-sync 里加一个段落生成/移除函数 |
| 新增依赖 | 零——用现有的 AGENTS.md 注入机制 |
| 稳定性 | 和 AGENTS.md 注入一样稳定——OpenClaw 最核心的机制 |
| 可剥离 | 删掉段落生成函数即可，不影响任何其他代码 |
| 降级安全 | 即使引导语没生效，Agent 仍能看到 Runtime 行的 repo=xxx |
| 跨平台 | 无操作系统差异 |

### 半自动的合理性

引导语方案是"半自动"——Agent 知道该读什么文件，但仍需主动 `read`。这反而是更合理的：

1. 项目规则文件可能很大，全量注入浪费 token
2. Agent 按需读取更精准——只读和当前任务相关的部分
3. 符合 OpenClaw 设计哲学——Agent 按需获取，而非全量灌入

## 四、实施要点

1. 在 `roster-sync.js` 中新增 `_buildProjectContextSection(repoRoot)` 函数
2. 在 `syncSubAgentRoster()` 中调用，将引导语段落追加到 AGENTS.md 末尾
3. 在 workspace PUT/DELETE API 成功后，触发 roster-sync 刷新
4. 引导语段落用固定标记（如 `<!-- project-context -->`）包裹，便于精确移除
5. 清除 repoRoot 时，移除引导语段落

## 五、相关调研文档

- `C:\Users\FZZ198~1.NOV\Desktop\GLM的回复.txt`
- `C:\Users\FZZ198~1.NOV\Desktop\openclaw-调研.md`
- `C:\Users\FZZ198~1.NOV\Desktop\OpenClaw项目目录自动注入调研.pdf`
