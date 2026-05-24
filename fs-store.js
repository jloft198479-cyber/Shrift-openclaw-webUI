const fs = require('fs');
const path = require('path');

let OPENCLAW_CONFIG = '';
let SESSIONS_DIR = '';

function init(configPath, projectDir) {
  OPENCLAW_CONFIG = configPath;
  if (configPath) {
    SESSIONS_DIR = path.join(path.dirname(configPath), 'sessions');
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

function _buildSubAgentsSection(subAgents) {
  const lines = ['## Sub-Agents', '', 'You can spawn sub-agents using the `sessions_spawn` tool:', ''];
  subAgents.forEach(function (sub) {
    const ws = resolveHome(sub.workspace || '');
    const info = ws ? _readAgentSummary(ws) : { name: sub.id, emoji: '', summary: sub.description || '' };
    const display = info.emoji ? info.emoji + ' ' + (info.name || sub.id) : (info.name || sub.id);
    const desc = info.summary || sub.description || '';
    lines.push('- **' + sub.id + '** (' + display + ') — ' + desc);
  });
  lines.push('');
  lines.push('## @Mention Handling Rules');
  lines.push('');
  lines.push('When the user message contains @agent_name:');
  lines.push('');
  lines.push('1. **MUST** use `sessions_spawn` to delegate the task to the mentioned sub-agent');
  lines.push('2. The `task` parameter should contain ONLY the user\'s actual request (strip the @mention prefix)');
  lines.push('3. The `agentId` parameter should be the sub-agent\'s ID');
  lines.push('4. After spawning, briefly confirm to the user that you\'ve delegated the task');
  lines.push('5. **NEVER** say anything like "身份切换" or "切换角色" — you are the main assistant and always remain so');
  lines.push('6. **NEVER** answer on behalf of the sub-agent — let the sub-agent respond independently');
  lines.push('7. If the user @mentions multiple agents, spawn each one separately');
  lines.push('');
  return lines.join('\n');
}

function _buildTeamMembersSection(currentAgentId, allAgents) {
  const siblings = allAgents.filter(function (a) { return a.id !== currentAgentId; });
  if (siblings.length === 0) return '';
  const lines = ['', '## Team Members', '', 'You can collaborate with these agents:', ''];
  siblings.forEach(function (sib) {
    const ws = resolveHome(sib.workspace || '');
    const info = ws ? _readAgentSummary(ws) : { name: sib.id, emoji: '', summary: sib.description || '' };
    const display = info.emoji ? info.emoji + ' ' + (info.name || sib.id) : (info.name || sib.id);
    const desc = info.summary || sib.description || '';
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
  const mentionResult = _extractSection(subResult.rest, '## @Mention Handling Rules');
  const preserved = mentionResult.rest.trim();

  const newSection = _buildSubAgentsSection(subAgents);
  const newContent = preserved + '\n\n' + newSection + '\n';

  return writeFile(agentsMdPath, newContent.trim() + '\n');
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

  const agentsMdPath = path.join(workspace, 'AGENTS.md');
  const existing = readFile(agentsMdPath) || '';

  const teamResult = _extractSection(existing, '## Team Members');
  const preserved = teamResult.rest.trim();

  const teamSection = _buildTeamMembersSection(agentId, list);
  const newContent = preserved + teamSection;

  return writeFile(agentsMdPath, newContent.trim() + '\n');
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
  getAgentList: getAgentList,
  findAgentRaw: findAgentRaw,
  getAgentWorkspace: getAgentWorkspace,
  scanSkills: scanSkills,
  scanExtraDirsSkills: scanExtraDirsSkills,
  getAvailableModels: getAvailableModels,
  getAgentModel: getAgentModel,
  syncTeamRoster: syncTeamRoster,
  syncSubAgentRoster: syncSubAgentRoster,
  syncAllRosters: syncAllRosters,
  getSessionList: getSessionList,
  getSession: getSession,
  saveSession: saveSession,
  deleteSession: deleteSession,
};
