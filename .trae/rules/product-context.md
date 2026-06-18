# 产品上下文

> 每次会话必须读取本文档。详细文档见 `虾指挥-产品介绍.md` 和 `CODE-WIKI.md`。

---

## 一、产品是什么

虾指挥是 OpenClaw Gateway 的 Web UI，让用户通过浏览器与 AI Agent 团队交互。

核心价值：**让用户用最简单的方式完成复杂任务。**

---

## 二、三种交互模式

| 模式 | 用户做什么 | 技术路径 | 状态 |
|------|-----------|---------|------|
| **私聊** (direct) | 直接找某个 Agent 对话 | `model = openclaw/agentId` | ✅ |
| **委派** (delegate) | 告诉主 Agent "让 XX 去做某事" | `model = openclaw/main` + 主 Agent spawn **指定**子 Agent | ✅ 通过 dispatch 自然支持 |
| **智能调度** (dispatch) | 告诉主 Agent "帮我做某事"，由它自行安排 | `model = openclaw/main` + 主 Agent **自动判断** spawn 谁 | ✅ |

**委派不需要独立的 UI 入口**——它是 dispatch 模式下的自然用法。区别只在于用户是否指定了执行者：指定了就是委派，没指定就是智能调度。底层都是 `sessions_spawn` + announce，代码层面统一为 dispatch 模式。

---

## 三、关键设计决策

1. **原生能力优先**：用 Gateway 的 `sessions_spawn` + announce，不自己造轮子
2. **两种技术路径**：direct（指定 agentId）和 dispatch（走主 Agent），通过 `State.interactionMode` 判断，`if` 分支清晰分离
3. **组件化**：独立功能拆成独立文件，不混入业务代码
4. **资源节约**：省 token/CPU/内存，代码简洁是质量指标
5. **会话切换前统一清理**：`_beforeSwitch()` 收敛模式——endStreaming + _clearDispatchState + hideIndicator，三入口统一调用
6. **事件驱动队列去重**：session-sync 用 `_pendingReads` Map 替代单变量，避免覆盖丢失
7. **SSE broadcast 返回 boolean**：无客户端时返回 false，offset 不推进，等重连重读

---

## 四、已解决的关键问题

### 早期问题（产品迭代期）
1. **进度条不显示**：Gateway `payload.data` 从对象变成了 JSON 字符串，需先解析
2. **角色标签混乱**：dispatch 模式下 `onAgentSwitch` 不应更新 actualAgentId
3. **旧对话加载**：`SessionStore.remove` 竞态，DELETE 完成前不能刷新列表
4. **announce 回传**：session-sync.js 读取 session 文件检测新消息

### 架构审查修复（2026-06-17 四批次共 18 项）

| 批次 | 范围 | 修复项 | 状态 |
|------|------|--------|------|
| 批次1 | 止血速修 | P1-2 WorkspacePicker 泄漏、P1-5 模态框异步竞态、P2-1 VirtualList 引用、P2-5 marked onerror、P3-2 _debounceTimer、P2-2 附件 handlers、P2-4 resize 监听器 | ✅ |
| 批次2 | 状态机与并发 | P0-2 会话切换状态清理（_beforeSwitch 收敛）、P0-3 session-sync 队列去重、P0-6 SSE broadcast 返回值 | ✅ |
| 批次3 | 渲染与 Token | P3-1 流式滚动 rAF 合并、P0-1 图片 dataUrl 剥离 | ✅ |
| 批次4 | 异步可取消+数据原子 | P1-3 idle timeout 60s、P1-6 abortController 重构、P2-3 ws-client timer 管理、P0-5 目录 rename 原子性 | ✅ |
| 审核补漏 | Blocker+竞态 | B-1 ws-client clearTimeout 遗漏、P1-4 dispatch timer 竞态 | ✅ |

### 已知限制（可接受，暂不修）
- **P1-1 流式全文重解析**：涉及冻结文件 stream-renderer.js，解冻后优先处理
- **P0-1 历史截断**：依赖 Gateway ContextPruning+Compaction 兜底，前端不重复实现
- **P0-4 direct 模式屏蔽 announce**：需产品决策
- **P1-3 fetch 阶段无超时保护**：server.js 180s socket 超时兜底

---

## 五、详细文档索引

| 文档 | 内容 |
|------|------|
| `虾指挥-产品介绍.md` | 产品定位、核心场景、使用流程、架构图 |
| `CODE-WIKI.md` | 完整技术架构、模块详解、API 文档、数据流 |
| `project_rules.md` | 工作原则、架构原则、踩坑经验 |
