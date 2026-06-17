/**
 * roster-sync.js — Agent Roster 同步
 *
 * 职责：
 * - 管理 skill 链接（symlink/junction）
 * - 校验 allowAgents 引用完整性
 * - 解绑 skill 时同步更新 roster
 * - 同步 Team Members + Skills 到 TOOLS.md（精简格式）
 * - 清理 AGENTS.md 中旧版残留的 Team Members / Skills 段落
 *
 * 注：AGENTS.md 的 Sub-Agents 写入已被移除（方案B验证通过）。
 * OpenClaw 原生 sessions_spawn 发现机制不依赖 AGENTS.md 中的子 Agent 列表，
 * 写入是冗余的，且会破坏 LLM provider prefix cache。
 * Team Members 和 Skills 信息已迁移到 TOOLS.md，作为环境备忘录的一部分。
 *
 * 依赖：fs-store（readConfig, writeConfig, resolveHome, _resolveGlobalSkillsDir, readFile, writeFile, scanGlobalSkills, scanExtraDirsSkills）
 */

const fs = require('fs');
const path = require('path');
const store = require('./fs-store');

function _syncSkillLinks(skillIds, workspace) {
  const wsSkillsDir = path.join(workspace, 'skills');
  try { fs.mkdirSync(wsSkillsDir, { recursive: true }); } catch (e) {}
  const globalSkillsDir = store._resolveGlobalSkillsDir();
  if (!globalSkillsDir) return;

  const managed = {};
  try {
    fs.readdirSync(wsSkillsDir).forEach(function (name) {
      const p = path.join(wsSkillsDir, name);
      try {
        const stat = fs.lstatSync(p);
        if (stat.isSymbolicLink()) {
          managed[name] = p;
        } else if (stat.isDirectory()) {
          // Recognize orphan copies: plain directories whose name matches a global skill.
          // These are stale copies (not junctions) that should be replaced with links.
          const globalCounterpart = path.join(globalSkillsDir, name);
          if (fs.existsSync(globalCounterpart)) {
            managed[name] = p;
          }
        }
      } catch (e) {}
    });
  } catch (e) {}

  for (const name in managed) {
    try {
      const stat = fs.lstatSync(managed[name]);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(managed[name]);
        const resolved = path.resolve(path.dirname(managed[name]), target);
        if (!fs.existsSync(resolved)) {
          // Broken link → remove
          try { fs.unlinkSync(managed[name]); } catch (e) {}
        } else if (skillIds.indexOf(name) < 0) {
          // Not in skillIds → remove (regardless of link target)
          try { fs.rmSync(managed[name], { recursive: true, force: true }); } catch (e) {}
        }
        // Otherwise: in skillIds → keep
      } else if (stat.isDirectory()) {
        if (skillIds.indexOf(name) < 0) {
          // Orphan directory not in skillIds → remove
          try { fs.rmSync(managed[name], { recursive: true, force: true }); } catch (e) {}
        } else {
          // Orphan copy matching a configured skill → replace with junction
          const globalSrc = path.join(globalSkillsDir, name);
          try { fs.rmSync(managed[name], { recursive: true, force: true }); } catch (e) {}
          try {
            if (process.platform === 'win32') {
              fs.symlinkSync(globalSrc, managed[name], 'junction');
            } else {
              fs.symlinkSync(globalSrc, managed[name], 'dir');
            }
          } catch (e) {
            console.error('[Roster] Failed to replace orphan copy with junction for "' + name + '": ' + e.message);
          }
        }
      }
    } catch (e) {}
  }

  skillIds.forEach(function (skillId) {
    const linkPath = path.join(wsSkillsDir, skillId);
    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink()) return;
      fs.rmSync(linkPath, { recursive: true, force: true });
    } catch (e) {}
    const src = path.join(globalSkillsDir, skillId);
    if (!fs.existsSync(src)) return;
    try {
      if (process.platform === 'win32') {
        fs.symlinkSync(src, linkPath, 'junction');
      } else {
        fs.symlinkSync(src, linkPath, 'dir');
      }
    } catch (e) {
      console.error('[Roster] Failed to create link for skill "' + skillId + '" → ' + src + ': ' + e.message);
    }
  });
}

function _validateAllowAgents(agentList) {
  const validIds = new Set();
  for (let i = 0; i < agentList.length; i++) {
    validIds.add(agentList[i].id);
  }
  let changed = false;
  // 清理无效引用和自引用
  for (let i = 0; i < agentList.length; i++) {
    const sub = agentList[i].subagents;
    if (!sub || !Array.isArray(sub.allowAgents)) continue;
    const before = sub.allowAgents.length;
    sub.allowAgents = sub.allowAgents.filter(function (id) {
      return validIds.has(id) && id !== agentList[i].id; // 过滤自引用
    });
    if (sub.allowAgents.length !== before) {
      console.warn('[Roster] Cleaned ' + (before - sub.allowAgents.length) + ' dangling/self-ref allowAgents ref(s) from agent ' + agentList[i].id);
      changed = true;
    }
  }
  // 自动补全：main/default agent 的 allowAgents 应包含所有其他 agent
  for (let i = 0; i < agentList.length; i++) {
    const a = agentList[i];
    if (a.id !== 'main' && !a.default) continue;
    if (!a.subagents) a.subagents = {};
    if (!a.subagents.allowAgents) a.subagents.allowAgents = [];
    for (let j = 0; j < agentList.length; j++) {
      if (agentList[j].id === a.id) continue; // 不加自己
      if (a.subagents.allowAgents.indexOf(agentList[j].id) < 0) {
        a.subagents.allowAgents.push(agentList[j].id);
        console.log('[Roster] Auto-added agent "' + agentList[j].id + '" to allowAgents of "' + a.id + '"');
        changed = true;
      }
    }
  }
  return changed;
}

const _SYS_SECTION_START = '<!-- system-sync-start -->';
const _SYS_SECTION_END = '<!-- system-sync-end -->';

function _buildTeamSection(agentId, agentList, allowedIds) {
  const lines = ['## 团队成员', ''];
  for (let i = 0; i < agentList.length; i++) {
    const a = agentList[i];
    if (a.id === agentId) continue;
    // 如果有 allowAgents 列表，只展示被允许的成员
    if (allowedIds && allowedIds.indexOf(a.id) < 0) continue;
    let name = a.name || a.id;
    let desc = a.description || (a.identity && a.identity.description) || '';
    if (desc.indexOf(name + ' — ') === 0) desc = desc.slice(name.length + 3);
    if (desc.indexOf(name + '-') === 0) desc = desc.slice(name.length + 1);
    const dashIdx = desc.indexOf(' — ');
    if (dashIdx > 0 && dashIdx < 10) {
      let afterDash = desc.slice(dashIdx + 3);
      if (afterDash.indexOf(name) === 0) {
        afterDash = afterDash.slice(name.length);
        if (afterDash.indexOf('，') === 0 || afterDash.indexOf(',') === 0) afterDash = afterDash.slice(1);
        desc = afterDash;
      }
    }
    const short = desc.length > 30 ? desc.slice(0, 30) + '…' : desc;
    const idTag = (name !== a.id) ? ' (' + a.id + ')' : '';
    lines.push('- ' + name + idTag + (short ? ' — ' + short : ''));
  }
  return lines.join('\n');
}

function _buildSkillSection(skillIds) {
  if (!skillIds || skillIds.length === 0) return '';
  const globalSkills = store.scanGlobalSkills();
  const extraSkills = store.scanExtraDirsSkills();
  const allSkills = globalSkills.concat(extraSkills);
  const lines = ['## 已绑定技能', '', 'Skills are **primary tools** — use them directly when the task matches.', '', 'Rules:', '- When a task matches a skill, use it as the **first choice**', '- Skills are invoked via the `exec` tool, e.g. `exec python skills/xxx/xxx.py ...`', '- **NEVER** say "I cannot do X" when you have a skill that can do it', ''];
  for (let i = 0; i < skillIds.length; i++) {
    const sid = skillIds[i];
    const found = allSkills.find(function (s) { return s.id === sid; });
    if (found && found.path) {
      lines.push('**' + (found.name || sid) + '**');
      const skillMdPath = path.join(found.path, 'SKILL.md');
      try {
        const skillMd = fs.readFileSync(skillMdPath, 'utf-8');
        let inCodeBlock = false;
        const usageLines = [];
        skillMd.split('\n').forEach(function (l) {
          if (l.trim().startsWith('```')) { inCodeBlock = !inCodeBlock; return; }
          if (inCodeBlock && l.match(/python\s+skills\//)) {
            usageLines.push(l.trim());
          }
        });
        if (usageLines.length > 0) {
          usageLines.forEach(function (l) { lines.push('- `' + l + '`'); });
        }
      } catch (e) {}
      lines.push('');
    } else {
      lines.push('**' + sid + '** (未安装)');
      lines.push('');
    }
  }
  return lines.join('\n');
}

function _stripSystemSection(content) {
  if (!content) return content;
  return content.replace(new RegExp('\\n*' + _SYS_SECTION_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + _SYS_SECTION_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n*'), '\n').trim();
}

function _stripAgentsMdTeamAndSkills(md) {
  if (!md) return md;
  const lines = md.split('\n');
  const result = [];
  let skip = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^##\s+(Team Members|Skills|Sub-Agents)/)) {
      skip = true;
      continue;
    }
    if (skip && lines[i].match(/^##\s+/)) {
      skip = false;
    }
    if (!skip) result.push(lines[i]);
  }
  const out = result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

function _syncToolsMd(agentId, agentList, skillIds, workspace) {
  const toolsPath = path.join(workspace, 'TOOLS.md');
  const existing = store.readFile(toolsPath) || '';
  const userPart = _stripSystemSection(existing).trim();

  // Build team and skill sections separately
  const target = agentList.find(function (a) { return a.id === agentId; });
  const allowedIds = (target && target.subagents && target.subagents.allowAgents) ? target.subagents.allowAgents : null;
  const teamSection = _buildTeamSection(agentId, agentList, allowedIds);
  const skillSection = _buildSkillSection(skillIds);

  const parts = [];
  if (teamSection) parts.push(teamSection);
  if (skillSection) parts.push(skillSection);

  let content = userPart;
  if (parts.length > 0) {
    const systemSection = _SYS_SECTION_START + '\n' + parts.join('\n\n') + '\n' + _SYS_SECTION_END;
    content = content + '\n\n' + systemSection;
  }
  content = content.trim() + '\n';
  store.writeFile(toolsPath, content);
}

function _syncIdentityMd(agentId, agentList, workspace) {
  var target = null;
  for (var i = 0; i < agentList.length; i++) {
    if (agentList[i].id === agentId) { target = agentList[i]; break; }
  }
  if (!target) return;

  var name = target.name || target.id;
  var emoji = (target.identity && target.identity.emoji) || '';
  var desc = target.description || (target.identity && target.identity.description) || '';

  var lines = [
    '# IDENTITY.md',
    '',
    '- **Name:** ' + name,
    '- **Creature:** AI Agent',
    '- **Vibe:** ' + (desc || '直接执行，高效务实'),
    '- **Emoji:** ' + emoji,
    '- **Avatar:**',
    ''
  ];

  var identityPath = path.join(workspace, 'IDENTITY.md');
  store.writeFile(identityPath, lines.join('\n'));
}

function _syncBootstrapMd(agentId, agentList, workspace) {
  var target = null;
  for (var i = 0; i < agentList.length; i++) {
    if (agentList[i].id === agentId) { target = agentList[i]; break; }
  }
  if (!target) return;

  var name = target.name || target.id;

  var lines = [
    '# 身份确认',
    '',
    '你的身份已在 AGENTS.md 中明确定义，无需通过对话探索。',
    '',
    '- 你的名字、性格、行为规则 → 见 AGENTS.md',
    '- 你的团队成员和技能 → 见 TOOLS.md',
    '- 用户信息 → 在交互中自然积累，更新 USER.md',
    '',
    '直接按 AGENTS.md 的设定开始工作，不要反问用户"你是谁"。',
    ''
  ];

  var bootstrapPath = path.join(workspace, 'BOOTSTRAP.md');
  store.writeFile(bootstrapPath, lines.join('\n'));
}

const _PROJECT_CTX_START = '<!-- project-context-start -->';
const _PROJECT_CTX_END = '<!-- project-context-end -->';

/**
 * 在项目目录下自动创建 AGENTS.md（如不存在）。
 * 提供基础模板，用户可自行补充。
 */
function _ensureProjectAgentsMd(repoRoot) {
  var agentsPath = path.join(repoRoot, 'AGENTS.md');
  try {
    if (fs.existsSync(agentsPath)) return; // 已存在，不覆盖
  } catch (e) { return; }

  var dirName = path.basename(repoRoot);
  var content = '# ' + dirName + ' — 项目上下文\n'
    + '\n'
    + '> 此文件由虾指挥自动创建，供 Agent 了解项目规范。请根据实际情况补充内容。\n'
    + '\n'
    + '## 技术栈\n'
    + '\n'
    + '（请补充项目使用的技术栈）\n'
    + '\n'
    + '## 开发规范\n'
    + '\n'
    + '（请补充项目的开发规范和约定）\n'
    + '\n'
    + '## 目录结构\n'
    + '\n'
    + '（请补充项目的目录结构说明）\n';

  try {
    store.writeFile(agentsPath, content);
    console.log('[Roster] Created project AGENTS.md:', agentsPath);
  } catch (e) {
    console.error('[Roster] Failed to create project AGENTS.md:', e.message);
  }
}

/**
 * 在 AGENTS.md 中注入/移除项目上下文引导语。
 * 设置 repoRoot 时追加引导段落，清除时移除。
 * 利用 OpenClaw 原生的 AGENTS.md 自动注入机制，零额外依赖。
 */
function syncProjectContext(workspace, repoRoot) {
  var agentsPath = path.join(workspace, 'AGENTS.md');
  var existing = store.readFile(agentsPath) || '';

  // 先移除旧的项目上下文段落
  var cleaned = existing.replace(
    new RegExp('\\n*' + _PROJECT_CTX_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      + '[\\s\\S]*?' + _PROJECT_CTX_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n*'),
    '\n'
  ).trim();

  // 如果有 repoRoot，追加新的引导段落
  if (repoRoot && repoRoot.trim()) {
    var section = _PROJECT_CTX_START + '\n'
      + '## 当前项目\n'
      + '\n'
      + '项目目录（代码工作目录，非物理办公室）: ' + repoRoot + '\n'
      + '执行项目相关任务时，请先读取该目录下的 AGENTS.md，遵循其中的项目规范和约定。\n'
      + _PROJECT_CTX_END;
    cleaned = cleaned + '\n\n' + section;
  }

  cleaned = cleaned.trim() + '\n';
  if (cleaned !== existing) {
    store.writeFile(agentsPath, cleaned);
  }
}

function _cleanAgentsMd(workspace) {
  const agentsPath = path.join(workspace, 'AGENTS.md');
  const existing = store.readFile(agentsPath) || '';
  if (!existing) return;
  const cleaned = _stripAgentsMdTeamAndSkills(existing);
  if (cleaned !== existing.trim()) {
    store.writeFile(agentsPath, cleaned + '\n');
  }
}

function syncTeamRoster() {
  return true;
}

function syncSubAgentRoster(agentId, agentList) {
  if (!agentList) {
    const data = store.readConfig();
    if (!data) return false;
    agentList = (data.agents && data.agents.list) || [];
    if (!Array.isArray(agentList)) return false;
  }

  let target = null;
  for (let i = 0; i < agentList.length; i++) {
    if (agentList[i].id === agentId) { target = agentList[i]; break; }
  }
  if (!target) return false;

  const workspace = store.resolveHome(target.workspace || '');
  if (!workspace) return false;

  _syncSkillLinks(target.skills || [], workspace);
  _syncToolsMd(agentId, agentList, target.skills || [], workspace);
  _syncIdentityMd(agentId, agentList, workspace);
  _syncBootstrapMd(agentId, agentList, workspace);
  _cleanAgentsMd(workspace);
  return true;
}

/**
 * 校验所有 Agent 的 skills 引用是否指向实际存在的技能目录。
 * 移除配置中引用了但磁盘上不存在的"幽灵"技能 ID。
 * 返回值：是否有修改（true = 需要 writeConfig）
 */
function _validateSkillRefs(agentList) {
  // 收集磁盘上实际存在的技能 ID
  var validIds = {};
  var globalSkills = store.scanGlobalSkills();
  var extraSkills = store.scanExtraDirsSkills();
  var i;
  for (i = 0; i < globalSkills.length; i++) validIds[globalSkills[i].id] = true;
  for (i = 0; i < extraSkills.length; i++) validIds[extraSkills[i].id] = true;

  var changed = false;
  for (i = 0; i < agentList.length; i++) {
    var agent = agentList[i];
    if (!agent.skills || !Array.isArray(agent.skills)) continue;

    var phantoms = [];
    var valid = [];
    for (var j = 0; j < agent.skills.length; j++) {
      if (validIds[agent.skills[j]]) {
        valid.push(agent.skills[j]);
      } else {
        phantoms.push(agent.skills[j]);
      }
    }

    if (phantoms.length > 0) {
      console.warn('[Roster] Removed ' + phantoms.length + ' phantom skill ref(s) from agent "' + agent.id + '": ' + phantoms.join(', '));
      agent.skills = valid;
      changed = true;
    }
  }
  return changed;
}

function syncAllRosters() {
  const data = store.readConfig();
  if (!data) return;
  const list = (data.agents && data.agents.list) || [];
  if (!Array.isArray(list)) return;

  var configChanged = false;
  if (_validateAllowAgents(list)) configChanged = true;
  if (_validateSkillRefs(list)) configChanged = true;

  if (configChanged) {
    try { store.writeConfig(data); } catch (e) { console.error('[Roster] writeConfig failed:', e.message); }
  }
  syncTeamRoster();
  for (let i = 0; i < list.length; i++) {
    try { syncSubAgentRoster(list[i].id, list); }
    catch (e) { console.error('[Roster] syncSubAgentRoster failed for ' + list[i].id + ':', e.message); }
  }
  // 同步项目上下文引导语
  try {
    var defaultWorkspace = store.resolveHome((data.agents.defaults && data.agents.defaults.workspace) || '');
    var repoRoot = store.resolveHome((data.agents.defaults && data.agents.defaults.repoRoot) || '');
    if (defaultWorkspace) syncProjectContext(defaultWorkspace, repoRoot);
  } catch (e) { console.error('[Roster] syncProjectContext failed:', e.message); }
}

function unbindSkillFromAll(skillId) {
  const data = store.readConfig();
  if (!data) return false;
  const list = (data.agents && data.agents.list) || data.agents || [];
  if (!Array.isArray(list)) return false;
  let changed = false;
  for (let i = 0; i < list.length; i++) {
    if (!list[i].skills) continue;
    const idx = list[i].skills.indexOf(skillId);
    if (idx >= 0) {
      list[i].skills.splice(idx, 1);
      changed = true;
    }
  }
  if (!changed) return true;
  if (!store.writeConfig(data)) return false;
  syncAllRosters();
  return true;
}

module.exports = {
  syncTeamRoster: syncTeamRoster,
  syncSubAgentRoster: syncSubAgentRoster,
  syncAllRosters: syncAllRosters,
  syncProjectContext: syncProjectContext,
  ensureProjectAgentsMd: _ensureProjectAgentsMd,
  unbindSkillFromAll: unbindSkillFromAll,
  stripSystemSection: _stripSystemSection,
};
