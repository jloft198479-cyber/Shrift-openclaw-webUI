$ErrorActionPreference = 'Stop'
$file = 'D:\AppData\openclaw\skills\flowus-agent\flowus-write.js'
$encoding = [System.Text.Encoding]::UTF8
$content = [System.IO.File]::ReadAllText($file, $encoding)

# Change 1: Fix createPage properties format
$old1 = @"
  const body = {
    parent,
    properties: {
      title: {
        type: 'title',
        title: [rt(title)],
      },
    },
  };
"@

$new1 = @"
  // 官方文档格式：创建时用简化格式（不含 annotations/plain_text/href 等读取字段）
  const body = {
    parent,
    properties: {
      title: {
        type: 'title',
        title: [
          { text: { content: title } }
        ],
      },
    },
  };
"@

if ($content.Contains($old1)) {
    $content = $content.Replace($old1, $new1)
    Write-Host 'Change 1: OK'
} else {
    Write-Host 'Change 1: NOT FOUND'
}

# Change 2: Fix modeWriteText to use writeViaHybrid
$old2 = @"
async function modeWriteText(opts) {
  const text = opts.textContent;
  const title = opts.title || ``笔记-${new Date().toISOString().slice(0, 10)}``;

  out(``\n📝 直接写入文本``);
  out(``📄 标题: ${title}``);

  const parentDbId = opts.parentDbId || DEFAULT_PARENT_DB;
  let pageId;

  if (opts.updateMode) {
    pageId = await findPageByTitle(parentDbId, title);
    if (pageId) {
      out(``🔄 更新已有页面: ${pageId}``);
      await clearPageBlocks(pageId);
    } else {
      pageId = await createPage({ parentDbId, title, icon: opts.icon, coverUrl: opts.coverUrl, parentType: opts.parentType });
      out(``✅ 新建: ${pageId}``);
    }
  } else {
    pageId = await createPage({ parentDbId, title, icon: opts.icon, coverUrl: opts.coverUrl, parentType: opts.parentType });
    out(``✅ 新建: ${pageId}``);
  }

  const blocks = mdToBlocks(text);

  if (opts.dryRun) {
    out(``\n[Dry Run] ${blocks.length} 个块``);
    return;
  }

  const written = await appendBlocks(pageId, blocks);
  out(``\n✅ 完成！写入 ${written}/${blocks.length} 个块``);
  out(``🔗 https://flowus.cn/${pageId.replace(/-/g, '')}``);
}
"@

$new2 = @"
async function modeWriteText(opts) {
  const text = opts.textContent;
  const title = opts.title || ``笔记-${new Date().toISOString().slice(0, 10)}``;

  out(``\n📝 直接写入文本``);
  out(``📄 标题: ${title}``);

  const parentDbId = opts.parentDbId || DEFAULT_PARENT_DB;
  let pageId;

  if (opts.updateMode) {
    const canSearch = opts.parentType !== 'page';
    if (canSearch) pageId = await findPageByTitle(parentDbId, title);
    if (pageId) {
      out(``🔄 更新已有页面: ${pageId}``);
      await clearPageBlocks(pageId);
    } else {
      out(``⚠️ 未找到 "${title}"，将新建...``);
      pageId = await createPage({ parentDbId, title, icon: opts.icon, coverUrl: opts.coverUrl, parentType: opts.parentType });
      out(``✅ 新建: ${pageId}``);
    }
  } else {
    pageId = await createPage({ parentDbId, title, icon: opts.icon, coverUrl: opts.coverUrl, parentType: opts.parentType });
    out(``✅ 新建: ${pageId}``);
  }

  if (opts.dryRun) {
    out(``\n[Dry Run] [putMarkdown 模式] 将发送 ${text.length} 字符``);
    return;
  }

  // 使用 putMarkdown 混合模式（与文件上传一致，格式保真度最高）
  await rest.sleep(1500);
  await writeViaHybrid(pageId, text);
  out(``\n✅ [混合模式] 完成！已发送 ${text.length} 字符``);
  out(``📄 页面 ID: ${pageId}``);
  out(``🔗 https://flowus.cn/${pageId.replace(/-/g, '')}``);
}
"@

if ($content.Contains($old2)) {
    $content = $content.Replace($old2, $new2)
    Write-Host 'Change 2: OK'
} else {
    Write-Host 'Change 2: NOT FOUND'
}

# Change 3: Fix findPageByTitle to use search API
$old3 = @"
async function findPageByTitle(dbId, title) {
  try {
    const results = await rest.queryDatabase(dbId);

    // 遍历所有记录，从 properties 中提取标题值进行匹配
    for (const r of results) {
      const props = r.properties || {};
      // 尝试多种可能的标题属性名
      const titleProp = props.title || props['标题'] || props.Name || props.name;
      if (!titleProp) continue;

      // 提取文本值
      const val = titleProp[titleProp.type];
      let text = '';
      if (Array.isArray(val)) {
        text = val.map(v => v.plain_text || v.text?.content || '').join('');
      } else if (typeof val === 'string') {
        text = val;
      } else if (val?.name) {
        text = val.name;
      }

      if (text === title) return r.id;
    }

    return null;
  } catch (e) {
    // 父级为普通页面时 queryDatabase 必然失败（HTTP_400），不打印多余日志
    if (!e.message.includes('不是数据库')) {
      log(``查找页面失败: ${e.message.substring(0, 60)}``);
    }
    return null;
  }
}
"@

$new3 = @"
async function findPageByTitle(dbId, title) {
  try {
    // 优先用 search API 精确匹配（高效，无需全量拉取）
    const results = await rest.search(title, { pageSize: 10 });
    for (const r of results) {
      const props = r.properties || {};
      const titleProp = props.title || props['标题'] || props.Name || props.name;
      if (!titleProp) continue;

      const val = titleProp[titleProp.type];
      let text = '';
      if (Array.isArray(val)) {
        text = val.map(v => v.plain_text || v.text?.content || '').join('');
      } else if (typeof val === 'string') {
        text = val;
      } else if (val?.name) {
        text = val.name;
      }

      if (text === title) return r.id;
    }

    return null;
  } catch (e) {
    log(``查找页面失败: ${e.message.substring(0, 60)}``);
    return null;
  }
}
"@

if ($content.Contains($old3)) {
    $content = $content.Replace($old3, $new3)
    Write-Host 'Change 3: OK'
} else {
    Write-Host 'Change 3: NOT FOUND'
}

# Change 4a: Fix CODE_EXTS 'ini' -> '.ini'
$old4a = "'ini'"
$new4a = "'.ini'"
if ($content.Contains($old4a)) {
    $content = $content.Replace($old4a, $new4a)
    Write-Host 'Change 4a: OK'
} else {
    Write-Host 'Change 4a: NOT FOUND'
}

# Change 4b: Remove duplicate 'swift': 'Swift' in LANGUAGE_MAP (line 157)
# The first occurrence at line 151 is correct, the second at line 157 is duplicate
$old4b = "  'objective-c': 'Objective-C', 'swift': 'Swift',"
$new4b = "  'objective-c': 'Objective-C',"
if ($content.Contains($old4b)) {
    $content = $content.Replace($old4b, $new4b)
    Write-Host 'Change 4b: OK'
} else {
    Write-Host 'Change 4b: NOT FOUND'
}

# Write back
[System.IO.File]::WriteAllText($file, $content, $encoding)
Write-Host 'All changes written to file.'
