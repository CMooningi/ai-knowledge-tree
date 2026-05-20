// Knowledge Tree Manager
// Manages the single growing knowledge-tree.md file

const STORAGE_KEY = 'knowledge_tree_md';
const TREE_HEADER = '# 🧠 AI 知识树\n\n> 新知识自动归类，重复过滤\n\n';

async function initTree() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (!result[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: TREE_HEADER });
    return TREE_HEADER;
  }
  return result[STORAGE_KEY];
}

async function getTree() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || TREE_HEADER;
}

async function saveTree(md) {
  await chrome.storage.local.set({ [STORAGE_KEY]: md });
}

function mdHeading(text, level) {
  return '#'.repeat(Math.min(level, 5)) + ' ' + text;
}

// ── Find a section by hierarchy path ──

function findSection(md, hierarchy) {
  const lines = md.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{2,5})\s+(.+)/);
    if (!match) continue;

    const depth = match[1].length;
    const title = match[2].trim();

    if (depth === hierarchy.length + 1 && title === hierarchy[hierarchy.length - 1]) {
      // Found the target section heading
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        const m2 = lines[j].match(/^(#{2,5})\s+/);
        if (m2 && m2[1].length <= depth) { end = j; break; }
      }
      return {
        headingLine: i,
        headingDepth: depth,
        endIndex: end,
        content: lines.slice(i, end).join('\n')
      };
    }
  }
  return null;
}

// ── Ensure hierarchy path exists, return insert position ──

function ensureHierarchy(md, hierarchy) {
  let lines = md.split('\n');

  for (let i = 0; i < hierarchy.length; i++) {
    const level = i + 2; // ##, ###, ####, #####
    const headingLine = mdHeading(hierarchy[i], level);

    // Check if heading already exists at correct level
    let found = false;
    for (let j = 0; j < lines.length; j++) {
      const m = lines[j].match(/^(#{2,5})\s+(.+)/);
      if (m && m[1].length === level && m[2].trim() === hierarchy[i]) {
        found = true;
        break;
      }
    }

    if (!found) {
      // Insert heading — find the right place under parent
      let insertAt = lines.length;
      if (i === 0) {
        // Top level: insert alphabetically among ## headings
        for (let j = 0; j < lines.length; j++) {
          const m = lines[j].match(/^(#{2,5})\s+(.+)/);
          if (m && m[1].length === 2 && m[2].trim().localeCompare(hierarchy[i], 'zh-CN') > 0) {
            insertAt = j;
            break;
          }
        }
      } else {
        // Find parent heading, insert after it
        for (let j = 0; j < lines.length; j++) {
          const m = lines[j].match(/^(#{2,5})\s+(.+)/);
          if (m && m[1].length === level - 1 && m[2].trim() === hierarchy[i - 1]) {
            insertAt = j + 1;
            break;
          }
        }
      }
      lines.splice(insertAt, 0, '', headingLine);
    }
  }

  return lines.join('\n');
}

// ── Append knowledge points with links ──

function appendToTree(md, hierarchy, sections, sourceUrl) {
  let currentMd = ensureHierarchy(md, hierarchy);
  const section = findSection(currentMd, hierarchy);
  const lines = currentMd.split('\n');

  // Build the content to insert: each section gets a heading, then bullet points
  const newLines = [];
  const leafLevel = Math.min(hierarchy.length + 2, 5); // One level deeper than hierarchy[-1]

  for (const s of sections) {
    if (!s.content) continue;

    // Sub-heading for the knowledge point
    if (s.heading) {
      newLines.push('');  // blank line before heading
      newLines.push(mdHeading(s.heading, leafLevel));
    }

    // Knowledge point as bullet with source link
    const cleanContent = s.content
      .replace(/^["「]/g, '').replace(/["」]$/g, '')  // strip quotes
      .replace(/\n+/g, ' ');  // single line
    newLines.push(`- ${cleanContent} → [原文](${sourceUrl})`);
  }

  if (newLines.length === 0) return currentMd;

  // Insert at end of section
  let insertAt = section ? section.endIndex : lines.length;
  lines.splice(insertAt, 0, ...newLines);
  return lines.join('\n');
}
