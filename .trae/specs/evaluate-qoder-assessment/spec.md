# Qoder 评估报告审阅 Spec

## Why
用户要求审阅 qoder 对虾指挥项目对话逻辑和技能调用逻辑的稳固性评估，判断其分析是否属实、是否认同、有无补充。

## What Changes
- 本文档为纯评估/审阅性质，不涉及代码改动
- 对 qoder 报告中的每个核心结论进行"属实/不属实/部分属实"判定
- 给出认同或不认同的理由
- 补充 qoder 遗漏或分析不到位的问题

## Impact
- Affected specs: 无（纯评估文档）
- Affected code: 无

---

## 一、Qoder 核心结论验证

### 结论 1：对话核心流程"稳固"
**判定：属实，认同**

qoder 对对话主线的评估准确：
- 输入防护（isStreaming/isDispatching 双守卫）确实有效
- 请求构造（全量历史发给 Gateway，不做前端截断）是正确的架构决策
- Proxy 层（token 服务端注入、disconnect forwarding）设计正确
- SSE 流处理（fetch + ReadableStream 手动解析）是 POST 场景下的正确选择

**补充**：qoder 提到"缺输入长度上限校验"，这确实存在——`Constants.LIMIT.MAX_CHARS` 是 8000，但 `_updateInputState()` 只做显示警告，不阻止发送。不过对个人工具来说优先级极低。

### 结论 2：消息构造逻辑"稳固，身份标记修复到位"
**判定：属实，认同**

三管齐下的修复（onDone 无条件存 agentId、message-builder 兜底加 [主助理 said]、嵌入上下文块重写）确实彻底。announce 到达顺序问题 qoder 也正确指出——这是 LLM 理解力问题而非前端逻辑错误。

### 结论 3：状态管理"够用，但有技术债"
**判定：属实，认同，且有重要补充**

qoder 正确指出布尔标志位缺乏形式化状态机、守卫分散在多个文件。但 qoder 的分析有一个**重要遗漏**：

**补充 1：State 的 backward-compatibility getter/setter 不触发事件**

qoder 的第二次深入分析提到了这个问题（state.js 的 getter/setter 直接赋值不触发事件），但最终综合评估中**没有把它列为风险**。这实际上是一个比"缺形式化状态机"更紧迫的问题：

- `State.streaming = true` 不触发事件，但 `State.setState({ streaming: true })` 触发
- 如果代码中混用两种写法，UI 订阅者可能收不到通知
- 需要排查当前代码库中是否有直接赋值的情况

### 结论 4：Dispatch 调度"有结构性缺陷"
**判定：部分属实，qoder 内部自相矛盾，需修正**

**qoder 的自相矛盾**：
- 第一次综合评估说"没有超时机制"、"用户唯一的逃生通道是手动点红色取消按钮"
- 第二次深入分析发现代码中**实际存在** `_dispatchLongTimer`（300s/5分钟硬超时）和 `_dispatchSafetyTimer`（15s 安全计时器）
- 但最终中文总结仍然说"没有超时机制"

**事实**：代码中确实有超时机制（15s 安全计时器 + 300s 硬截止），只是不够完善：
- 15s 安全计时器调用 `_checkDispatchComplete()`，但如果 `_completedSubagents.size === 0`（所有子 agent 都静默失败），会直接 return，无法清状态
- 300s 硬截止能兜底，但 5 分钟对用户来说太长
- 真正的问题是**不是没有超时，而是超时逻辑有漏洞**——当所有子 agent 都没完成时，15s 安全计时器形同虚设

**修正后的结论**：Dispatch 有超时机制，但存在"全失败场景下 15s 安全计时器失效"的漏洞，导致用户可能需要等 5 分钟才能恢复。

### 结论 5：技能调用逻辑"稳固"
**判定：部分属实，需修正**

qoder 第一次分析说"没有存在性校验"，第二次深入分析发现 `_validateSkillRefs()` 函数确实存在。最终中文总结仍说"缺存在性校验"——**这是错误的**。

**事实**：
- `roster-sync.js` 中有 `_validateSkillRefs()` 函数（line 352-383），会自动移除不存在的技能引用并输出警告
- `agent-routes.js` 中 `_resolveSkills()` 会标记 `{ missing: true }`
- 技能引用存在性校验是有的，qoder 的第一次分析基于旧代码或遗漏了

**修正后的结论**：技能调用逻辑稳固，且已有存在性校验（_validateSkillRefs）。qoder 说"缺存在性校验"不属实。

### 结论 6：Session Sync "设计最扎实的部分"
**判定：属实，认同**

偏移量增量同步确实是系统里设计最好的模块。agentId 剥离 bug 确实存在。

---

## 二、Qoder 遗漏的重要问题

### 遗漏 1：`NO_REPLY` 哨兵值过于脆弱
qoder 的深入分析提到了这个问题，但最终中文总结**没有把它列为风险**。

当前逻辑：`st.text.includes('NO_REPLY')` → 清空整个响应文本。问题：
- 如果 LLM 在讨论"不回复"的概念时输出了 `NO_REPLY` 字符串，整个响应会被清空
- 没有边界检查，子串匹配而非整行/整段匹配
- 这是一个**magic string**，违反了"绝不硬编码"原则

**建议优先级**：P1。改为正则匹配整行 `^NO_REPLY$` 或使用特殊标记格式如 `<!-- NO_REPLY -->`。

### 遗漏 2：`_spawnDetected` 是布尔值而非计数器
qoder 的深入分析提到了这个问题，但最终中文总结没有强调。

当前逻辑：`_spawnDetected = true` 只是一个 flag，不记录 spawn 数量。如果主 agent 连续 spawn 3 个子 agent，`_spawnDetected` 仍然是 `true`，无法区分 1 个还是 3 个。

这直接影响了 `_checkDispatchComplete()` 的计数准确性——`activeSubagents` 的数量来自 WS 事件追踪，而非 spawn 检测。

### 遗漏 3：`session-sync.js` 单 `_retryTimer` 设计缺陷
qoder 的深入分析发现了这个问题，但最终中文总结没有提及。

`_scheduleRead()` 使用单个 `_retryTimer`，如果两个不同 session 的事件快速到达，第一个 session 的读取可能被覆盖，导致 announce 丢失。

### 遗漏 4：O(n^2) 流式渲染性能问题
qoder 的深入分析发现了 `renderBubble()` 每次增量都全量重解析 markdown 的问题，但最终中文总结没有提及。

对于长响应（数千字符），这会导致 O(n^2) 的渲染开销，可能产生可见的卡顿。

### 遗漏 5：SSE 断连期间 announce 丢失
qoder 的深入分析提到了"WS 断连期间事件丢失，没有 catch-up 机制"，但最终中文总结没有强调。

当前架构下，如果浏览器 SSE 连接断开（哪怕只是几秒），期间产生的 announce 事件会永久丢失，因为：
- session-sync 是事件驱动的，不是轮询的
- SSE 重连后不会回放丢失的事件
- 没有定期扫描机制来补偿

### 遗漏 6：`ErrorHandler` 模块定义但未使用
qoder 的深入分析发现了 `error-handler.js` 定义了完整的错误处理框架但从未被 `ChatController` 和 `Api` 使用，错误处理是 ad-hoc 的。最终中文总结没有提及。

---

## 三、Qoder 分析方法论评价

### 优点
1. **并行调查策略**：3 个 Explore Agent 并行分析不同模块，效率高
2. **代码级验证**：不是泛泛而谈，而是读了源码后给出具体行号和代码引用
3. **分层评估**：区分了"稳固/够用/不牢靠"三个等级，不是一刀切
4. **优先级排序**：P0/P1/P2 分级合理

### 不足
1. **内部自相矛盾**：第一次分析和第二次深入分析的结论不一致（超时机制、技能校验），最终总结没有统一
2. **深入分析发现的问题被中文总结遗漏**：NO_REPLY、O(n^2) 渲染、单 _retryTimer 等问题在深入分析中发现了，但最终报告没有纳入
3. **对"没有超时"的结论过于绝对**：实际有 15s+300s 双重超时，只是 15s 在全失败场景下失效，不应说"没有超时机制"

---

## 四、修正后的综合评估

| 模块 | 稳固性 | 修正后的一句话 |
|------|--------|---------------|
| 对话主流程 | **稳固** | 主线可靠，缺输入长度强制校验（低优先级） |
| 消息构造 | **稳固** | 身份标记修复彻底，NO_REPLY 哨兵值需加固 |
| 状态管理 | **够用+隐患** | 布尔标志够用，但 getter/setter 不触发事件是真实风险 |
| Dispatch 调度 | **不牢靠** | 有超时但全失败场景下 15s 失效，需等 5 分钟；取消不传服务端 |
| 技能调用 | **稳固** | 简洁正确，已有存在性校验（qoder 说"缺"是错的） |
| Session Sync | **扎实+隐患** | 偏移量同步设计好，但单 _retryTimer 和 SSE 断连丢事件是真实风险 |

### 修正后的建议优先级

**P0**：Dispatch 全失败场景修复——`_completedSubagents.size === 0` 时 15s 安全计时器应直接清状态，而非 return。改动约 3 行代码。

**P1**：
- NO_REPLY 哨兵值加固（改为整行匹配或特殊标记格式）
- Session-sync agentId 剥离范围修正
- State getter/setter 统一为只走 setState（消除不触发事件的隐患）

**P2**：
- session-sync 单 _retryTimer 改为队列或 Map
- SSE 断连后 announce catch-up 机制
- 流式渲染 O(n^2) 优化（增量 markdown 解析）
- ErrorHandler 模块实际启用

**不急**：形式化状态机重构、SSE 断连恢复、config 写入原子化、readConfig 缓存。
