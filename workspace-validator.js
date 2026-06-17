/**
 * workspace-validator.js — 工作目录路径校验
 *
 * 职责单一：验证用户选择的路径是否合法、安全、有效。
 * 不涉及配置读写、API 路由、UI 渲染。
 */

const fs = require('fs');
const path = require('path');

// Windows 系统目录（小写，path.resolve 后统一比较）
// 注意：c:\users 不在此列表，用户项目常在 C:\Users\xxx\projects 下
const WIN_PROTECTED = [
  'c:\\windows', 'c:\\program files', 'c:\\program files (x86)',
  'c:\\programdata'
];

// macOS/Linux 系统目录
const UNIX_PROTECTED = [
  '/etc', '/usr', '/var', '/sys', '/boot', '/proc',
  '/system', '/library', '/applications'
];

const ALL_PROTECTED = WIN_PROTECTED.concat(UNIX_PROTECTED);

/**
 * 判断路径是否为驱动器根目录（C:\、D:\、/ 等）
 */
function _isDriveRoot(resolved) {
  // Windows: C:\, D:\ 等
  if (/^[a-z]:\\?$/i.test(resolved)) return true;
  // Unix: /
  if (resolved === '/') return true;
  return false;
}

/**
 * 校验路径是否可作为全局工作目录
 * @param {string} dirPath - 用户输入的原始路径
 * @returns {{ valid: boolean, reason?: string, resolved?: string }}
 */
function validateWorkspacePath(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') {
    return { valid: false, reason: '路径不能为空' };
  }

  const resolved = path.resolve(dirPath.trim());

  // 1. 不含路径穿越（resolve 已消除 ..，双重确认）
  if (resolved.includes('..')) {
    return { valid: false, reason: '路径包含非法穿越段' };
  }

  // 2. 拒绝驱动器根目录
  if (_isDriveRoot(resolved)) {
    return { valid: false, reason: '不允许选择驱动器根目录' };
  }

  // 3. 不在系统保护目录内
  const lower = resolved.toLowerCase();
  for (let i = 0; i < ALL_PROTECTED.length; i++) {
    if (lower === ALL_PROTECTED[i] || lower.startsWith(ALL_PROTECTED[i] + path.sep)) {
      return { valid: false, reason: '不允许选择系统目录' };
    }
  }

  // 4. 路径必须存在且是目录
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return { valid: false, reason: '路径不是目录' };
    }
  } catch (e) {
    return { valid: false, reason: '目录不存在或无法访问' };
  }

  return { valid: true, resolved: resolved };
}

/**
 * 检查已配置的工作目录是否仍然有效（目录可能被删除/移动）
 * @param {string} dirPath - 已保存的路径
 * @returns {{ exists: boolean, resolved: string }}
 */
function checkWorkspaceExists(dirPath) {
  if (!dirPath) return { exists: false, resolved: '' };
  const resolved = path.resolve(dirPath);
  try {
    const stat = fs.statSync(resolved);
    return { exists: stat.isDirectory(), resolved: resolved };
  } catch (e) {
    return { exists: false, resolved: resolved };
  }
}

module.exports = { validateWorkspacePath, checkWorkspaceExists };
