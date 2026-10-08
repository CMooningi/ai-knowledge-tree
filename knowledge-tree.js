const STORAGE_KEY = 'knowledge_tree_md';
const TREE_HEADER = '# 🧠 AI 知识树\n\n> 新知识自动归类，重复过滤\n\n';
async function initTree() {
  const result=await chrome.storage.local.get(STORAGE_KEY);
  if (!result[STORAGE_KEY]) await chrome.storage.local.set({[STORAGE_KEY]:TREE_HEADER});
  return result[STORAGE_KEY] || TREE_HEADER;
}
async function getTree() {
  const result=await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || TREE_HEADER;
}
async function commitLearning(before, result, status, checkpoint = {}) {
  if ((await getTree()) !== before) throw new Error('知识树在处理期间发生变化，本次未覆盖，请重试');
  const update = {...checkpoint,[STORAGE_KEY]:result.md,capture_status:status};
  if (result.moved || result.updated || result.reordered) update.knowledge_tree_before_reorganization = {md:before,createdAt:Date.now(),reason:result.summary};
  await chrome.storage.local.set(update);
}
