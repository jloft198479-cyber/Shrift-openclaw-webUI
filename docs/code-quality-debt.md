# 代码质量债务 — 待下阶段集中处理

> 当前功能稳定，但存在严重的代码质量债务。
> 本文档记录所有待重构项，供下一阶段集中处理。

---

## 一、CSS 硬编码值

### 1.1 分割线颜色重复 5 处（✅ 已修复：2026-05-31）

- `rgba(0,0,0,0.08)` 5 处 → 统一为 `var(--border-subtle)`
- 修复方式：在 `style.css` 中新增 CSS 变量 `--border-subtle`，5 处统一引用

### 1.2 hover/表面背景硬编码（✅ 已修复：2026-05-31）

- `rgba(0,0,0,0.05)` 6 处 hover/active 背景 → 统一为 `var(--hover-bg)`
- `rgba(0,0,0,0.04)` 6 处表面背景 → 统一为 `var(--surface-hover)`
- `var(--border-light)` 在 `border-top` 中使用 4 处 → 统一为 `var(--border-subtle)`
- 注：`box-shadow` 中使用的 `rgba(0,0,0,0.04)` 保留（阴影语义不同），`--border-light` 用于 `background` 的保留（表面背景语义）

---

## 二、JS 重复逻辑

### 2.1 `msg-actions` 创建重复 3 次（✅ 已修复：2026-05-31）

抽取 `_ensureActions(bubble)` 工具函数，消除 3 处重复。

### 2.2 `renderMarkdown + dataset.raw` 模式重复 5 次（✅ 已修复：2026-05-31）

抽取 `_renderContent(contentEl, content)` 工具函数，消除 5 处重复。

### 2.3 潜在问题（⏳ 待处理）

- 事件委托（`init`）硬绑定 `.messages-inner` DOM 选择器，若 DOM 结构变化需同步修改
- `_buildMessageElement` 函数过长，内部逻辑包含头像/标签/气泡/内容/思考块/附件卡片/操作按钮，违反单一职责（✅ 已修复：2026-05-31，拆分为 4 个子函数）

---

## 三、重构目标

| 领域 | 改进方向 | 难度 | 状态 |
|------|---------|:----:|:----:|
| CSS 变量化 | 消除硬编码 rgba，统一通过 `--border-*` 变量引用 | 低 | ✅ 已完成 |
| JS 抽函数 | `msg-actions` 创建 + `dataset.raw` 赋值 → 复用 | 低 | ✅ 已完成 |
| 函数拆分 | `_buildMessageElement` 拆分为 4 个职责清晰的小函数 | 中 | ✅ 已完成 |
| DOM 绑定 | 事件委托绕过硬 DOM 选择器，用配置化或数据属性 | 中 | ⏳ 待处理 |

---

## 四、不在此次债务范围内的注意事项

- 所有改动不得改变现有行为/视觉
- 重构后单元/手动回归测试
- 先提交当前功能稳定的 commit，再开始重构
