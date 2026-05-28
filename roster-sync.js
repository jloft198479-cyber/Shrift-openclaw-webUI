/**
 * roster-sync.js — Agent Roster 同步与 AGENTS.md 生成
 *
 * 职责：
 * - 同步主 agent 和子 agent 的 AGENTS.md 文件
 * - 生成 Sub-Agents、Team Members、Skills 等 section
 * - 管理 skill 链接（symlink/junction）
 * - 解绑 skill 时同步更新 roster
 *
 * 依赖：fs-store（readConfig, writeConfig, findAgentRaw, resolveHome, readFile, writeFile, _resolveGlobalSkillsDir）
 */

const fs = require('fs');
const path = require('path');
const store = require('./fs-store');

function _extractSection(md, heading) {
  const lines = md.split('\n');
  let start = -1;
  let end = lines.length;
  let headingPrefix = '#';
  for (const re = /^#{1,6}\s/.exec(heading); re; ) { headingPrefix = re[0].trim(); break; }
  const headingLevel = headingPrefix.length;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (m && m[2].trim() === heading.replace(/^#{1,6}\s+/, '')) { start = i; break; }
  }
  if (start === -1) return { section: '', rest: md };
  for (let j = start + 1; j < lines.length; j++) {
    const m2 = lines[j].match(/^(#{1,6})\s/);
    if (m2 && m2[1].length <= headingLevel) { end = j; break; }
  }
  const section = lines.slice(start, end).join('\n');
  const before = lines.slice(0, start).join('\n');
  const after = lines.slice(end).join('\n');
  const rest = (before + '\n' + after).replace(/\n{3,}/g, '\n\n').trim();
  return { section: section, rest: rest };
}

function _readAgentSummary(workspace) {
  let name = '';
  let emoji = '';
  let summary = '';
  const identityPath = path.join(workspace, 'IDENTITY.md');
  if (fs.existsSync(identityPath)) {
    const idContent = fs.readFileSync(identityPath, 'utf8');
    const nameM = idContent.match(/\*\*Name:\*\*\s*(.+)/i);
    if (nameM) name = nameM[1].trim();
    const emojiM = idContent.match(/\*\*Emoji:\*\*\s*(.+)/i);
    if (emojiM) emoji = emojiM[1].trim();
  }
  const agentsMdPath = path.join(workspace, 'AGENTS.md');
  if (fs.existsSync(agentsMdPath)) {
    const agentsContent = fs.readFileSync(agentsMdPath, 'utf8');
    const lines = agentsContent.split('\n');
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k].trim();
      if (l && !l.match(/^#/) && !l.match(/^---/) && !l.match(/^_/) && !l.match(/^\*/) && !l.match(/^>/)) {
        summary = l.replace(/^[-*]\s*/, '');
        break;
      }
    }
  }
  if (!summary) {
    const soulPath = path.join(workspace, 'SOUL.md');
    if (fs.existsSync(soulPath)) {
      const soulContent = fs.readFileSync(soulPath, 'utf8');
      const slines = soulContent.split('\n');
      for (let i = 0; i < slines.length; i++) {
        const line = slines[i].trim();
        if (line && !line.match(/^#/) && !line.match(/^---/) && !line.match(/^_/) && !line.match(/^\*You/) && !line.match(/^\*/) && !line.match(/^>/)) {
          summary = line.replace(/^[-*]\s*/, '');
          break;
        }
      }
    }
  }
  return { name: name, emoji: emoji, summary: summary };
}

function _isEmojiChar(val) {
  if (!val || typeof val !== 'string') return false;
  return !val.match(/[\/\\\.]/);
}

function _toThirdPerson(desc, name) {
  if (!desc) return '';
  let s = desc;
  s = s.replace(/^You are /i, name + ' is ');
  s = s.replace(/^你是/g, name + '是');
  let result = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '我' && i + 1 < s.length && s[i + 1] !== '们') {
      result += name;
    } else {
      result += s[i];
    }
  }
  return result;
}

function _buildSubAgentsSection(subAgents) {
  const lines = ['## Sub-Agents', '', 'You can spawn sub-agents using the `sessions_spawn` tool:', ''];
  subAgents.forEach(function (sub) {
    const ws = store.resolveHome(sub.workspace || '');
    const info = ws ? _readAgentSummary(ws) : { name: '', emoji: '', summary: '' };
    const name = sub.name || info.name || sub.id;
    const rawEmoji = (sub.identity && sub.identity.emoji) || info.emoji || '';
    const emoji = _isEmojiChar(rawEmoji) ? rawEmoji : '';
    const display = emoji ? emoji + ' ' + name : name;
    const rawDesc = info.summary || sub.description || '';
    const desc = _toThirdPerson(rawDesc, name);
    lines.push('- **' + sub.id + '** (' + display + ') — ' + desc);
  });
  lines.push('');
  lines.push('_Note: This section is auto-generated. For custom skill instructions, add a `## Custom Skills Notes` section elsewhere in this file._');
  lines.push('');
  return lines.join('\n');
}

function _buildMentionRulesSection(subAgents) {
  if (subAgents.length === 0) return '';
  const lines = ['', '## @Mention Handling Rules', ''];
  lines.push('When the user mentions an agent with @ notation (e.g. `@agent_id: task` or `@agent_id task`), follow these rules:');
  lines.push('');
  lines.push('1. Parse the @mention to identify the target agent ID');
  lines.push('2. Extract the task/instruction that follows the @mention');
  lines.push('3. Use the `sessions_spawn` tool to delegate the task to the mentioned agent');
  lines.push('4. Do NOT attempt to answer the task yourself when an agent is explicitly mentioned');
  lines.push('5. If multiple agents are mentioned, spawn separate sub-sessions for each');
  lines.push('6. Report back the results from sub-agents to the user');
  lines.push('7. If the mentioned agent ID is not in the list below, ask the user to clarify');
  lines.push('');
  lines.push('Available agents for @mention:');
  subAgents.forEach(function (sub) {
    lines.push('- `@' + sub.id + '` — ' + (sub.name || sub.id));
  });
  lines.push('');
  return lines.join('\n');
}

function _buildTeamMembersSection(currentAgentId, allAgents) {
  const siblings = allAgents.filter(function (a) { return a.id !== currentAgentId; });
  if (siblings.length === 0) return '';
  const lines = ['', '## Team Members', '', 'You can collaborate with these agents:', ''];
  siblings.forEach(function (sib) {
    const ws = store.resolveHome(sib.workspace || '');
    const info = ws ? _readAgentSummary(ws) : { name: '', emoji: '', summary: '' };
    const name = sib.name || info.name || sib.id;
    const rawEmoji = (sib.identity && sib.identity.emoji) || info.emoji || '';
    const emoji = _isEmojiChar(rawEmoji) ? rawEmoji : '';
    const display = emoji ? emoji + ' ' + name : name;
    const rawDesc = info.summary || sib.description || '';
    const desc = _toThirdPerson(rawDesc, name);
    lines.push('- **' + sib.id + '** (' + display + ') — ' + desc);
  });
  lines.push('');
  return lines.join('\n');
}

function _buildSkillUsageSection(agentId, allAgents) {
  let target = null;
  for (let i = 0; i < allAgents.length; i++) {
    if (allAgents[i].id === agentId) { target = allAgents[i]; break; }
  }
  const skillIds = (target && target.skills) || [];
  if (skillIds.length === 0) return '';
  const workspace = store.resolveHome(target.workspace || '');
  const lines = ['', '## Skills', ''];
  lines.push('You have the following skills. Skills are **primary tools** — use them directly when the task matches, do NOT wait for built-in tools to fail first.');
  lines.push('');
  lines.push('Rules:');
  lines.push('- When a task matches a skill below, use that skill command **directly** as the first choice');
  lines.push('- Skills are invoked via the `exec` tool, e.g. `exec python skills/xxx/xxx.py ...`');
  lines.push('- **NEVER** say "I cannot do X" when you have a skill that can do it');
  lines.push('');
  const globalSkillsDir = store._resolveGlobalSkillsDir();
  skillIds.forEach(function (skillId) {
    const skillInfo = _extractSkillCommands(skillId, workspace, globalSkillsDir);
    lines.push('**' + skillId + '**');
    if (skillInfo.description) lines.push('- ' + skillInfo.description);
    if (skillInfo.commands.length > 0) {
      skillInfo.commands.forEach(function (cmd) {
        lines.push('- `' + cmd + '`');
      });
    } else {
      lines.push('- Read skills/' + skillId + '/SKILL.md for usage instructions');
    }
    lines.push('');
  });
  return lines.join('\n');
}

function _extractSkillCommands(skillId, workspace, globalSkillsDir) {
  const result = { description: '', commands: [] };
  let skillMdPath = '';
  if (workspace) {
    const p = path.join(workspace, 'skills', skillId, 'SKILL.md');
    if (fs.existsSync(p)) skillMdPath = p;
  }
  if (!skillMdPath && globalSkillsDir) {
    const p = path.join(globalSkillsDir, skillId, 'SKILL.md');
    if (fs.existsSync(p)) skillMdPath = p;
  }
  if (!skillMdPath) return result;
  const content = store.readFile(skillMdPath) || '';
  const descM = content.match(/^>\s*(.+)$/m);
  if (descM) result.description = descM[1].trim();
  const fmDescM = content.match(/^description:\s*(.+)$/m);
  if (fmDescM && !result.description) result.description = fmDescM[1].trim();
  const codeBlocks = content.match(/```(?:powershell|bash|sh|shell)?\s*\n([\s\S]*?)```/g) || [];
  codeBlocks.forEach(function (block) {
    const inner = block.replace(/```(?:powershell|bash|sh|shell)?\s*\n/, '').replace(/\n```$/, '');
    inner.split('\n').forEach(function (line) {
      const trimmed = line.trim();
      if (trimmed.match(/^(python|python3|node|npx|npm|bash|sh|\.\/|deno|cargo|go\s+run|java|dotnet)\s+/) || trimmed.match(/^\.\/[^\s]+/)) {
        result.commands.push(trimmed);
      }
    });
  });
  return result;
}

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
        } else if (process.platform === 'win32' && stat.isDirectory()) {
          try {
            const marker = path.join(p, '.managed-skill-link');
            if (fs.existsSync(marker)) managed[name] = p;
          } catch (e) {}
        }
      } catch (e) {}
    });
  } catch (e) {}

  for (const name in managed) {
    if (skillIds.indexOf(name) < 0) {
      try { fs.rmSync(managed[name], { recursive: true, force: true }); } catch (e) {}
    }
  }

  skillIds.forEach(function (skillId) {
    const linkPath = path.join(wsSkillsDir, skillId);
    try { if (fs.lstatSync(linkPath)) return; } catch (e) {}
    const src = path.join(globalSkillsDir, skillId);
    if (!fs.existsSync(src)) return;
    try {
      if (process.platform === 'win32') {
        fs.symlinkSync(src, linkPath, 'junction');
      } else {
        fs.symlinkSync(src, linkPath, 'dir');
      }
    } catch (e) {
      try {
        fs.cpSync(src, linkPath, { recursive: true });
        store.writeFile(path.join(linkPath, '.managed-skill-link'), '');
      } catch (e2) {}
    }
  });
}

function _validateAllowAgents(agentList) {
  const validIds = new Set();
  for (let i = 0; i < agentList.length; i++) {
    validIds.add(agentList[i].id);
  }
  let changed = false;
  for (let i = 0; i < agentList.length; i++) {
    const sub = agentList[i].subagents;
    if (!sub || !Array.isArray(sub.allowAgents)) continue;
    const before = sub.allowAgents.length;
    sub.allowAgents = sub.allowAgents.filter(function (id) { return validIds.has(id); });
    if (sub.allowAgents.length !== before) {
      console.warn('[Store] Cleaned ' + (before - sub.allowAgents.length) + ' dangling allowAgents ref(s) from agent ' + agentList[i].id);
      changed = true;
    }
  }
  return changed;
}

function syncTeamRoster() {
  const data = store.readConfig();
  if (!data) return false;
  const list = (data.agents && data.agents.list) || [];
  if (!Array.isArray(list) || list.length === 0) return false;

  let mainAgent = null;
  const subAgents = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === 'main' || list[i].default) { mainAgent = list[i]; }
    else { subAgents.push(list[i]); }
  }
  if (!mainAgent) return false;

  const workspace = store.resolveHome(mainAgent.workspace || '');
  if (!workspace) return false;

  const agentsMdPath = path.join(workspace, 'AGENTS.md');
  const existing = store.readFile(agentsMdPath) || '';

  const subResult = _extractSection(existing, '## Sub-Agents');
  let rest = subResult.rest;
  const mentionResult = _extractSection(rest, '## @Mention Handling Rules');
  rest = mentionResult.rest;
  const preserved = rest.trim();

  const newSection = _buildSubAgentsSection(subAgents);
  const mentionSection = _buildMentionRulesSection(subAgents);
  const newContent = preserved + '\n\n' + newSection + mentionSection + '\n';

  return store.writeFile(agentsMdPath, newContent.trim() + '\n');
}

function syncSubAgentRoster(agentId) {
  const data = store.readConfig();
  if (!data) return false;
  const list = (data.agents && data.agents.list) || [];
  if (!Array.isArray(list)) return false;

  let target = null;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === agentId) { target = list[i]; break; }
  }
  if (!target) return false;

  const workspace = store.resolveHome(target.workspace || '');
  if (!workspace) return false;

  _syncSkillLinks(target.skills || [], workspace);

  const agentsMdPath = path.join(workspace, 'AGENTS.md');
  const existing = store.readFile(agentsMdPath) || '';

  const teamResult = _extractSection(existing, '## Team Members');
  let rest = teamResult.rest;
  const legacySkillResult = _extractSection(rest, '## Skill Usage Rules');
  rest = legacySkillResult.rest;
  const skillResult = _extractSection(rest, '## Skills');
  rest = skillResult.rest;
  const customNotesResult = _extractSection(rest, '## Custom Skills Notes');
  const preserved = customNotesResult.rest.trim();
  const customNotes = customNotesResult.section.trim();

  const teamSection = _buildTeamMembersSection(agentId, list);
  const skillSection = _buildSkillUsageSection(agentId, list);
  const skillNotesSection = customNotes ? '\n\n## Custom Skills Notes\n\n' + customNotes : '';
  const newContent = preserved + teamSection + skillSection + skillNotesSection;

  return store.writeFile(agentsMdPath, newContent.trim() + '\n');
}

function syncAllRosters() {
  const data = store.readConfig();
  if (!data) return;
  const list = (data.agents && data.agents.list) || [];
  if (!Array.isArray(list)) return;
  if (_validateAllowAgents(list)) {
    store.writeConfig(data);
  }
  syncTeamRoster();
  for (let i = 0; i < list.length; i++) {
    if (list[i].id !== 'main' && !list[i].default) {
      syncSubAgentRoster(list[i].id);
    }
  }
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
  unbindSkillFromAll: unbindSkillFromAll,
};
