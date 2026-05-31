# 代码质量债务 — 待下阶段集中处理

> 当前功能稳定，但存在严重的代码质量债务。
> 本文档记录所有待重构项，供下一阶段集中处理。

---

## 一、CSS 硬编码值

### 1.1 分割线颜色重复 5 处

**问题**：`rgba(0,0,0,0.08)` 在 5 个选择器中各写一次，改值要改 5 处。

| 行号 | 选择器 | 当前值 |
|------|--------|--------|
| 757 | `.message.assistant .bubble` | `border: 1px solid rgba(0,0,0,0.08)` |
| 904 | `.bubble hr` | `border-top: 1px solid rgba(0,0,0,0.08)` |
| 1125 | `.bubble-separator` | `border-top: 1px solid rgba(0,0,0,0.08)` |
| 1579 | `.agent-delegate-btns` | `border-top: 1px solid rgba(0,0,0,0.08)` |
| 2241 | `.msg-actions` | `border-top: 1px solid rgba(0,0,0,0.08)` |

**修复方案**：在 `style.css` 中新增 CSS 变量 `--border-subtle`，5 处统一引用。

### 1.2 其他潜在可变量化的值

- `rgba(0,0,0,0.05)` 作为 hover 背景出现 7 处（行 312, 427, 484, 492, 541, 1861, 1987）
- `rgba(0,0,0,0.04)` 作为背景/阴影出现 7 处（行 385, 493, 611, 1855, 1893, 1903, 225）
- `var(--border-light)` 在 `border-top` 中使用 4 处，和 `rgba(0,0,0,0.08)` 语义重叠

---

## 二、JS 重复逻辑

### 2.1 `msg-actions` 创建重复 3 次

[message-renderer.js](file:///f:/fzz-Project/openclaw-web-ui/web/js/components/message-renderer.js) 中三段完全相同的代码：

```javascript
// 行 200-203
const actions = document.createElement('div');
actions.className = 'msg-actions';
actions.innerHTML = '<button class="msg-act-btn" data-action="copy" title="复制">📋</button>';
bubble.appendChild(actions);

// 行 338-341（内容完全一样）
// 行 524-527（内容完全一样）
```

**修复方案**：抽取 `_ensureActions(bubble)` 工具函数。

### 2.2 `renderMarkdown + dataset.raw` 模式重复 5 次

```javascript
contentEl.innerHTML = renderMarkdown(content);
contentEl.dataset.raw = content;
```

出现位置：行 189-190、334-335、372-373、512-513、517-518。

**修复方案**：抽取 `_renderContent(contentEl, content)` 工具函数。

### 2.3 潜在问题

- 事件委托（行 213-225 的 `init`）硬绑定 `.messages-inner` DOM 选择器，若 DOM 结构变化需同步修改
- `_buildMessageElement` 函数（90 行）过长，内部逻辑包含头像/标签/气泡/内容/思考块/附件卡片/操作按钮，违反单一职责

---

## 三、重构目标

| 领域 | 改进方向 | 难度 |
|------|---------|------|
| CSS 变量化 | 消除硬编码 rgba，统一通过 `--border-*` 变量引用 | 低 |
| JS 抽函数 | `msg-actions` 创建 + `dataset.raw` 赋值 → 复用 | 低 |
| 函数拆分 | `_buildMessageElement` 拆分为 3-4 个职责清晰的小函数 | 中 |
| DOM 绑定 | 事件委托绕过硬 DOM 选择器，用配置化或数据属性 | 中 |

---

## 四、不在此次债务范围内的注意事项

- 所有改动不得改变现有行为/视觉
- 重构后单元/手动回归测试
- 先提交当前功能稳定的 commit，再开始重构
