# 产品上下文

> 每次会话必须读取本文档。详细文档见 `虾指挥-产品介绍.md` 和 `CODE-WIKI.md`。

---

## 一、产品是什么

虾指挥是 OpenClaw Gateway 的 Web UI，让用户通过浏览器与 AI Agent 团队交互。

核心价值：**让用户用最简单的方式完成复杂任务。**

---

## 二、两个核心模式

| 模式 | 用户做什么 | 技术实现 | 状态 |
|------|-----------|---------|------|
| **私聊模式** (direct) | 直接和指定 Agent 对话 | `model = openclaw/agentId` | ✅ 一直能跑通 |
| **智能调度** (dispatch) | 和主 Agent 对话，主 Agent 自动分配 | `model = openclaw/main` + `sessions_spawn` + announce | ✅ 已跑通 |

**委派模式已放弃** — 私聊已能直接对话，智能调度已能自动分配，委派模式多余。

---

## 三、关键设计决策

1. **原生能力优先**：用 Gateway 的 `sessions_spawn` + announce，不自己造轮子
2. **两个模式互不干扰**：通过 `State.interactionMode` 判断，`if` 分支清晰分离
3. **组件化**：独立功能拆成独立文件，不混入业务代码
4. **资源节约**：省 token/CPU/内存，代码简洁是质量指标

---

## 四、已解决的关键问题

1. **进度条不显示**：Gateway `payload.data` 从对象变成了 JSON 字符串，需先解析
2. **角色标签混乱**：dispatch 模式下 `onAgentSwitch` 不应更新 actualAgentId
3. **旧对话加载**：`SessionStore.remove` 竞态，DELETE 完成前不能刷新列表
4. **announce 回传**：session-sync.js 读取 session 文件检测新消息

---

## 五、详细文档索引

| 文档 | 内容 |
|------|------|
| `虾指挥-产品介绍.md` | 产品定位、核心场景、使用流程、架构图 |
| `CODE-WIKI.md` | 完整技术架构、模块详解、API 文档、数据流 |
| `project_rules.md` | 工作原则、架构原则、踩坑经验 |
