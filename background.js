// AI Knowledge Tree — Background Service Worker
// Orchestrates capture → classify → extract (structure+dedup) → store

importScripts('deepseek-client.js', 'knowledge-tree.js');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CAPTURE_CONVERSATION') {
    handleCapture(msg.payload).then(result => {
      sendResponse(result);
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (msg.type === 'GET_TREE') {
    getTree().then(md => sendResponse({ md }));
    return true;
  }

  if (msg.type === 'GET_STATUS') {
    getStatus().then(status => sendResponse(status));
    return true;
  }

  if (msg.type === 'EXPORT_TREE') {
    getTree().then(md => sendResponse({ md }));
    return true;
  }

  if (msg.type === 'CLEAR_TREE') {
    chrome.storage.local.remove(STORAGE_KEY).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// ── Core capture pipeline ──

async function handleCapture(payload) {
  const { url, title, messages } = payload;

  const conversation = messages.map(m => ({ role: m.role, content: m.content }));

  // Step 1: Classify
  let classification;
  try {
    classification = await classifyConversation(conversation);
  } catch (err) {
    return { status: 'error', step: 'classify', error: err.message };
  }

  if (!classification.is_learning) {
    return { status: 'skipped', reason: '非学习内容，已跳过' };
  }

  const hierarchy = classification.hierarchy;
  if (!hierarchy || hierarchy.length < 2) {
    return { status: 'skipped', reason: '无法确定知识层级' };
  }

  // Step 2: Extract knowledge (structure + dedup in one API call)
  const aiContent = conversation
    .filter(m => m.role === 'assistant')
    .map(m => m.content)
    .join('\n\n');

  const currentTree = await getTree();
  const section = findSection(currentTree, hierarchy);
  const existingContent = section ? section.content : '(空)';

  let result;
  try {
    result = await extractKnowledge(aiContent, existingContent, url);
  } catch (err) {
    return { status: 'error', step: 'extract', error: err.message };
  }

  if (!result.sections || result.sections.length === 0) {
    return { status: 'skipped', reason: '无新增知识点', hierarchy };
  }

  // Validate: reject if API returned our prompt instructions instead of real knowledge
  const validSections = result.sections.filter(s => {
    const c = s.content || '';
    // Reject prompt-like content
    if (/拆解|提炼出|层级化|结构化方法|知识结构拆解|知识点包含标题|返回JSON/i.test(c)) return false;
    // Reject too-short or placeholder content
    if (c.length < 8) return false;
    // Reject content that looks like it's describing the task
    if (/^(从|将|在|请|你|根据|按照|对).*(提炼|提取|拆解|分解|划分|组织|整理|输出|返回)/i.test(c)) return false;
    return true;
  });

  if (validSections.length === 0) {
    return { status: 'skipped', reason: '提取内容未通过验证（疑似API返回了Prompt指令）', hierarchy };
  }

  // Step 3: Append to tree
  let updatedTree = currentTree;
  updatedTree = appendToTree(updatedTree, hierarchy, validSections, url);

  await saveTree(updatedTree);

  await updateCaptureStatus({
    lastCapture: Date.now(),
    lastPlatform: payload.platform,
    lastTitle: title,
    lastHierarchy: hierarchy.join(' > '),
    newPoints: validSections.length,
    totalConversations: (await getCaptureCount()) + 1
  });

  return {
    status: 'success',
    hierarchy: hierarchy.join(' > '),
    newPoints: validSections.length,
    keywords: classification.keywords || []
  };
}

async function getStatus() {
  const result = await chrome.storage.local.get('capture_status');
  const tree = await getTree();
  return {
    ...(result.capture_status || {}),
    treeSize: tree.length,
    treeLines: tree.split('\n').length
  };
}

async function updateCaptureStatus(status) {
  await chrome.storage.local.set({ capture_status: status });
}

async function getCaptureCount() {
  const result = await chrome.storage.local.get('capture_status');
  return result.capture_status?.totalConversations || 0;
}

// Initialize tree on install
chrome.runtime.onInstalled.addListener(async () => {
  await initTree();
  console.log('🌳 AI 知识树扩展已安装');
});
