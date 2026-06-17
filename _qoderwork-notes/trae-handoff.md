# QoderWork → Trae 交接记录

> QoderWork 临时接手期间的研究记录，供 Trae 恢复上下文时参考。
> **v2** — 已整合 Trae 审阅反馈 + 用户确认的修复原则
>
> **核心原则：安装路径是唯一真相源。通用性优先，不做个性化适配。存量差异靠数据迁移，不靠改代码。**

## 做了什么

1. 整体项目代码审查（server.js、routes.js、proxy.js、ws-client.js、fs-store.js、agent-routes.js、sse-manager.js、session-sync.js、roster-sync.js、前端全部模块）
2. 生成了技术架构图：`docs/architecture-diagram.html`
3. **深入研究技能生命周期**（安装 → 配置同步 → 卸载 → 同步），产出详细报告：`_qoderwork-notes/技能生命周期研究报告.md`

## 发现了什么（按优先级排序）

### 值得修的 Bug

**问题 5：`fs.watch` 过滤了 'rename' 事件**（server.js 第 201 行）— 严重度：中高
- 代码 `if (eventType !== 'change') return;` 忽略原子写入的 'rename' 事件
- 外部编辑器保存 openclaw.json 时不触发自动同步
- 修复：接受 `change` 和 `rename` 两种事件

**问题 1：`_syncSkillLinks` junction 清理逻辑错误**（roster-sync.js 第 58-59 行）— 严重度：中
- 条件 `skillIds.indexOf(name) < 0 && resolved.indexOf(globalSkillsDir) < 0` 导致指向全局目录的 junction 永不被清理
- 修复：改为 `if (skillIds.indexOf(name) < 0)` — 不在配置中就不该有 junction，这是通用逻辑
- ~~Trae 曾建议先给 main Agent 补 skills 字段再改代码~~ — **已否定**。正确做法是直接改代码，然后 `syncAllRosters()` 自动对齐磁盘状态。main Agent 没有 skills 配置，就不该有 junction，这才是安装路径即真相的体现

### 体验改善

**问题 2：TOOLS.md 双 "## 技能" 段落** — 系统自动段落与用户手写段落重名

### 不急的事

- 问题 3：技能扫描冗余 I/O（当前规模无感）
- 问题 4：Junction 重建容错（逻辑正确，仅权限边缘情况）
- 问题 6：无全局技能注册表（产品演进方向，当前可接受）

### 待讨论

**问题 7：技能名称不匹配**（中等严重度）
- 技能 ID 完全由目录名决定，无 frontmatter 覆盖
- ~~原方案：支持 SKILL.md frontmatter `id` 字段~~ — **需重新评估**。按照"安装路径即真相"原则，应该从安装流程保证目录名一致性，而不是用 frontmatter 打补丁。安装时目录名是什么，ID 就是什么，卸载时按 ID 清除，不存在映射层

## 用户特别强调的原则

- 逻辑正确性和体验流畅性是最高优先级
- 必须建立在 OpenClaw 官方标准之上，不自己造轮子
- 只做整合优化，不重复发明
- 取得共识再行动，不要一说完就噼里啪啦敲代码
- **通用性优先**：面向 GitHub 所有用户，不能为了兼容特定存量配置而写特殊分支
- **安装路径是唯一真相源**：安装生成什么就卸载清除什么，不能因为历史数据改变正常逻辑
- **硬编码是红线**：为贴合某个特定配置写特殊分支 = 硬编码 = 技术债

## 文件位置

- 研究报告：`_qoderwork-notes/技能生命周期研究报告.md`
- 修复原则：`_qoderwork-notes/修复原则.md`
- 架构图：`docs/architecture-diagram.html`
- 本交接记录：`_qoderwork-notes/trae-handoff.md`
