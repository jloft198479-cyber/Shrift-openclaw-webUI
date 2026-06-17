const fs = require('fs');
const path = 'D:\\AppData\\openclaw\\skills\\flowus-agent\\flowus-write.js';
let lines = fs.readFileSync(path, 'utf-8').split('\n');

// Helper: replace lines from startLine to endLine (1-based, inclusive) with new content
function replaceLines(startLine, endLine, newContent) {
  const before = lines.slice(0, startLine - 1);
  const after = lines.slice(endLine);
  lines = [...before, ...newContent, ...after];
}

// ============ Change 1: Fix createPage properties format (lines 713-721) ============
// Replace lines 713-721 with the new simplified format
const newLines1 = [
  "  // 官方文档格式：创建时用简化格式（不含 annotations/plain_text/href 等读取字段）",
  "  const body = {",
  "    parent,",
  "    properties: {",
  "      title: {",
  "        type: 'title',",
  "        title: [",
  "          { text: { content: title } }",
  "        ],",
  "      },",
  "    },",
  "  };",
];

// Verify current content at lines 713-721
const current1 = lines.slice(712, 721).join('\n');
const expected1 = [
  "  const body = {",
  "    parent,",
  "    properties: {",
  "      title: {",
  "        type: 'title',",
  "        title: [rt(title)],",
  "      },",
  "    },",
  "  };",
].join('\n');

if (current1 === expected1) {
  replaceLines(713, 721, newLines1);
  console.log('Change 1: OK');
} else {
  console.log('Change 1: NOT FOUND');
  console.log('Current:', JSON.stringify(current1));
  console.log('Expected:', JSON.stringify(expected1));
}

// ============ Change 3: Fix findPageByTitle (lines 654-687) ============
const newLines3 = [
  "async function findPageByTitle(dbId, title) {",
  "  try {",
  "    // 优先用 search API 精确匹配（高效，无需全量拉取）",
  "    const results = await rest.search(title, { pageSize: 10 });",
  "    for (const r of results) {",
  "      const props = r.properties || {};",
  "      const titleProp = props.title || props['\u6807\u9898'] || props.Name || props.name;",
  "      if (!titleProp) continue;",
  "",
  "      const val = titleProp[titleProp.type];",
  "      let text = '';",
  "      if (Array.isArray(val)) {",
  "        text = val.map(v => v.plain_text || v.text?.content || '').join('');",
  "      } else if (typeof val === 'string') {",
  "        text = val;",
  "      } else if (val?.name) {",
  "        text = val.name;",
  "      }",
  "",
  "      if (text === title) return r.id;",
  "    }",
  "",
  "    return null;",
  "  } catch (e) {",
  "    log(`查找页面失败: ${e.message.substring(0, 60)}`);",
  "    return null;",
  "  }",
  "}",
];

// Verify current content at lines 654-687
const current3 = lines.slice(653, 687).join('\n');
const expected3Start = "async function findPageByTitle(dbId, title) {";
const expected3HasQuery = current3.includes("rest.queryDatabase");

if (current3.startsWith(expected3Start) && expected3HasQuery) {
  replaceLines(654, 687, newLines3);
  console.log('Change 3: OK');
} else {
  console.log('Change 3: NOT FOUND');
  console.log('Starts with expected:', current3.startsWith(expected3Start));
  console.log('Has queryDatabase:', expected3HasQuery);
}

// ============ Change 2: Fix modeWriteText (lines 1241-1275) ============
// After Change 3, line numbers may have shifted. Find modeWriteText by content.
let modeWriteTextStart = -1;
let modeWriteTextEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === 'async function modeWriteText(opts) {') {
    modeWriteTextStart = i;
    // Find the closing brace (matching brace)
    let depth = 0;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }
      if (depth === 0 && j > i) {
        modeWriteTextEnd = j;
        break;
      }
    }
    break;
  }
}

if (modeWriteTextStart >= 0 && modeWriteTextEnd >= 0) {
  const currentFunc = lines.slice(modeWriteTextStart, modeWriteTextEnd + 1).join('\n');
  // Verify it's the old version (has mdToBlocks)
  if (currentFunc.includes('mdToBlocks') && currentFunc.includes('appendBlocks')) {
    const newLines2 = [
      "async function modeWriteText(opts) {",
      "  const text = opts.textContent;",
      "  const title = opts.title || `笔记-${new Date().toISOString().slice(0, 10)}`;",
      "",
      "  out(`\\n📝 直接写入文本`);",
      "  out(`📄 标题: ${title}`);",
      "",
      "  const parentDbId = opts.parentDbId || DEFAULT_PARENT_DB;",
      "  let pageId;",
      "",
      "  if (opts.updateMode) {",
      "    const canSearch = opts.parentType !== 'page';",
      "    if (canSearch) pageId = await findPageByTitle(parentDbId, title);",
      "    if (pageId) {",
      "      out(`🔄 更新已有页面: ${pageId}`);",
      "      await clearPageBlocks(pageId);",
      "    } else {",
      "      out(`⚠️ 未找到 \"${title}\"，将新建...`);",
      "      pageId = await createPage({ parentDbId, title, icon: opts.icon, coverUrl: opts.coverUrl, parentType: opts.parentType });",
      "      out(`✅ 新建: ${pageId}`);",
      "    }",
      "  } else {",
      "    pageId = await createPage({ parentDbId, title, icon: opts.icon, coverUrl: opts.coverUrl, parentType: opts.parentType });",
      "    out(`✅ 新建: ${pageId}`);",
      "  }",
      "",
      "  if (opts.dryRun) {",
      "    out(`\\n[Dry Run] [putMarkdown 模式] 将发送 ${text.length} 字符`);",
      "    return;",
      "  }",
      "",
      "  // 使用 putMarkdown 混合模式（与文件上传一致，格式保真度最高）",
      "  await rest.sleep(1500);",
      "  await writeViaHybrid(pageId, text);",
      "  out(`\\n✅ [混合模式] 完成！已发送 ${text.length} 字符`);",
      "  out(`📄 页面 ID: ${pageId}`);",
      "  out(`🔗 https://flowus.cn/${pageId.replace(/-/g, '')}`);",
      "}",
    ];

    // Replace lines (0-based indexing: modeWriteTextStart to modeWriteTextEnd inclusive)
    const before = lines.slice(0, modeWriteTextStart);
    const after = lines.slice(modeWriteTextEnd + 1);
    lines = [...before, ...newLines2, ...after];
    console.log('Change 2: OK (lines ' + (modeWriteTextStart+1) + '-' + (modeWriteTextEnd+1) + ')');
  } else {
    console.log('Change 2: NOT FOUND (function exists but already modified or different)');
  }
} else {
  console.log('Change 2: NOT FOUND (function not located)');
}

// Write back
fs.writeFileSync(path, lines.join('\n'), 'utf-8');
console.log('All changes written to file.');
