const fs = require('fs');
const path = require('path');

let OPENCLAW_CONFIG = '';
let SESSIONS_DIR = '';
let DATA_DIR = '';

function init(configPath, projectDir) {
  OPENCLAW_CONFIG = configPath;
  if (configPath) {
    DATA_DIR = path.dirname(configPath);
    SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
  }
  if (!_canWriteDir(SESSIONS_DIR)) {
    const fallback = projectDir ? path.join(projectDir, 'sessions') : '';
    if (fallback && _canWriteDir(fallback)) {
      if (SESSIONS_DIR) {
        console.warn('[Store] Cannot write to ' + SESSIONS_DIR + ', falling back to ' + fallback);
      }
      SESSIONS_DIR = fallback;
    }
  }
}

function _canWriteDir(dir) {
  if (!dir) return false;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const testFile = path.join(dir, '.write-test');
    fs.writeFileSync(testFile, '1', 'utf8');
    fs.unlinkSync(testFile);
    return true;
  } catch (e) {
    return false;
  }
}

function resolveHome(p) {
  if (!p) return p;
  if (p.indexOf('~') !== 0) return p;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, p.slice(1).replace(/^[\\\/]/, ''));
}

function readConfig() {
  if (!OPENCLAW_CONFIG || !fs.existsSync(OPENCLAW_CONFIG)) return null;
  try {
    return JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
  } catch (e) {
    console.error('[FS] Cannot read openclaw.json:', e.message);
    return null;
  }
}

function writeConfig(data) {
  if (!OPENCLAW_CONFIG) return false;
  try {
    fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[FS] Cannot write openclaw.json:', e.message);
    return false;
  }
}

function readFile(filePath) {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  } catch (e) {}
  return null;
}

function writeFile(filePath, content) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (e) {
    console.error('[FS] Write failed:', filePath, e.message);
    return false;
  }
}

function removeDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return true;
    const items = fs.readdirSync(dirPath);
    for (let i = 0; i < items.length; i++) {
      const p = path.join(dirPath, items[i]);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) { removeDir(p); }
      else { fs.unlinkSync(p); }
    }
    fs.rmdirSync(dirPath);
    return true;
  } catch (e) {
    console.error('[FS] Remove dir failed:', dirPath, e.message);
    return false;
  }
}

function getAgentList() {
  const data = readConfig();
  if (!data) return [];
  let list = (data.agents && data.agents.list) || data.agents || [];
  if (!Array.isArray(list)) list = [];
  return list;
}

function findAgentRaw(agentId) {
  const data = readConfig();
  if (!data) return null;
  const list = (data.agents && data.agents.list) || data.agents || [];
  if (!Array.isArray(list)) return null;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === agentId) return list[i];
  }
  return null;
}

function getAgentWorkspace(agentId) {
  const raw = findAgentRaw(agentId);
  if (!raw) return null;
  return resolveHome(raw.workspace || '');
}

function scanSkills(ws) {
  const skills = [];
  if (!ws) return skills;
  const skillsDir = path.join(ws, 'skills');
  try {
    if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) return skills;
    fs.readdirSync(skillsDir).forEach(function (d) {
      const skillPath = path.join(skillsDir, d);
      try {
        if (!fs.statSync(skillPath).isDirectory()) return;
        const skillMd = path.join(skillPath, 'SKILL.md');
        const info = _parseSkillMd(d, skillMd);
        skills.push(info);
      } catch (se) {}
    });
  } catch (e) {}
  return skills;
}

function scanGlobalSkills() {
  const skills = [];
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (!home) return skills;
  const globalDir = path.join(home, '.openclaw', 'skills');
  try {
    if (!fs.existsSync(globalDir) || !fs.statSync(globalDir).isDirectory()) return skills;
    fs.readdirSync(globalDir).forEach(function (d) {
      const skillPath = path.join(globalDir, d);
      try {
        if (!fs.statSync(skillPath).isDirectory()) return;
        const skillMd = path.join(skillPath, 'SKILL.md');
        const info = _parseSkillMd(d, skillMd);
        info.source = 'global';
        info.path = skillPath;
        skills.push(info);
      } catch (se) {}
    });
  } catch (e) {}
  return skills;
}

function scanExtraDirsSkills() {
  const skills = [];
  const data = readConfig();
  if (!data || !data.skills || !data.skills.load || !Array.isArray(data.skills.load.extraDirs)) return skills;
  const dirs = data.skills.load.extraDirs;
  const seen = {};
  dirs.forEach(function (dirPath) {
    try {
      const resolved = resolveHome(dirPath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return;
      const skillMd = path.join(resolved, 'SKILL.md');
      if (!fs.existsSync(skillMd)) return;
      const dirName = path.basename(resolved);
      if (seen[dirName]) return;
      seen[dirName] = true;
      const info = _parseSkillMd(dirName, skillMd);
      info.source = 'extraDir';
      info.path = resolved;
      skills.push(info);
    } catch (e) {}
  });
  return skills;
}

function _parseSkillMd(id, skillMdPath) {
  const info = { id: id, name: id, description: '', icon: '' };
  if (fs.existsSync(skillMdPath)) {
    const content = fs.readFileSync(skillMdPath, 'utf8');
    const nameM = content.match(/^#\s+(.+)$/m);
    if (nameM) info.name = nameM[1].trim();
    const descM = content.match(/^>\s*(.+)$/m);
    if (descM) info.description = descM[1].trim();
    const iconM = content.match(/\*\*Icon\*\*:\s*(.+)/m);
    if (iconM) info.icon = iconM[1].trim();
    const fmDesc = content.match(/^description:\s*(.+)$/m);
    if (fmDesc && !info.description) info.description = fmDesc[1].trim();
  }
  return info;
}

function getAvailableModels() {
  const data = readConfig();
  if (!data || !data.models || !data.models.providers) return [];
  const models = [];
  const providers = data.models.providers;
  for (let provKey in providers) {
    const prov = providers[provKey];
    if (!prov || !Array.isArray(prov.models)) continue;
    for (let i = 0; i < prov.models.length; i++) {
      const m = prov.models[i];
      models.push({
        id: provKey + '/' + m.id,
        name: m.name || m.id,
        provider: provKey,
        providerModelId: m.id,
      });
    }
  }
  return models;
}

function getAgentModel(agentId) {
  const raw = findAgentRaw(agentId);
  if (raw && raw.model && raw.model.primary) return raw.model.primary;
  const data = readConfig();
  if (data && data.agents && data.agents.defaults && data.agents.defaults.model && data.agents.defaults.model.primary) {
    return data.agents.defaults.model.primary;
  }
  return '';
}

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
    const ws = resolveHome(sub.workspace || '');
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
    const ws = resolveHome(sib.workspace || '');
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

function syncTeamRoster() {
  const data = readConfig();
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

  const workspace = resolveHome(mainAgent.workspace || '');
  if (!workspace) return false;

  const agentsMdPath = path.join(workspace, 'AGENTS.md');
  const existing = readFile(agentsMdPath) || '';

  const subResult = _extractSection(existing, '## Sub-Agents');
  let rest = subResult.rest;
  const mentionResult = _extractSection(rest, '## @Mention Handling Rules');
  rest = mentionResult.rest;
  const preserved = rest.trim();

  const newSection = _buildSubAgentsSection(subAgents);
  const mentionSection = _buildMentionRulesSection(subAgents);
  const newContent = preserved + '\n\n' + newSection + mentionSection + '\n';

  return writeFile(agentsMdPath, newContent.trim() + '\n');
}

function _buildSkillUsageSection(agentId, allAgents) {
  let target = null;
  for (let i = 0; i < allAgents.length; i++) {
    if (allAgents[i].id === agentId) { target = allAgents[i]; break; }
  }
  const skillIds = (target && target.skills) || [];
  if (skillIds.length === 0) return '';
  const workspace = resolveHome(target.workspace || '');
  const lines = ['', '## Skills', ''];
  lines.push('You have the following skills. Skills are **primary tools** — use them directly when the task matches, do NOT wait for built-in tools to fail first.');
  lines.push('');
  lines.push('Rules:');
  lines.push('- When a task matches a skill below, use that skill command **directly** as the first choice');
  lines.push('- Skills are invoked via the `exec` tool, e.g. `exec python skills/xxx/xxx.py ...`');
  lines.push('- **NEVER** say "I cannot do X" when you have a skill that can do it');
  lines.push('');
  const globalSkillsDir = _resolveGlobalSkillsDir();
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
  const content = readFile(skillMdPath) || '';
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
  const globalSkillsDir = _resolveGlobalSkillsDir();
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
        writeFile(path.join(linkPath, '.managed-skill-link'), '');
      } catch (e2) {}
    }
  });
}

function _resolveGlobalSkillsDir() {
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (stateDir) {
    const d = path.join(resolveHome(stateDir), 'skills');
    if (fs.existsSync(d)) return d;
  }
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (home) {
    const d = path.join(home, '.openclaw', 'skills');
    if (fs.existsSync(d)) return d;
  }
  return null;
}

function syncSubAgentRoster(agentId) {
  const data = readConfig();
  if (!data) return false;
  const list = (data.agents && data.agents.list) || [];
  if (!Array.isArray(list)) return false;

  let target = null;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === agentId) { target = list[i]; break; }
  }
  if (!target) return false;

  const workspace = resolveHome(target.workspace || '');
  if (!workspace) return false;

  _syncSkillLinks(target.skills || [], workspace);

  const agentsMdPath = path.join(workspace, 'AGENTS.md');
  const existing = readFile(agentsMdPath) || '';

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

  return writeFile(agentsMdPath, newContent.trim() + '\n');
}

function unbindSkillFromAll(skillId) {
  const data = readConfig();
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
  if (!writeConfig(data)) return false;
  syncAllRosters();
  return true;
}

function _isPathWithinAllowedRoots(targetPath) {
  if (!targetPath) return false;
  const target = path.resolve(targetPath);
  const allowedRoots = [];
  if (DATA_DIR) allowedRoots.push(path.resolve(DATA_DIR));
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (home) allowedRoots.push(path.join(home, '.openclaw'));
  if (allowedRoots.length === 0) return false;
  for (let i = 0; i < allowedRoots.length; i++) {
    const root = path.resolve(allowedRoots[i]);
    if (target === root || target.indexOf(root + path.sep) === 0) return true;
  }
  return false;
}

function cleanupWorkspace(workspace) {
  if (!workspace) return false;
  const resolved = resolveHome(workspace);
  if (!resolved || !fs.existsSync(resolved)) return false;
  if (!_isPathWithinAllowedRoots(resolved)) {
    console.error('[FS] cleanupWorkspace blocked: path outside allowed roots:', resolved);
    return false;
  }
  const wsSkillsDir = path.join(resolved, 'skills');
  try {
    if (fs.existsSync(wsSkillsDir)) {
      fs.readdirSync(wsSkillsDir).forEach(function (name) {
        const p = path.join(wsSkillsDir, name);
        try {
          const stat = fs.lstatSync(p);
          if (stat.isSymbolicLink()) { fs.unlinkSync(p); }
          else if (process.platform === 'win32' && stat.isDirectory()) {
            const marker = path.join(p, '.managed-skill-link');
            if (fs.existsSync(marker)) { fs.rmSync(p, { recursive: true, force: true }); }
          }
        } catch (e) {}
      });
    }
  } catch (e) {}
  return removeDir(resolved);
}

function patchAgentField(agentId, field, value) {
  const data = readConfig();
  if (!data) return false;
  const list = (data.agents && data.agents.list) || data.agents || [];
  if (!Array.isArray(list)) return false;
  let found = false;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === agentId) {
      list[i][field] = value;
      found = true;
      break;
    }
  }
  if (!found) return false;
  return writeConfig(data);
}

function syncAllRosters() {
  const data = readConfig();
  if (!data) return;
  const list = (data.agents && data.agents.list) || [];
  if (!Array.isArray(list)) return;
  syncTeamRoster();
  for (let i = 0; i < list.length; i++) {
    if (list[i].id !== 'main' && !list[i].default) {
      syncSubAgentRoster(list[i].id);
    }
  }
}

function _ensureSessionsDir() {
  if (!SESSIONS_DIR) return false;
  if (!fs.existsSync(SESSIONS_DIR)) {
    try { fs.mkdirSync(SESSIONS_DIR, { recursive: true }); } catch (e) { return false; }
  }
  return true;
}

function getSessionList() {
  if (!_ensureSessionsDir()) return [];
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter(function (f) { return f.endsWith('.json'); });
    const sessions = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, files[i]), 'utf8'));
        if (data && data.id) {
          sessions.push({
            id: data.id,
            name: data.name || '',
            agent: data.agent || '',
            tag: data.tag || '',
            created_at: data.created_at || 0,
            updated_at: data.updated_at || 0,
          });
        }
      } catch (e) {}
    }
    sessions.sort(function (a, b) { return (b.updated_at || 0) - (a.updated_at || 0); });
    return sessions;
  } catch (e) {
    return [];
  }
}

function getSession(id) {
  if (!id || !_ensureSessionsDir()) return null;
  const filePath = path.join(SESSIONS_DIR, id + '.json');
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveSession(session) {
  if (!session || !session.id) return false;
  if (!_ensureSessionsDir()) return false;
  const filePath = path.join(SESSIONS_DIR, session.id + '.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify(session), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function deleteSession(id) {
  if (!id || !_ensureSessionsDir()) return false;
  const filePath = path.join(SESSIONS_DIR, id + '.json');
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  init: init,
  resolveHome: resolveHome,
  readConfig: readConfig,
  writeConfig: writeConfig,
  readFile: readFile,
  writeFile: writeFile,
  removeDir: removeDir,
  getDataDir: function () { return DATA_DIR; },
  getAgentList: getAgentList,
  findAgentRaw: findAgentRaw,
  getAgentWorkspace: getAgentWorkspace,
  scanSkills: scanSkills,
  scanGlobalSkills: scanGlobalSkills,
  scanExtraDirsSkills: scanExtraDirsSkills,
  getAvailableModels: getAvailableModels,
  getAgentModel: getAgentModel,
  syncTeamRoster: syncTeamRoster,
  syncSubAgentRoster: syncSubAgentRoster,
  syncAllRosters: syncAllRosters,
  patchAgentField: patchAgentField,
  unbindSkillFromAll: unbindSkillFromAll,
  cleanupWorkspace: cleanupWorkspace,
  _resolveGlobalSkillsDir: _resolveGlobalSkillsDir,
  getSessionList: getSessionList,
  getSession: getSession,
  saveSession: saveSession,
  deleteSession: deleteSession,
};
