# TOOLS.md — 工具与团队

## 技能使用规则

- 当任务匹配某个技能时，**优先使用技能**，不要自己摸索替代方案
- 技能通过 `exec` 工具调用，如 `exec node skills/xxx/xxx.js ...`
- **NEVER** 说"我做不到 X"，当你有技能可以做的时候
- 详细用法见各技能目录下的 `SKILL.md`

---

## 已安装技能

| 技能 | 版本 | 用途 | 位置 | 备注 |
|------|------|------|------|------|
| flowus-agent | v4.0 | FlowUs 读写/搜索/导出/数据库管理 | skills/flowus-agent/ | 需 FLOWUS_TOKEN；⚠️ 写入操作必须用 CLI，禁止用 MCP |
| web-search | — | Wikipedia + 海外网页搜索（走代理） | skills/web-search/ | 需 VPN 代理 127.0.0.1:9098 |
| zhihu-search | — | 知乎站内搜索（国内直连） | skills/zhihu-search/ | 不需代理 |
| md2wechat | — | Markdown 转微信公众号格式 | skills/md2wechat/ | 绑定给咪蒙 |
| guizang-social-card-skill | — | 社交卡片设计 | skills/guizang-social-card-skill/ | 绑定给设计师小王 |
| html-ppt-skill | — | HTML PPT 制作 | skills/html-ppt-skill/ | 绑定给设计师小王 |

### flowus-agent 特殊规则

> ⚠️ 写入/创建/删除操作**必须用 CLI 脚本**，禁止用 MCP 工具。MCP schema 校验与实际 API 有差异，会拦截合法请求导致反复失败。详见 `skills/flowus-agent/SKILL.md`。

---

## 搜索策略

1. 内部知识 → 优先
2. web-search.py（海外，走代理）→ 海外信息
3. zhihu-search.py（知乎，直连）→ 中文深度内容
4. curl 兜底 → 以上都不行时

**兜底**：内置 web_search / web_fetch 返回空或超时 → 立即切换 Python 搜索脚本，不要连续重试内置工具。

---

## 网络环境

**浏览器能上 Google ≠ 命令行也能上。** 命令行需手动配代理。

- **代理端口**: 127.0.0.1:9098（VPN 启动后生效）
- **代理检测**: `curl.exe -x http://127.0.0.1:9098 -s -o nul -w "%{http_code}" "https://www.google.com"` → 200 则正常
- **DNS 劫持**: github.com 等国外站点被 ISP 劫持，用 `nslookup github.com 8.8.8.8` 查真实 IP
- **GitHub**: 未装 gh CLI，通过 curl + REST API 操作

<!-- system-sync-start -->
## 团队成员

- 乔布斯 — Steve Jobs 的 AI 化身
- MrBeast — 野兽先生的 AI 化身
- 设计师小王 — 专业设计师
- 咪蒙 — 爆款文案写手
- 知乎搜搜 — 专注在知乎搜索信息
- 知识库小知 — 知识库管理员 - 负责 Notion/飞书 等的检索和拉取
<!-- system-sync-end -->
