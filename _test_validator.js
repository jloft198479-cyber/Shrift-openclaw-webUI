const v = require('./workspace-validator');
const tests = [
  ['空路径', ''],
  ['null输入', null],
  ['驱动器根C:', 'C:\\'],
  ['驱动器根D:', 'D:\\'],
  ['Windows系统', 'C:\\Windows'],
  ['Program Files', 'C:\\Program Files'],
  ['Users目录', 'C:\\Users'],
  ['不存在目录', 'F:\\nonexistent-dir-xyz123'],
  ['正常项目', 'F:\\fzz-Project\\openclaw-web-ui'],
  ['前后空格', '  F:\\fzz-Project\\openclaw-web-ui  '],
];
tests.forEach(function(t) {
  var result = v.validateWorkspacePath(t[1]);
  console.log(t[0] + ':', JSON.stringify(result));
});
console.log('\n--- checkWorkspaceExists ---');
console.log('存在:', JSON.stringify(v.checkWorkspaceExists('F:\\fzz-Project\\openclaw-web-ui')));
console.log('不存在:', JSON.stringify(v.checkWorkspaceExists('F:\\nonexistent-xyz')));
console.log('空:', JSON.stringify(v.checkWorkspaceExists('')));
