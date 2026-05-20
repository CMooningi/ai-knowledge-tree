// AI Knowledge Tree — Background Service Worker
// Orchestrates capture → classify → structure → dedup → store

importScripts('deepseek-client.js', 'knowledge-tree.js');

const PROCESSING_LOCK = new Set(); // Prevent concurrent processing of same conversation

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CAPTURE_CONVERSATION') {
    handleCapture(msg.payload).then(result => {
      sendResponse(result);
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // Keep channel open for async response
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

async function handleCapture(payload) {
  const { url, title, messages, newMessages } = payload;

  // Build conversation context
  const conversation = messages.map(m => ({
    role: m.role,
    content: m.content
  }));

  // Step 1: Classify — is this learning content?
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

  // Step 2: Structure — break AI response into knowledge points
  const aiMessages = conversation.filter(m => m.role === 'assistant');
  const aiContent = aiMessages.map(m => m.content).join('\n\n');

  let structured;
  try {
    structured = await structureContent(aiContent);
  } catch (err) {
    return { status: 'error', step: 'structure', error: err.message };
  }

  if (!structured.sections || structured.sections.length === 0) {
    return { status: 'skipped', reason: '未能提取到结构化知识点' };
  }

  // Step 3: Dedup — compare with existing content in the matching section
  const currentTree = await getTree();
  const section = findSection(currentTree, hierarchy);
  const existingContent = section ? section.content : '(空章节)';

  let dedupResult;
  try {
    dedupResult = await dedupContent(existingContent, structured.sections);
  } catch (err) {
    // If dedup fails, treat all as new (fail open for knowledge capture)
    dedupResult = { is_duplicate: false, new_sections: structured.sections };
  }

  if (dedupResult.is_duplicate) {
    return {
      status: 'skipped',
      reason: `已存在相同知识: ${dedupResult.reason || '无新内容'}`,
      hierarchy
    };
  }

  if (!dedupResult.new_sections || dedupResult.new_sections.length === 0) {
    return { status: 'skipped', reason: '无新增知识点', hierarchy };
  }

  // Step 4: Append new knowledge to tree
  let updatedTree = currentTree;
  updatedTree = appendKnowledgePoints(updatedTree, hierarchy, dedupResult.new_sections);
  updatedTree = addSourceLinks(updatedTree, hierarchy, [url]);

  await saveTree(updatedTree);

  // Update status
  await updateCaptureStatus({
    lastCapture: Date.now(),
    lastPlatform: payload.platform,
    lastTitle: title,
    lastHierarchy: hierarchy.join(' > '),
    newPoints: dedupResult.new_sections.length,
    totalConversations: (await getCaptureCount()) + 1
  });

  return {
    status: 'success',
    hierarchy: hierarchy.join(' > '),
    newPoints: dedupResult.new_sections.length,
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
