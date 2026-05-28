const path = require('path');
const store = require('./fs-store');

let _agentsCache = null;
let _agentsCacheTime = 0;

function invalidateCache() {
  _agentsCache = null;
  _agentsCacheTime = 0;
}

function _resolveSkills(skillIds) {
  const globalSkills = store.scanGlobalSkills();
  const extraSkills = store.scanExtraDirsSkills();
  const allSkills = globalSkills.concat(extraSkills);
  return skillIds.map(function (sid) {
    const found = allSkills.find(function (gs) { return gs.id === sid; });
    return found || { id: sid, name: sid, description: '', icon: '' };
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
  if (!raw) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Agent not found' }));
    return;
  }
  const ws = store.resolveHome(raw.workspace || '');
  const agentsMd = store.readFile(path.join(ws, 'AGENTS.md')) || '';
  const teamSection = _extractTeamFromMd(agentsMd);
  const subagents = raw.subagents || {};
  const allowAgents = subagents.allowAgents || [];
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    id: raw.id,
    name: raw.name || raw.id,
    avatar: (raw.identity && raw.identity.emoji) || '',
    description: raw.description || (raw.identity && raw.identity.description) || '',
    workspace: ws,
    agentsMd: agentsMd,
    hasBootstrap: require('fs').existsSync(path.join(ws, 'BOOTSTRAP.md')),
    skills: _resolveSkills(raw.skills || []),
    model: (raw.model && raw.model.primary) || '',
    teamMembers: teamSection,
    allowAgents: allowAgents,
  }));
}

function _extractTeamFromMd(md) {
  if (!md) return [];
  var members = [];
  var lines = md.split('\n');
  var inTeamSection = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.match(/^##\s+(Sub-Agents|Team Members)/)) { inTeamSection = true; continue; }
    if (inTeamSection && line.match(/^##\s/)) { inTeamSection = false; continue; }
    if (inTeamSection) {
      var m = line.match(/^-\s+\*\*(.+?)\*\*\s+\((.+?)\)(?:\s+—\s+(.+))?$/);
      if (m) {
        members.push({ id: m[1], display: m[2], summary: m[3] || '' });
      }
    }
  }
  return members;
}

function createAgent(body, res) {
  if (!body || !body.name) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Name is required' }));
    return;
  }
  let id = body.id || body.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!id) {
    id = 'agent-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  const data = store.readConfig();
  if (!data) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Cannot read config' }));
    return;
  }
  let agentList = (data.agents && data.agents.list) || data.agents || [];
  if (!Array.isArray(agentList)) agentList = [];
  for (let i = 0; i < agentList.length; i++) {
    if (agentList[i].id === id) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent ID already exists' }));
      return;
    }
  }
  const dataDir = store.getDataDir();
  const agentsDir = dataDir ? path.join(dataDir, 'agents') : '';
  let wsPath = agentsDir ? path.join(agentsDir, 'workspace-' + id) : '';
  const wsRelative = agentsDir ? wsPath : '~/.openclaw/workspace-' + id;
  if (!wsPath) {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    wsPath = path.join(home, '.openclaw', 'workspace-' + id);
  }
  if (!require('fs').existsSync(wsPath)) require('fs').mkdirSync(wsPath, { recursive: true });
  const prompt = body.prompt || '';
  if (prompt) store.writeFile(path.join(wsPath, 'AGENTS.md'), prompt);
  const avatar = body.avatar || '';
  const desc = body.description || '';
  const newAgent = { id: id, name: body.name, workspace: wsRelative, identity: { emoji: avatar }, description: desc };
  if (body.model) newAgent.model = { primary: body.model };
  if (Object.hasOwn(body, 'skills') && Array.isArray(body.skills)) {
    newAgent.skills = body.skills;
  }
  agentList.push(newAgent);
  for (let i = 0; i < agentList.length; i++) {
    if ((agentList[i].id === 'main' || agentList[i].default) && agentList[i].subagents) {
      if (!agentList[i].subagents.allowAgents) agentList[i].subagents.allowAgents = [];
      if (agentList[i].subagents.allowAgents.indexOf(id) < 0) {
        agentList[i].subagents.allowAgents.push(id);
      }
    }
  }
  if (data.agents && data.agents.list) data.agents.list = agentList;
  else data.agents = agentList;
  if (store.writeConfig(data)) {
    invalidateCache();
    store.syncAllRosters();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, id: id }));
  } else {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to write config' }));
  }
}

function updateAgent(agentId, body, res) {
  const data = store.readConfig();
  if (!data) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Cannot read config' }));
    return;
  }
  let agentList = (data.agents && data.agents.list) || data.agents || [];
  if (!Array.isArray(agentList)) agentList = [];
  let found = false;
  for (let i = 0; i < agentList.length; i++) {
    if (agentList[i].id === agentId) {
      found = true;
      if (Object.hasOwn(body, 'name')) agentList[i].name = body.name;
      if (!agentList[i].identity) agentList[i].identity = {};
      if (Object.hasOwn(body, 'avatar')) {
        agentList[i].identity.emoji = body.avatar;
      }
      if (Object.hasOwn(body, 'description')) agentList[i].description = body.description;
      if (Object.hasOwn(body, 'model')) {
        if (!agentList[i].model) agentList[i].model = {};
        agentList[i].model.primary = body.model;
      }
      if (Object.hasOwn(body, 'skills')) {
        agentList[i].skills = body.skills;
      }
      const ws = store.resolveHome(agentList[i].workspace || '');
      const prompt = body.prompt;
      if (prompt && ws) store.writeFile(require('path').join(ws, 'AGENTS.md'), prompt);
      break;
    }
  }
  if (!found) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Agent not found' }));
    return;
  }
  for (let i = 0; i < agentList.length; i++) {
    if ((agentList[i].id === 'main' || agentList[i].default) && agentList[i].subagents) {
      if (!agentList[i].subagents.allowAgents) agentList[i].subagents.allowAgents = [];
      if (agentList[i].subagents.allowAgents.indexOf(agentId) < 0) {
        agentList[i].subagents.allowAgents.push(agentId);
      }
    }
  }
  if (data.agents && data.agents.list) data.agents.list = agentList;
  else data.agents = agentList;
  if (store.writeConfig(data)) {
    invalidateCache();
    store.syncAllRosters();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } else {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to write config' }));
  }
}

function deleteAgent(agentId, res) {
  const data = store.readConfig();
  if (!data) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Cannot read config' }));
    return;
  }
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
  if (!found) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Agent not found' }));
    return;
  }
  for (let i = 0; i < agentList.length; i++) {
    if (agentList[i].subagents && agentList[i].subagents.allowAgents) {
      const idx = agentList[i].subagents.allowAgents.indexOf(agentId);
      if (idx >= 0) agentList[i].subagents.allowAgents.splice(idx, 1);
    }
  }
  if (data.agents && data.agents.list) data.agents.list = agentList;
  else data.agents = agentList;
  if (store.writeConfig(data)) {
    invalidateCache();
    store.syncAllRosters();
    if (deletedWorkspace) {
      store.cleanupWorkspace(deletedWorkspace);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } else {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to write config' }));
  }
}

function getAgentsMd(agentId, res) {
  const ws = store.getAgentWorkspace(agentId);
  if (!ws) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Agent not found' })); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ content: store.readFile(path.join(ws, 'AGENTS.md')) || '' }));
}

function putAgentsMd(agentId, body, res) {
  const ws = store.getAgentWorkspace(agentId);
  if (!ws) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Agent not found' })); return; }
  if (store.writeFile(path.join(ws, 'AGENTS.md'), (body && body.content) || '')) {
    invalidateCache();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } else {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Write failed' }));
  }
}

function deleteBootstrap(agentId, res) {
  const ws = store.getAgentWorkspace(agentId);
  if (!ws) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Agent not found' })); return; }
  const bp = path.join(ws, 'BOOTSTRAP.md');
  try { if (require('fs').existsSync(bp)) require('fs').unlinkSync(bp); } catch (e) {}
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true }));
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
        skillMap[sid] = { id: sid, name: sid, description: '', icon: '', source: 'config', boundAgents: [a.id] };
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
  if (!raw) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Agent not found' })); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(_resolveSkills(raw.skills || [])));
}

function _doSkillAction(agentId, action, skillId) {
  const data = store.readConfig();
  if (!data) return { ok: false, code: 500, error: 'Cannot read config' };
  let agentList = (data.agents && data.agents.list) || data.agents || [];
  if (!Array.isArray(agentList)) agentList = [];
  let agentIdx = -1;
  for (let i = 0; i < agentList.length; i++) {
    if (agentList[i].id === agentId) { agentIdx = i; break; }
  }
  if (agentIdx < 0) return { ok: false, code: 404, error: 'Agent not found' };
  if (!agentList[agentIdx].skills) agentList[agentIdx].skills = [];
  if (action === 'bind') {
    if (agentList[agentIdx].skills.indexOf(skillId) < 0) {
      agentList[agentIdx].skills.push(skillId);
    }
  } else if (action === 'unbind') {
    const idx = agentList[agentIdx].skills.indexOf(skillId);
    if (idx >= 0) agentList[agentIdx].skills.splice(idx, 1);
  } else {
    return { ok: false, code: 400, error: 'Unknown action' };
  }
  if (store.writeConfig(data)) {
    invalidateCache();
    store.syncAllRosters();
    return { ok: true };
  }
  return { ok: false, code: 500, error: 'Failed to write config' };
}

function handleSkillAction(agentId, body, res) {
  const result = _doSkillAction(agentId, body.action, body.skillId);
  if (result.ok) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } else {
    res.writeHead(result.code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: result.error }));
  }
}

function syncSkills(agentId, body, res) {
  const wanted = (body.skills && Array.isArray(body.skills)) ? body.skills : [];
  if (store.patchAgentField(agentId, 'skills', wanted)) {
    invalidateCache();
    store.syncAllRosters();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } else {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to write config' }));
  }
}

function deleteSkill(skillId, res) {
  const globalSkillsDir = store._resolveGlobalSkillsDir ? store._resolveGlobalSkillsDir() : null;
  if (!store.unbindSkillFromAll(skillId)) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to unbind skill from agents' }));
    return;
  }
  const warnings = [];
  if (globalSkillsDir) {
    const skillDir = require('path').join(globalSkillsDir, skillId);
    try {
      if (require('fs').existsSync(skillDir)) {
        if (!store.removeDir(skillDir)) {
          warnings.push('Failed to delete skill directory: ' + skillDir + '. It may reappear after restart.');
        }
      }
    } catch (e) {
      warnings.push('Error deleting skill directory: ' + e.message);
    }
  }
  invalidateCache();
  if (warnings.length > 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, warnings: warnings }));
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  }
}

function updateDefaultModel(body, res) {
  if (!body || !body.model) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Model is required' }));
    return;
  }
  const data = store.readConfig();
  if (!data) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Cannot read config' }));
    return;
  }
  if (!data.agents) data.agents = {};
  if (!data.agents.defaults) data.agents.defaults = {};
  if (!data.agents.defaults.model) data.agents.defaults.model = {};
  data.agents.defaults.model.primary = body.model;
  if (store.writeConfig(data)) {
    invalidateCache();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } else {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to write config' }));
  }
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
  deleteBootstrap: deleteBootstrap,
  listSkills: listSkills,
  getAgentSkills: getAgentSkills,
  handleSkillAction: handleSkillAction,
  syncSkills: syncSkills,
  deleteSkill: deleteSkill,
  updateDefaultModel: updateDefaultModel,
  listModels: listModels,
};
