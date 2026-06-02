const path = require('path');
const fs = require('fs');
const store = require('./fs-store');
const rosterSync = require('./roster-sync');

let _agentsCache = null;
let _agentsCacheTime = 0;

function _jsonOk(res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true }));
}

function _jsonErr(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg }));
}

function invalidateCache() {
  _agentsCache = null;
  _agentsCacheTime = 0;
}

function _sanitizeFolderName(name) {
  if (!name) return '';
  return name.replace(/[\\\/:*?"<>|]/g, '').trim();
}

function _resolveSkills(skillIds) {
  const globalSkills = store.scanGlobalSkills();
  const extraSkills = store.scanExtraDirsSkills();
  const allSkills = globalSkills.concat(extraSkills);
  return skillIds.map(function (sid) {
    const found = allSkills.find(function (gs) { return gs.id === sid; });
    if (found) return found;
    return { id: sid, name: sid, description: '', icon: '', missing: true };
  });
}

function listAgents(res) {
  const now = Date.now();
  if (_agentsCache && now - _agentsCacheTime < 30000) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(_agentsCache));
    return;
  }
  const rawList = store.getAgentList();
  const agents = rawList.map(function (a) {
    const ws = store.resolveHome(a.workspace || '');
    const agentSkillIds = a.skills || [];
    return {
      id: a.id || '',
      name: a.name || a.id || '',
      avatar: (a.identity && a.identity.emoji) || '',
      description: a.description || (a.identity && a.identity.description) || '',
      workspace: ws,
      skills: _resolveSkills(agentSkillIds),
      model: (a.model && a.model.primary) || '',
    };
  });
  _agentsCache = agents;
  _agentsCacheTime = now;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(agents));
}

function getAgentDetail(agentId, res) {
  const raw = store.findAgentRaw(agentId);
  if (!raw) { _jsonErr(res, 404, 'Agent not found'); return; }
  const ws = store.resolveHome(raw.workspace || '');
  const agentsMd = store.readFile(path.join(ws, 'AGENTS.md')) || '';
  const toolsMd = store.readFile(path.join(ws, 'TOOLS.md')) || '';
  const teamSection = _extractTeamFromToolsMd(toolsMd);
  const subagents = raw.subagents || {};
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    id: raw.id, name: raw.name || raw.id,
    avatar: (raw.identity && raw.identity.emoji) || '',
    description: raw.description || (raw.identity && raw.identity.description) || '',
    workspace: ws, agentsMd: agentsMd,
    hasBootstrap: fs.existsSync(path.join(ws, 'BOOTSTRAP.md')),
    skills: _resolveSkills(raw.skills || []),
    model: (raw.model && raw.model.primary) || '',
    teamMembers: teamSection,
    allowAgents: subagents.allowAgents || [],
  }));
}

function _extractTeamFromToolsMd(md) {
  if (!md) return [];
  const members = [];
  const lines = md.split('\n');
  let inTeam = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^##\s+团队成员/)) { inTeam = true; continue; }
    if (inTeam && line.match(/^##\s+/)) { inTeam = false; continue; }
    if (inTeam) {
      const m = line.match(/^-\s+(.+?)(?:\s+—\s+(.+))?$/);
      if (m) {
        members.push({ display: m[1].trim(), summary: m[2] ? m[2].trim() : '' });
      }
    }
  }
  return members;
}

function _ensureInAllowAgents(agentList, agentId) {
  for (let i = 0; i < agentList.length; i++) {
    if ((agentList[i].id === 'main' || agentList[i].default) && agentList[i].subagents) {
      if (!agentList[i].subagents.allowAgents) agentList[i].subagents.allowAgents = [];
      if (agentList[i].subagents.allowAgents.indexOf(agentId) < 0) {
        agentList[i].subagents.allowAgents.push(agentId);
      }
    }
  }
}

function _removeFromAllowAgents(agentList, agentId) {
  for (let i = 0; i < agentList.length; i++) {
    if (agentList[i].subagents && agentList[i].subagents.allowAgents) {
      const idx = agentList[i].subagents.allowAgents.indexOf(agentId);
      if (idx >= 0) agentList[i].subagents.allowAgents.splice(idx, 1);
    }
  }
}

function _saveAgentList(data, agentList) {
  if (data.agents && data.agents.list) data.agents.list = agentList;
  else data.agents = agentList;
  return store.writeConfig(data);
}
function _genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

const _GENERIC_IDS = { agent: 1, bot: 1, ai: 1, assistant: 1, helper: 1 };

function createAgent(body, res) {
  if (!body || !body.name) { _jsonErr(res, 400, 'Name is required'); return; }
  let id = body.id || body.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!id || id.length <= 2 || _GENERIC_IDS[id]) {
    id = (id || 'agent') + '-' + _genId();
  }
  const data = store.readConfig();
  if (!data) { _jsonErr(res, 500, 'Cannot read config'); return; }
  let agentList = (data.agents && data.agents.list) || data.agents || [];
  if (!Array.isArray(agentList)) agentList = [];
  for (let i = 0; i < agentList.length; i++) {
    if (agentList[i].id === id) { _jsonErr(res, 409, 'Agent ID already exists'); return; }
  }
  const dataDir = store.getDataDir();
  const safeName = _sanitizeFolderName(body.name) || id;
  const wsName = 'workspace-' + safeName;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  let wsPath = path.join(home, '.openclaw', wsName);
  const wsRelative = '~/.openclaw/' + wsName;
  if (dataDir) {
    wsPath = path.join(dataDir, wsName);
  }
  if (fs.existsSync(wsPath)) { _jsonErr(res, 409, '工作目录已存在: ' + wsName); return; }
  fs.mkdirSync(wsPath, { recursive: true });
  const prompt = body.prompt || '';
  if (prompt) store.writeFile(path.join(wsPath, 'AGENTS.md'), prompt);
  const toolsMd = body.toolsMd || '';
  if (toolsMd) store.writeFile(path.join(wsPath, 'TOOLS.md'), toolsMd);
  const avatar = body.avatar || '';
  const desc = body.description || '';
  const newAgent = { id: id, name: body.name, workspace: wsRelative, identity: { emoji: avatar }, description: desc };
  if (body.model) newAgent.model = { primary: body.model };
  if (Object.hasOwn(body, 'skills') && Array.isArray(body.skills)) {
    newAgent.skills = body.skills;
  }
  agentList.push(newAgent);
  _ensureInAllowAgents(agentList, id);
  if (_saveAgentList(data, agentList)) {
    invalidateCache();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, id: id }));
    rosterSync.syncAllRosters();
  } else { _jsonErr(res, 500, 'Failed to write config'); }
}

function updateAgent(agentId, body, res) {
  const data = store.readConfig();
  if (!data) { _jsonErr(res, 500, 'Cannot read config'); return; }
  let agentList = (data.agents && data.agents.list) || data.agents || [];
  if (!Array.isArray(agentList)) agentList = [];
  let found = false;
  for (let i = 0; i < agentList.length; i++) {
    if (agentList[i].id === agentId) {
      found = true;
      if (Object.hasOwn(body, 'name')) agentList[i].name = body.name;
      if (!agentList[i].identity) agentList[i].identity = {};
      if (Object.hasOwn(body, 'avatar')) agentList[i].identity.emoji = body.avatar;
      if (Object.hasOwn(body, 'description')) agentList[i].description = body.description;
      if (Object.hasOwn(body, 'model')) {
        if (!agentList[i].model) agentList[i].model = {};
        agentList[i].model.primary = body.model;
      }
      if (Object.hasOwn(body, 'skills')) agentList[i].skills = body.skills;
      const ws = store.resolveHome(agentList[i].workspace || '');
      if (body.prompt && ws) store.writeFile(path.join(ws, 'AGENTS.md'), body.prompt);
      // 工作目录名与名称不一致时自动重命名
      if (Object.hasOwn(body, 'name') && ws && fs.existsSync(ws)) {
        const safeName = _sanitizeFolderName(body.name);
        if (safeName) {
          const currentDirName = path.basename(ws);
          const expectedDirName = 'workspace-' + safeName;
          if (currentDirName !== expectedDirName) {
            const parentDir = path.dirname(ws);
            const newWsPath = path.join(parentDir, expectedDirName);
            if (fs.existsSync(newWsPath)) {
              _jsonErr(res, 409, '工作目录已存在: ' + expectedDirName); return;
            }
            try {
              fs.renameSync(ws, newWsPath);
              agentList[i].workspace = agentList[i].workspace.replace(currentDirName, expectedDirName);
            } catch (e) {
              console.error('[Agent] Rename workspace failed:', e.message);
              _jsonErr(res, 500, '重命名工作目录失败: ' + e.message); return;
            }
          }
        }
      }
      break;
    }
  }
  if (!found) { _jsonErr(res, 404, 'Agent not found'); return; }
  _ensureInAllowAgents(agentList, agentId);
  if (_saveAgentList(data, agentList)) {
    invalidateCache();
    _jsonOk(res);
    rosterSync.syncAllRosters();
  } else { _jsonErr(res, 500, 'Failed to write config'); }
}

function deleteAgent(agentId, res) {
  const data = store.readConfig();
  if (!data) { _jsonErr(res, 500, 'Cannot read config'); return; }
  let agentList = (data.agents && data.agents.list) || data.agents || [];
  if (!Array.isArray(agentList)) agentList = [];
  let found = false;
  let deletedWorkspace = '';
  for (let i = 0; i < agentList.length; i++) {
    if (agentList[i].id === agentId) {
      deletedWorkspace = agentList[i].workspace || '';
      agentList.splice(i, 1);
      found = true;
      break;
    }
  }
  if (!found) { _jsonErr(res, 404, 'Agent not found'); return; }
  _removeFromAllowAgents(agentList, agentId);
  if (_saveAgentList(data, agentList)) {
    invalidateCache();
    _jsonOk(res);
    rosterSync.syncAllRosters();
    if (deletedWorkspace) store.cleanupWorkspace(deletedWorkspace);
  } else { _jsonErr(res, 500, 'Failed to write config'); }
}

function getAgentsMd(agentId, res) {
  const ws = store.getAgentWorkspace(agentId);
  if (!ws) { _jsonErr(res, 404, 'Agent not found'); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ content: store.readFile(path.join(ws, 'AGENTS.md')) || '' }));
}

function putAgentsMd(agentId, body, res) {
  const ws = store.getAgentWorkspace(agentId);
  if (!ws) { _jsonErr(res, 404, 'Agent not found'); return; }
  if (store.writeFile(path.join(ws, 'AGENTS.md'), (body && body.content) || '')) {
    invalidateCache();
    _jsonOk(res);
    rosterSync.syncAllRosters();
  } else { _jsonErr(res, 500, 'Write failed'); }
}

function getToolsMd(agentId, res) {
  const ws = store.getAgentWorkspace(agentId);
  if (!ws) { _jsonErr(res, 404, 'Agent not found'); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ content: store.readFile(path.join(ws, 'TOOLS.md')) || '' }));
}

function putToolsMd(agentId, body, res) {
  const ws = store.getAgentWorkspace(agentId);
  if (!ws) { _jsonErr(res, 404, 'Agent not found'); return; }
  let content = (body && body.content) || '';
  content = rosterSync.stripSystemSection(content);
  if (store.writeFile(path.join(ws, 'TOOLS.md'), content)) {
    _jsonOk(res);
    rosterSync.syncAllRosters();
  } else { _jsonErr(res, 500, 'Write failed'); }
}

function deleteBootstrap(agentId, res) {
  const ws = store.getAgentWorkspace(agentId);
  if (!ws) { _jsonErr(res, 404, 'Agent not found'); return; }
  const bp = path.join(ws, 'BOOTSTRAP.md');
  try { if (fs.existsSync(bp)) fs.unlinkSync(bp); } catch (e) {}
  _jsonOk(res);
}

function listSkills(res) {
  const globalSkills = store.scanGlobalSkills();
  const extraSkills = store.scanExtraDirsSkills();
  const rawList = store.getAgentList();
  const skillMap = {};
  globalSkills.forEach(function (sk) {
    skillMap[sk.id] = { id: sk.id, name: sk.name, description: sk.description, icon: sk.icon, source: sk.source || 'global', path: sk.path, boundAgents: [] };
  });
  extraSkills.forEach(function (sk) {
    if (!skillMap[sk.id]) skillMap[sk.id] = { id: sk.id, name: sk.name, description: sk.description, icon: sk.icon, source: sk.source || 'extraDir', path: sk.path, boundAgents: [] };
  });
  rawList.forEach(function (a) {
    const agentSkillIds = a.skills || [];
    agentSkillIds.forEach(function (sid) {
      if (skillMap[sid]) {
        skillMap[sid].boundAgents.push(a.id);
      } else {
        skillMap[sid] = { id: sid, name: sid, description: '', icon: '', source: 'config', boundAgents: [a.id], missing: true };
      }
    });
  });
  const list = [];
  for (const k in skillMap) list.push(skillMap[k]);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(list));
}

function getAgentSkills(agentId, res) {
  const raw = store.findAgentRaw(agentId);
  if (!raw) { _jsonErr(res, 404, 'Agent not found'); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(_resolveSkills(raw.skills || [])));
}

function _applySkillChange(agentId, skillIds, res) {
  const data = store.readConfig();
  if (!data) { _jsonErr(res, 500, 'Cannot read config'); return; }
  if (!store.patchAgentField(agentId, 'skills', skillIds)) { _jsonErr(res, 500, 'Failed to write config'); return; }
  invalidateCache();
  _jsonOk(res);
  rosterSync.syncAllRosters();
}

function handleSkillAction(agentId, body, res) {
  if (!body || !body.skillId) { _jsonErr(res, 400, 'Missing skillId'); return; }
  const raw = store.findAgentRaw(agentId);
  if (!raw) { _jsonErr(res, 404, 'Agent not found'); return; }
  let skills = raw.skills || [];
  if (body.action === 'bind') {
    if (skills.indexOf(body.skillId) < 0) skills = skills.concat(body.skillId);
  } else if (body.action === 'unbind') {
    skills = skills.filter(function (s) { return s !== body.skillId; });
  } else { _jsonErr(res, 400, 'Unknown action'); return; }
  _applySkillChange(agentId, skills, res);
}

function syncSkills(agentId, body, res) {
  const wanted = (body.skills && Array.isArray(body.skills)) ? body.skills : [];
  _applySkillChange(agentId, wanted, res);
}

function deleteSkill(skillId, res) {
  const globalSkillsDir = store._resolveGlobalSkillsDir ? store._resolveGlobalSkillsDir() : null;
  if (!rosterSync.unbindSkillFromAll(skillId)) { _jsonErr(res, 500, 'Failed to unbind skill from agents'); return; }
  const warnings = [];
  if (globalSkillsDir) {
    const skillDir = path.join(globalSkillsDir, skillId);
    try {
      if (fs.existsSync(skillDir)) {
        if (!store.removeDir(skillDir)) warnings.push('Failed to delete skill directory: ' + skillDir);
      }
    } catch (e) { warnings.push('Error deleting skill directory: ' + e.message); }
  }
  invalidateCache();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(warnings.length > 0 ? { success: true, warnings: warnings } : { success: true }));
}

function updateDefaultModel(body, res) {
  if (!body || !body.model) { _jsonErr(res, 400, 'Model is required'); return; }
  const data = store.readConfig();
  if (!data) { _jsonErr(res, 500, 'Cannot read config'); return; }
  if (!data.agents) data.agents = {};
  if (!data.agents.defaults) data.agents.defaults = {};
  if (!data.agents.defaults.model) data.agents.defaults.model = {};
  data.agents.defaults.model.primary = body.model;
  if (store.writeConfig(data)) { invalidateCache(); _jsonOk(res); }
  else { _jsonErr(res, 500, 'Failed to write config'); }
}

function listModels(res) {
  const models = store.getAvailableModels();
  const defaultModel = store.getAgentModel('__defaults__');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ models: models, defaultModel: defaultModel }));
}

module.exports = {
  invalidateCache: invalidateCache,
  listAgents: listAgents,
  getAgentDetail: getAgentDetail,
  createAgent: createAgent,
  updateAgent: updateAgent,
  deleteAgent: deleteAgent,
  getAgentsMd: getAgentsMd,
  putAgentsMd: putAgentsMd,
  getToolsMd: getToolsMd,
  putToolsMd: putToolsMd,
  deleteBootstrap: deleteBootstrap,
  listSkills: listSkills,
  getAgentSkills: getAgentSkills,
  handleSkillAction: handleSkillAction,
  syncSkills: syncSkills,
  deleteSkill: deleteSkill,
  updateDefaultModel: updateDefaultModel,
  listModels: listModels,
};
