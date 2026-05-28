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
  patchAgentField: patchAgentField,
  cleanupWorkspace: cleanupWorkspace,
  _resolveGlobalSkillsDir: _resolveGlobalSkillsDir,
  getSessionList: getSessionList,
  getSession: getSession,
  saveSession: saveSession,
  deleteSession: deleteSession,
};
