const path = require('path');
const store = require('./fs-store');

let _agentsCache = null;
let _agentsCacheTime = 0;

function invalidateCache() {
  _agentsCache = null;
  _agentsCacheTime = 0;
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
    return {
      id: a.id || '',
      name: a.name || a.id || '',
      avatar: (a.identity && a.identity.emoji) || '🤖',
      description: a.description || (a.identity && a.identity.description) || '',
      workspace: ws,
      skills: store.scanSkills(ws),
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
    avatar: (raw.identity && raw.identity.emoji) || '🤖',
    description: raw.description || (raw.identity && raw.identity.description) || '',
    workspace: ws,
    agentsMd: agentsMd,
    hasBootstrap: require('fs').existsSync(path.join(ws, 'BOOTSTRAP.md')),
    skills: store.scanSkills(ws),
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
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid agent ID' }));
    return;
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
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const wsPath = path.join(home, '.openclaw', 'workspace-' + id);
  const wsRelative = '~/.openclaw/workspace-' + id;
  if (!require('fs').existsSync(wsPath)) require('fs').mkdirSync(wsPath, { recursive: true });
  const prompt = body.prompt || '';
  if (prompt) store.writeFile(path.join(wsPath, 'AGENTS.md'), prompt);
  const avatar = body.avatar || '🤖';
  const desc = body.description || '';
  const newAgent = { id: id, name: body.name, workspace: wsRelative, identity: { emoji: avatar }, description: desc };
  if (body.model) newAgent.model = { primary: body.model };
  agentList.push(newAgent);
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
      if (body.name !== undefined) agentList[i].name = body.name;
      if (!agentList[i].identity) agentList[i].identity = {};
      if (body.avatar !== undefined) {
        agentList[i].identity.emoji = body.avatar;
      }
      if (body.description !== undefined) agentList[i].description = body.description;
      if (body.model !== undefined) {
        if (!agentList[i].model) agentList[i].model = {};
        agentList[i].model.primary = body.model;
      }
      break;
    }
  }
  if (!found) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Agent not found' }));
    return;
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
  for (let i = 0; i < agentList.length; i++) {
    if (agentList[i].id === agentId) {
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
  const agents = (function () {
    const rawList = store.getAgentList();
    return rawList.map(function (a) {
      const ws = store.resolveHome(a.workspace || '');
      return { id: a.id, skills: store.scanSkills(ws) };
    });
  })();
  const skillMap = {};
  agents.forEach(function (ag) {
    (ag.skills || []).forEach(function (sk) {
      if (!skillMap[sk.id]) skillMap[sk.id] = { id: sk.id, name: sk.name, description: sk.description, icon: sk.icon, boundAgents: [] };
      skillMap[sk.id].boundAgents.push(ag.id);
    });
  });
  const extraSkills = store.scanExtraDirsSkills();
  extraSkills.forEach(function (sk) {
    if (!skillMap[sk.id]) skillMap[sk.id] = { id: sk.id, name: sk.name, description: sk.description, icon: sk.icon, source: sk.source, path: sk.path, boundAgents: [] };
  });
  const list = [];
  for (const k in skillMap) list.push(skillMap[k]);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(list));
}

function getAgentSkills(agentId, res) {
  const ws = store.getAgentWorkspace(agentId);
  if (!ws) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Agent not found' })); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(store.scanSkills(ws)));
}

function _doSkillAction(agentId, action, skillId, skillMeta) {
  const ws = store.getAgentWorkspace(agentId);
  if (!ws) return { ok: false, code: 404, error: 'Agent not found' };
  if (action === 'bind') {
    const skillDir = path.join(ws, 'skills', skillId);
    const content = '# ' + ((skillMeta && skillMeta.name) || skillId) + '\n\n'
      + (skillMeta && skillMeta.description ? '> ' + skillMeta.description + '\n\n' : '')
      + (skillMeta && skillMeta.icon ? '**Icon**: ' + skillMeta.icon + '\n\n' : '')
      + '## Description\n\n' + ((skillMeta && skillMeta.description) || (skillMeta && skillMeta.name) || skillId) + '\n';
    if (store.writeFile(path.join(skillDir, 'SKILL.md'), content)) {
      invalidateCache();
      return { ok: true };
    } else {
      return { ok: false, code: 500, error: 'Failed to create skill' };
    }
  }
  if (action === 'unbind') {
    if (store.removeDir(path.join(ws, 'skills', skillId))) {
      invalidateCache();
      return { ok: true };
    } else {
      return { ok: false, code: 500, error: 'Failed to remove skill' };
    }
  }
  return { ok: false, code: 400, error: 'Unknown action' };
}

function handleSkillAction(agentId, body, res) {
  const result = _doSkillAction(agentId, body.action, body.skillId, {
    name: body.skillName,
    description: body.skillDescription,
    icon: body.skillIcon,
  });
  if (result.ok) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } else {
    res.writeHead(result.code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: result.error }));
  }
}

function syncSkills(agentId, body, res) {
  const ws = store.getAgentWorkspace(agentId);
  if (!ws) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Agent not found' })); return; }
  const wanted = (body.skills && Array.isArray(body.skills)) ? body.skills : [];
  const current = store.scanSkills(ws);
  const currentIds = current.map(function (s) { return s.id; });
  const toBind = wanted.filter(function (id) { return currentIds.indexOf(id) < 0; });
  const toUnbind = currentIds.filter(function (id) { return wanted.indexOf(id) < 0; });
  const allExtra = store.scanExtraDirsSkills();
  const extraMap = {};
  allExtra.forEach(function (s) { extraMap[s.id] = s; });
  const errors = [];
  for (let i = 0; i < toUnbind.length; i++) {
    const r = _doSkillAction(agentId, 'unbind', toUnbind[i]);
    if (!r.ok) errors.push(r.error);
  }
  for (let j = 0; j < toBind.length; j++) {
    const sk = extraMap[toBind[j]] || { name: toBind[j], description: '', icon: '' };
    const r2 = _doSkillAction(agentId, 'bind', toBind[j], { name: sk.name, description: sk.description, icon: sk.icon });
    if (!r2.ok) errors.push(r2.error);
  }
  invalidateCache();
  if (errors.length > 0) {
    res.writeHead(207, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, bound: toBind.length, unbound: toUnbind.length, warnings: errors }));
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, bound: toBind.length, unbound: toUnbind.length }));
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
  updateDefaultModel: updateDefaultModel,
  listModels: listModels,
};
