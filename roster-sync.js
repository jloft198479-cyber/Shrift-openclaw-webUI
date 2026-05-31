/**
 * roster-sync.js — Agent Roster 同步
 *
 * 职责：
 * - 管理 skill 链接（symlink/junction）
 * - 校验 allowAgents 引用完整性
 * - 解绑 skill 时同步更新 roster
 *
 * 注：AGENTS.md 的 Sub-Agents 写入已被移除（方案B验证通过）。
 * OpenClaw 原生 sessions_spawn 发现机制不依赖 AGENTS.md 中的子 Agent 列表，
 * 写入是冗余的，且会破坏 LLM provider prefix cache。
 *
 * 依赖：fs-store（readConfig, writeConfig, resolveHome, _resolveGlobalSkillsDir）
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
      console.warn('[Roster] Cleaned ' + (before - sub.allowAgents.length) + ' dangling allowAgents ref(s) from agent ' + agentList[i].id);
      changed = true;
    }
  }
  return changed;
}

function syncTeamRoster() {
  return true;
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
  return true;
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
