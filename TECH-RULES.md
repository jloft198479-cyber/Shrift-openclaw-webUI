# TECH-RULES.md — 架构与技术原则

> 详细文档见项目 `.trae/rules/tech-rules.md`，此处仅保留核心索引。

---

## 架构核心原则

1. **真理源自一处** — 配置、状态、常量只有一份，其他只引用
2. **高内聚低耦合** — 一个文件只做一件事
3. **绝不硬编码** — 所有动态内容从单一数据源派生
4. **资源节约** — 省 token/内存/CPU，代码简洁是质量指标
5. **退化安全** — 任何外部依赖都可能失败，必须有 fallback

---

## 启动命令

```powershell
F:\fzz-Project\openclaw-web-ui\start.ps1   # 一键启动
F:\fzz-Project\openclaw-web-ui\stop.ps1    # 一键停止
```

---

## 关键路径

| 资源 | 路径 |
|------|------|
| 项目根目录 | `F:\fzz-Project\openclaw-web-ui\` |
| OpenClaw 配置 | `D:\AppData\openclaw\openclaw.json` |
| Gateway URL | `http://127.0.0.1:18789` |
| Web UI URL | `http://localhost:3001` |

---

## 踩坑经验（速查）

1. 空字符串路径陷阱 — `path.dirname("")` 返回 `"."`
2. 闭包变量只 init 一次 — init 参数不对，后续全失败
3. 绕过模块直接写文件 = 代码堆砌
4. PowerShell 5.1 兼容性 — 不是 PS7
5. Start-Job 生命周期绑定脚本
6. Session ID 路径遍历漏洞
7. 不要死磕 — 第一性原理倒推
8. 文件写入权限 fallback
9. URL 路径参数必须 decodeURIComponent
10. 硬编码技能命令导致角色混乱
11. Gateway 配置 schema 严格校验
12. **通用性优先于个性化** — 虾指挥面向所有 GitHub 用户，遇问题必须先解决通用方案，禁止为适配当前环境做个性化补丁（如在 SKILL.md 硬编码 name 去迎合旧配置名）。技能的名称由安装流程决定，配置跟随技能走。如果卸载后配置残留、安装后引用没更新，说明卸载/安装流程的代码有缺陷，应该修代码，而不是绕过流程硬适配

> 详细说明见 `.trae/rules/tech-rules.md`
