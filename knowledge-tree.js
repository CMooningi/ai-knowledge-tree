// Knowledge Tree Manager
// Manages the single growing knowledge-tree.md file

const STORAGE_KEY = 'knowledge_tree_md';
const TREE_HEADER = '# 🧠 AI 知识树\n\n> 自动生成于 ' + new Date().toISOString().split('T')[0] + '\n> 新知识自动归类追加，重复内容自动过滤\n\n';

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

/**
 * Build a markdown heading line at a given level
 * level: 1 = #, 2 = ##, 3 = ###, 4 = ####, 5 = #####
 */
function mdHeading(text, level) {
  const hashes = '#'.repeat(Math.min(level, 5));
  return `${hashes} ${text}`;
}

/**
 * Extract the section content under a specific hierarchy path from the MD tree.
 * Returns { startIndex, endIndex, content } or null if not found.
 */
function findSection(md, hierarchy) {
  const lines = md.split('\n');
  let sectionStart = -1;
  let sectionEnd = lines.length;
  let foundDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,5})\s+(.+)/);
    if (!match) continue;

    const depth = match[1].length;
    const title = match[2].trim();

    // Check if this heading matches any level of our hierarchy
    for (let h = 0; h < hierarchy.length; h++) {
      if (depth === h + 2 && title === hierarchy[h]) { // level 1 = ##, level 2 = ###, etc.
        if (h === hierarchy.length - 1) {
          // This is our target section
          sectionStart = i;
          foundDepth = depth;

          // Find the end: next heading of same or higher level
          for (let j = i + 1; j < lines.length; j++) {
            const nextMatch = lines[j].match(/^(#{1,5})\s+/);
            if (nextMatch && nextMatch[1].length <= foundDepth) {
              sectionEnd = j;
              break;
            }
          }
          return {
            startIndex: sectionStart,
            endIndex: sectionEnd,
            headingLine: i,
            content: lines.slice(sectionStart, sectionEnd).join('\n')
          };
        }
        // Continue searching within this section for the next level
        break;
      }
    }
  }

  return null;
}

/**
 * Ensure all hierarchy levels exist in the MD tree.
 * Creates missing sections and returns the insert position for leaf content.
 */
function ensureHierarchy(md, hierarchy) {
  let result = md;
  let lastInsertIndex = -1;

  for (let i = 0; i < hierarchy.length; i++) {
    const headingLevel = i + 2; // ##, ###, ####, #####
    const headingLine = mdHeading(hierarchy[i], headingLevel);

    // Check if this heading already exists at the right position
    const existing = findSection(result, hierarchy.slice(0, i + 1));
    if (existing) {
      lastInsertIndex = existing.headingLine;
      continue;
    }

    // Need to create this section
    // Find where to insert: after the parent section's heading, before the next same-level heading
    const lines = result.split('\n');
    let insertAt = lines.length;

    if (i === 0) {
      // Top level: find the right alphabetical position among other ## headings
      insertAt = findInsertPosition(lines, headingLine, 2);
    } else {
      // Insert after parent heading
      const parentSection = findSection(result, hierarchy.slice(0, i));
      if (parentSection) {
        // Find the end of parent's direct content, before any existing sub-sections
        insertAt = parentSection.headingLine + 1;
      }
    }

    lines.splice(insertAt, 0, '', headingLine);
    result = lines.join('\n');
    lastInsertIndex = insertAt + 1; // +1 for the blank line we added
  }

  return { md: result, insertAfterLine: lastInsertIndex };
}

function findInsertPosition(lines, newHeading, level) {
  const newHash = '#'.repeat(level);
  let insertAt = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,5})\s+/);
    if (match && match[1].length === level) {
      const existingTitle = lines[i].replace(/^#{1,5}\s+/, '').trim();
      const newTitle = newHeading.replace(/^#{1,5}\s+/, '').trim();
      if (existingTitle.localeCompare(newTitle, 'zh-CN') > 0) {
        insertAt = i;
        break;
      }
    }
  }
  return insertAt;
}

/**
 * Append knowledge points (leaf nodes) under a specific section.
 */
function appendKnowledgePoints(md, hierarchy, sections) {
  let currentMd = md;

  // First ensure the hierarchy path exists
  const ensured = ensureHierarchy(currentMd, hierarchy);
  currentMd = ensured.md;

  // Find the target section
  const section = findSection(currentMd, hierarchy);
  if (!section) return currentMd;

  const lines = currentMd.split('\n');
  const headingLevel = hierarchy.length + 1; // Next level after the last hierarchy
  const hashes = '#'.repeat(Math.min(headingLevel, 5));

  // Build the content to insert
  const newLines = [];
  for (const s of sections) {
    if (s.heading) {
      newLines.push(`${hashes} ${s.heading}`);
    }
    if (s.content) {
      newLines.push(s.content);
    }
    newLines.push('');
  }

  // Find insertion point: end of the section
  const sectionEnd = section.headingLine + 1;
  // Skip existing content after heading to find where to append
  let insertAt = sectionEnd;
  for (let j = sectionEnd; j < lines.length; j++) {
    const nextMatch = lines[j].match(/^(#{1,5})\s+/);
    if (nextMatch && nextMatch[1].length <= hierarchy.length + 1) {
      insertAt = j;
      break;
    }
    insertAt = j + 1;
  }

  lines.splice(insertAt, 0, ...newLines);
  return lines.join('\n');
}

/**
 * Add source links as leaf nodes
 */
function addSourceLinks(md, hierarchy, links) {
  let currentMd = md;
  const ensured = ensureHierarchy(currentMd, hierarchy);
  currentMd = ensured.md;

  const section = findSection(currentMd, hierarchy);
  if (!section) return currentMd;

  const lines = currentMd.split('\n');
  const newLines = links.map(link => `- [查看原文](${link})`);

  let insertAt = section.endIndex;
  lines.splice(insertAt, 0, ...newLines, '');
  return lines.join('\n');
}

// Functions are available globally for importScripts in service worker context
