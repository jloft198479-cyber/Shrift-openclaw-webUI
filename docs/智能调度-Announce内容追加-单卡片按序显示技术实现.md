# 智能调度 Announce 内容追加 — 单卡片按序显示技术实现

> 本文档记录虾指挥 Web UI 中「智能调度模式下子 Agent 结果按时间顺序追加到同一张气泡卡片内」功能的完整技术实现。
> 此功能看似简单，实则经历了多次失败迭代，核心难点在于：SSE 流与 announce 异步事件的时序协调、内容去重、DOM 追加而非替换。
> 目的：防止未来代码改动破坏此功能，便于他人复现或优化。

---

## 一、功能概述

**需求**：智能调度模式下，主 Agent 的回复和各子 Agent 的 announce 结果，必须按时间顺序追加在同一张 assistant 气泡卡片内，而非每条结果创建新气泡或覆盖之前的内容。

**效果示意**：

```
┌─────────────────────────────────────┐
│  虾指挥                              │
│  好的，我来安排小周搜索，咪蒙写文案   │  ← 主 Agent 流式输出
│─────────────────────────────────────│
│  小周                                │
│  已搜索到12条知乎素材...             │  ← 子 Agent announce 追加
│─────────────────────────────────────│
│  咪蒙                                │
│  # 马斯克成了全美公敌...             │  ← 子 Agent announce 追加
│─────────────────────────────────────│
│  虾指挥                              │
│  全部完成，给你汇总一下...           │  ← 主 Agent 最终 announce 追加
└─────────────────────────────────────┘
```

---

## 二、为什么难 — 核心挑战

### 2.1 两条独立的数据通道

智能调度模式下，消息到达前端有两条完全独立的通道：

| 通道 | 机制 | 内容 | 特点 |
|---|---|---|---|
| **SSE 流** | `/v1/chat/completions` 流式响应 | 主 Agent 的实时文本 | 有明确的 `[DONE]` 结束标记 |
| **Announce 事件** | session-sync.js 读文件 → SSE 广播 | 子 Agent 完成后的合成回复 | 异步、延迟、可能多次触发 |

**难点**：SSE 流结束后，announce 事件才陆续到达。前端必须在流式结束后仍然能向同一张气泡追加内容。

### 2.2 Announce 事件的异步性

```
时间线：
  t0  用户发送消息
  t1  主 Agent 开始流式输出（SSE 流）
  t2  主 Agent 调用 sessions_spawn → SSE 流 [DONE]
  t3  子 Agent 开始执行（前端此时看到的是空白等待）
  t4  子 Agent 完成 → announce 事件到达
  t5  主 Agent 合成结果 → 又一个 announce 事件到达
  t6  另一个子 Agent 完成 → 又一个 announce 事件到达
```

每个 announce 事件都是独立的，前端需要：
- 识别这是对当前对话的追加，而非新消息
- 按到达顺序追加到同一张气泡
- 不重复渲染已显示的内容

### 2.3 内容去重

主 Agent 的流式输出和 announce 结果可能包含相同内容（主 Agent 在 announce 中重新陈述了流式输出中说过的内容），必须去重。

---

## 三、架构设计

### 3.1 整体数据流

```
Gateway WS 事件
    │
    ▼
session-sync.js ─── 读主 Agent session 文件(.jsonl) ─── 解析新 assistant 消息
    │
    ▼
server.js ─── 广播 SSE: {type:"announce-result", messages, agentId, sessionId}
    │
    ▼
ws-bridge.js ─── 监听 "announce-result" SSE 事件
    │
    ▼
ChatController.handleAnnounceResult(messages, agentId, sessionId)
    │
    ├── 1. 内容指纹去重
    ├── 2. 更新进度块为 done
    ├── 3. MessageRenderer.appendToLastAssistantMessage(content, agentId)
    ├── 4. SessionInteraction.appendToLastAssistantMessage(session, content, agentId)
    └── 5. 检查调度是否全部完成
```

### 3.2 两条追加路径

| 层 | 方法 | 作用 |
|---|---|---|
| **DOM 层** | `MessageRenderer.appendToLastAssistantMessage()` | 在最后一条 assistant 气泡内插入分隔线 + agent 标签 + 内容块 |
| **数据层** | `SessionInteraction.appendToLastAssistantMessage()` | 在 session.messages 的最后一条 assistant 消息后追加 `\n\n---\n\n[agentId] content` |

两层必须同步更新：DOM 层负责即时显示，数据层负责持久化（刷新页面后能恢复）。

---

## 四、关键实现

### 4.1 DOM 层追加 — `MessageRenderer.appendToLastAssistantMessage()`

这是核心方法。它不创建新气泡，而是在现有气泡内追加内容块。

```javascript
appendToLastAssistantMessage: function (content, agentId) {
  const inner = document.querySelector('.messages-inner');
  const messages = inner.querySelectorAll('.message.assistant');
  const lastMsg = messages[messages.length - 1];
  const bubble = lastMsg.querySelector('.bubble');

  // 创建分隔线
  const separator = document.createElement('div');
  separator.className = 'bubble-separator';

  // 创建内容块（含 agent 标签 + markdown 渲染内容）
  const block = document.createElement('div');
  block.className = 'bubble-content-block';
  block.dataset.agentId = resolvedAgentId;

  const label = document.createElement('div');
  label.className = 'agent-label';
  label.innerHTML = _buildAgentLabelHtml(agent, displayName);
  block.appendChild(label);

  const contentEl = document.createElement('div');
  contentEl.className = 'agent-content';
  contentEl.innerHTML = renderMarkdown(content);
  block.appendChild(contentEl);

  // 插入到 msg-actions 之前（保持复制按钮在最后）
  const actions = bubble.querySelector('.msg-actions');
  if (actions) {
    bubble.insertBefore(separator, actions);
    bubble.insertBefore(block, actions);
  } else {
    bubble.appendChild(separator);
    bubble.appendChild(block);
  }
}
```

**关键设计决策**：
- 用 `bubble-separator`（1px 分隔线）而非新气泡来区分不同 Agent 的内容
- 每个 `bubble-content-block` 带 `data-agent-id`，便于后续定位和更新
- 插入位置在 `msg-actions` 之前，确保复制按钮始终在气泡底部

### 4.2 数据层追加 — `SessionInteraction.appendToLastAssistantMessage()`

```javascript
appendToLastAssistantMessage: function (session, content, agentId) {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    if (session.messages[i].role === 'assistant') {
      var existing = session.messages[i].content || '';
      var separator = existing ? '\n\n---\n\n' : '';
      var prefix = agentId ? '[' + agentId + '] ' : '';
      session.messages[i].content = existing + separator + prefix + content;
      return;
    }
  }
  session.messages.push({ role: 'assistant', content: content });
}
```

**关键设计决策**：
- 用 `\n\n---\n\n` 作为文本分隔符（Markdown 水平线），刷新页面重新渲染时能正确显示分隔
- 用 `[agentId]` 前缀标记来源 Agent，便于调试
- 不 push 新消息，复用最后一条 assistant 消息

### 4.3 内容指纹去重

主 Agent 流式输出的内容和 announce 回传的内容可能重复，必须去重。

```javascript
// onDone 时记录主 Agent 流式输出的指纹
var fp = finalText.substring(0, 200).replace(/\s/g, '');
self._announcedFingerprints.add(fp);

// handleAnnounceResult 时检查指纹
var fp = (lastMsg.content || '').substring(0, 200).replace(/\s/g, '');
if (this._announcedFingerprints.has(fp)) return;  // 跳过重复内容
this._announcedFingerprints.add(fp);
```

**为什么用指纹而非全量比较**：
- 内容可能很长，全量比较性能差
- `substring(0,200).replace(/\s/g,'')` 足以区分不同内容，同时忽略空白差异
- 集合查找 O(1)，高效

### 4.4 dispatching 状态管理

主 Agent 流式结束后，如果检测到 spawn，需要进入 `dispatching` 状态：

```javascript
onDone: function (resolvedAgentId) {
  if (self._spawnDetected) {
    self._spawnDetected = false;
    State.setState({ dispatching: true });  // 先设状态
    self._updateDispatchStatusBar();
    // 安全超时：15秒无进度自动结束
    self._dispatchSafetyTimer = setTimeout(function () { ... }, 15000);
    // 强制超时：120秒强制结束
    self._dispatchLongTimer = setTimeout(function () { ... }, 120000);
  }
  StreamRenderer.endStreaming();  // 再结束流式（此时 dispatching=true，按钮不会恢复）
}
```

**时序关键**：必须先设 `dispatching=true`，再调 `endStreaming()`。否则 `endStreaming` 内部的 `_resetSendBtn` 会恢复发送按钮，用户可能在子 Agent 执行中发送新消息。

### 4.5 session-sync.js — Announce 检测机制

session-sync.js 通过读取主 Agent 的 session 文件（.jsonl）来检测新消息：

1. 收到 WS 事件 → 提取 sessionKey → 延迟 500ms 读取对应文件
2. 用文件偏移量（`_fileOffsets`）只读取新增部分，避免重复处理
3. 解析新增行中的 assistant 消息
4. 广播 `announce-result` SSE 事件
5. 如果没有新消息，最多重试 2 次（间隔 1 秒）

**文件偏移量机制**：
```javascript
// 首次遇到文件：记录当前大小作为偏移量，不读取历史内容
if (!(targetFile in _fileOffsets)) {
  _fileOffsets[targetFile] = fs.statSync(targetFile).size;
  return;
}
// 后续读取：只读偏移量之后的新增内容
const currentOffset = _fileOffsets[targetFile] || 0;
const readSize = stat.size - currentOffset;
// ... 读取并更新偏移量
_fileOffsets[targetFile] = stat.size;
```

---

## 五、踩坑记录

### 坑 1：替换 vs 追加（最初的设计错误）

- **现象**：子 Agent 结果覆盖了主 Agent 的内容
- **根因**：最初用 `MessageRenderer.updateLastAssistantMessage()` 替换整个气泡内容，而非追加
- **修复**：新增 `appendToLastAssistantMessage()` 方法，用 `insertBefore` 在气泡内追加分隔线 + 内容块
- **教训**：追加和替换是完全不同的语义，不能用同一个方法。追加需要考虑插入位置（在 msg-actions 之前）

### 坑 2：onDone 时序 — dispatching 设置在 endStreaming 之后

- **现象**：主 Agent 流式结束后，发送按钮短暂恢复又禁用，闪烁
- **根因**：`StreamRenderer.endStreaming()` 先执行，内部 `_resetSendBtn` 检测到 `dispatching=false` 恢复按钮；然后才设 `dispatching=true`
- **修复**：先设 `dispatching=true`，再调 `endStreaming`；`_resetSendBtn` 中也检查 `State.dispatching`
- **教训**：状态设置必须在 UI 更新之前，否则 UI 会闪烁

### 坑 3：announce 事件重复触发

- **现象**：同一条 announce 结果被渲染两次
- **根因**：session-sync.js 的重试机制可能在文件尚未完全写入时就读取，导致部分内容被重复广播
- **修复**：内容指纹去重（`_announcedFingerprints` 集合）
- **教训**：异步事件天然可能重复，消费者必须幂等

### 坑 4：_lastRenderedContent 全局变量导致跨会话污染

- **现象**：切换会话后，新会话的 announce 结果被误判为重复而不渲染
- **根因**：用全局 `_lastRenderedContent` 变量做去重，切换会话后变量未清空
- **修复**：改用 `_announcedFingerprints` 集合，在 `_clearDispatchState` 中清空
- **教训**：全局状态必须与生命周期绑定，切换会话时必须清理

### 坑 5：handleAnnounceResult 中死代码

- **现象**：先 `_completedSubagents.add(resolvedAgentId)` 再检查 `!_completedSubagents.has(resolvedAgentId)`，第二段永远是死代码
- **根因**：逻辑合并错误
- **修复**：合并为一段，先检查再 add
- **教训**：写完代码立刻复查逻辑，不要假设"应该没问题"

### 坑 6：_updateDispatchStatusBar 没有重置 opacity

- **现象**：`_hideDispatchStatusBar` 设 `opacity:0` 后 300ms 内又调 `_updateDispatchStatusBar`，状态栏显示但透明
- **根因**：`_updateDispatchStatusBar` 没有重置 opacity 为 1
- **修复**：在 `_updateDispatchStatusBar` 开头加 `bar.style.opacity = '1'`
- **教训**：CSS 过渡动画和 JS 状态更新可能冲突，必须确保每次显示时重置所有视觉属性

### 坑 7：handleSubagentProgress/Done 没有检查 interactionMode

- **现象**：私聊模式下子 Agent 工具调用也触发进度显示
- **修复**：加了 `if (State.interactionMode !== 'dispatch') return;`
- **教训**：dispatch 专属功能必须加模式守卫

---

## 六、气泡内 DOM 结构

一次完整的 dispatch 对话后，气泡内的 DOM 结构如下：

```html
<div class="bubble">
  <!-- 主 Agent 流式输出 -->
  <div class="agent-content">
    <p>好的，我来安排小周搜索，咪蒙写文案</p>
  </div>

  <!-- 子 Agent 进度块（完成后保留） -->
  <div class="bubble-progress done" data-agent-id="agent-mpr5t5r2vi0e">
    <span class="bubble-progress-spinner done-icon"></span>
    <span class="bubble-progress-name">小周</span>
    <span class="bubble-progress-label">已完成</span>
  </div>

  <!-- 子 Agent 1 announce 结果 -->
  <div class="bubble-separator"></div>
  <div class="bubble-content-block" data-agent-id="agent-mpr5t5r2vi0e">
    <div class="agent-label">小周</div>
    <div class="agent-content"><p>已搜索到12条知乎素材...</p></div>
  </div>

  <!-- 子 Agent 2 announce 结果 -->
  <div class="bubble-separator"></div>
  <div class="bubble-content-block" data-agent-id="agent-mpls0tivyzea">
    <div class="agent-label">咪蒙</div>
    <div class="agent-content"><p># 马斯克成了全美公敌...</p></div>
  </div>

  <!-- 主 Agent 最终汇总 -->
  <div class="bubble-separator"></div>
  <div class="bubble-content-block" data-agent-id="main">
    <div class="agent-label">虾指挥</div>
    <div class="agent-content"><p>全部完成，给你汇总一下...</p></div>
  </div>

  <!-- 复制按钮（始终在最后） -->
  <div class="msg-actions">
    <button class="msg-act-btn" data-action="copy">📋</button>
  </div>
</div>
```

---

## 七、关键文件索引

| 文件 | 方法 | 职责 |
|---|---|---|
| `message-renderer.js` L342 | `appendToLastAssistantMessage()` | DOM 层追加：分隔线 + agent 标签 + 内容块 |
| `message-renderer.js` L466 | `updateLastAssistantMessage()` | DOM 层替换：更新整个气泡内容（旧方法，dispatch 模式不再使用） |
| `session-interaction.js` L71 | `appendToLastAssistantMessage()` | 数据层追加：`\n\n---\n\n[agentId] content` |
| `session-interaction.js` L60 | `updateLastAssistantMessage()` | 数据层替换：覆盖最后一条 assistant 消息（旧方法） |
| `chat-controller.js` L206 | `handleAnnounceResult()` | announce 事件处理入口：去重 + 进度更新 + 追加 + 完成检查 |
| `chat-controller.js` L125 | `onDone()` | 流式结束：记录指纹 + 设 dispatching + 安全超时 |
| `session-sync.js` L87 | `_doRead()` | 文件读取：偏移量增量读取 + 解析 assistant 消息 + 广播 |
| `style.css` L1136 | `.bubble-separator` | 分隔线样式 |
| `style.css` L1142 | `.bubble-content-block` | 内容块样式 |

---

## 八、验证方法

### 8.1 功能验证

1. 切换到智能调度模式
2. 发送一个需要 spawn 多个子 Agent 的任务
3. 检查：
   - 主 Agent 流式输出是否在气泡内
   - 子 Agent announce 结果是否追加在同一气泡内（而非新气泡）
   - 各段内容之间是否有分隔线
   - 每个 announce 段落前是否有正确的 agent 标签
   - 刷新页面后，历史内容是否正确恢复（含分隔线和标签）

### 8.2 去重验证

1. 发送 dispatch 任务
2. 观察 debug 日志中 `handleAnnounceResult` 的调用次数
3. 确认没有重复渲染（同一段内容只出现一次）

### 8.3 数据层验证

```javascript
// 在浏览器控制台检查 session 数据
const session = SessionStore.get(State.currentSessionId);
const lastAssistant = session.messages.filter(m => m.role === 'assistant').pop();
console.log(lastAssistant.content);
// 应看到用 --- 分隔的多段内容
```

---

## 九、已知限制与未来优化

1. **刷新页面后 agent 标签丢失**：数据层用 `[agentId]` 前缀存储，但重新渲染时不会还原为带颜色的 agent 标签，只显示纯文本
2. **长内容气泡性能**：多个子 Agent 的 announce 结果全部追加在同一气泡内，内容很长时 DOM 节点数可能较多
3. **announce 事件延迟**：session-sync.js 有 500ms 初始延迟 + 最多 2 次重试，极端情况下 announce 结果可能延迟 2.5 秒才显示
4. **跨 session 路由**：如果用户在 dispatching 期间切换会话，announce 结果会被路由到目标 session 的存储但不显示在当前页面
