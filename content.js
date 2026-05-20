// AI Knowledge Tree — Content Script v2
// Uses generic DOM analysis instead of brittle class-name selectors.

const DEBUG = true;
const log = (...args) => DEBUG && console.log('[知识树]', ...args);

let capturedMessageIds = new Set();
let processingTimer = null;
let lastProcessedLength = 0;

function getMessageId(text) {
  let hash = 0;
  for (let i = 0; i < Math.min(text.length, 500); i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return `${hash}|${text.length}`;
}

// ── Find the chat scroll container ──
function findChatContainer() {
  // Strategy: find the largest scrollable element that contains code blocks
  const scrollables = [];
  document.querySelectorAll('*').forEach(el => {
    if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 200) {
      scrollables.push(el);
    }
  });
  // Prefer the one with most <pre>/<code> elements (indicates AI chat)
  scrollables.sort((a, b) => {
    const aCode = a.querySelectorAll('pre, code').length;
    const bCode = b.querySelectorAll('pre, code').length;
    return bCode - aCode;
  });
  return scrollables[0] || document.body;
}

// ── Extract messages by DOM structure ──
function extractMessages() {
  const container = findChatContainer();
  log('容器:', container.tagName, container.className?.substring(0, 50));

  // Strategy 1: Look for all elements containing code blocks (AI messages)
  // and their adjacent siblings (user messages)
  const codeBlocks = container.querySelectorAll('pre, code');
  if (codeBlocks.length === 0) {
    return tryFallbackExtraction(container);
  }

  // Find the common ancestor for each code block that looks like a message
  const messageCandidates = new Set();
  codeBlocks.forEach(code => {
    // Walk up to find the message wrapper
    let el = code.parentElement;
    for (let i = 0; i < 8 && el && el !== container; i++) {
      const textLen = el.textContent.trim().length;
      const childCount = el.children.length;
      // A "message" typically has 50+ chars and multiple children
      if (textLen > 50 && childCount > 1) {
        messageCandidates.add(el);
        break;
      }
      el = el.parentElement;
    }
  });

  if (messageCandidates.size === 0) {
    return tryFallbackExtraction(container);
  }

  // Sort candidates by DOM order
  const ordered = Array.from(messageCandidates)
    .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

  log('找到消息候选:', ordered.length);

  // Classify each message as user or AI
  const messages = [];
  for (const el of ordered) {
    const text = el.textContent.trim();
    if (text.length < 20) continue;

    const id = getMessageId(text);
    if (capturedMessageIds.has(id)) continue;

    // Heuristic: AI messages have code blocks, tables, or are much longer
    const hasCode = el.querySelectorAll('pre, code').length > 0;
    const hasTable = el.querySelectorAll('table').length > 0;
    const textLength = text.length;
    const role = (hasCode || hasTable || textLength > 500) ? 'assistant' : 'user';

    messages.push({ role, content: text, id });
  }

  // Also try to find user messages that don't contain code
  const allParagraphs = container.querySelectorAll('p, div');
  for (const el of allParagraphs) {
    const text = el.textContent.trim();
    if (text.length < 30 || text.length > 2000) continue;
    // Skip if already captured or inside a code block
    if (el.closest('pre, code')) continue;
    // Skip if this element is inside an already-captured message
    const isInside = ordered.some(msg => msg !== el && msg.contains(el));
    if (isInside) continue;

    const id = getMessageId(text);
    if (capturedMessageIds.has(id)) continue;
    if (messages.find(m => m.id === id)) continue;

    // Check if it looks like a user question (ends with ? or ？ or short)
    if (text.match(/[?？]$/) || text.length < 200) {
      messages.push({ role: 'user', content: text, id });
    }
  }

  log('提取消息:', messages.length, messages.map(m => m.role));
  return messages.length > 0 ? messages : null;
}

function tryFallbackExtraction(container) {
  log('使用备用提取方案...');
  // Strategy 2: Look for any elements with substantial text content
  const candidates = [];
  container.querySelectorAll('article, [role="article"], li, .prose, [class*="content"], [class*="message"], [class*="text"]').forEach(el => {
    const text = el.textContent.trim();
    if (text.length > 30) {
      candidates.push({ el, text });
    }
  });

  // If nothing found, try the most generic approach: find all divs with text
  if (candidates.length === 0) {
    const allDivs = container.querySelectorAll('div');
    for (const div of allDivs) {
      // Skip tiny or huge containers
      const text = div.textContent.trim();
      const directText = Array.from(div.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim())
        .join('');
      // A message element typically has both direct text and child elements
      if (text.length > 40 && text.length < 5000 && div.children.length > 1 && directText.length > 0) {
        candidates.push({ el: div, text });
      }
    }
  }

  // Sort by DOM order
  candidates.sort((a, b) =>
    a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  );

  // Deduplicate by removing nested elements
  const messages = [];
  for (let i = 0; i < candidates.length; i++) {
    const { el, text } = candidates[i];
    // Skip if parent is already captured
    const parent = candidates.slice(0, i).find(c => c.el.contains(el));
    if (parent) continue;

    const id = getMessageId(text);
    if (capturedMessageIds.has(id)) continue;

    const hasCode = el.querySelectorAll('pre, code, table').length > 0;
    const role = hasCode || text.length > 400 ? 'assistant' : 'user';
    messages.push({ role, content: text, id });
  }

  log('备用提取结果:', messages.length);
  return messages.length > 0 ? messages : null;
}

// ── Check if AI is still generating ──
function isGenerating() {
  // Check for common stop-button patterns
  const stopSelectors = [
    '[class*="stop"]', '[aria-label*="stop"]', '[aria-label*="停止"]',
    '[class*="pause"]', '[class*="abort"]',
    'button svg path[d*="M6"]', // Square stop icon
    '[data-testid*="stop"]'
  ];
  for (const sel of stopSelectors) {
    const btn = document.querySelector(sel);
    if (btn && btn.offsetParent !== null) {
      log('AI 仍在生成中...');
      return true;
    }
  }
  return false;
}

// ── Main processing ──
function processConversation() {
  if (isGenerating()) {
    processingTimer = setTimeout(processConversation, 2000);
    return;
  }

  const messages = extractMessages();
  if (!messages || messages.length < 2) {
    processingTimer = setTimeout(processConversation, 3000);
    return;
  }

  // Only process if we have new content
  const newMessages = messages.filter(m => !capturedMessageIds.has(m.id));
  if (newMessages.length === 0) {
    processingTimer = setTimeout(processConversation, 5000);
    return;
  }

  log('发送抓取:', newMessages.length, '条新消息');
  newMessages.forEach(m => capturedMessageIds.add(m.id));

  chrome.runtime.sendMessage({
    type: 'CAPTURE_CONVERSATION',
    payload: {
      platform: window.location.hostname,
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      messages,
      newMessages
    }
  }).catch(err => {
    log('发送失败，重试:', err.message);
    newMessages.forEach(m => capturedMessageIds.delete(m.id));
    setTimeout(() => processConversation(), 2000);
  });
}

// ── MutationObserver ──
const observer = new MutationObserver(() => {
  clearTimeout(processingTimer);
  processingTimer = setTimeout(processConversation, 2500);
});

function startObserving() {
  const container = findChatContainer();
  log('开始监听, 容器:', container.tagName, container.className?.substring(0, 40));
  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true
  });
  processingTimer = setTimeout(processConversation, 3000);
}

if (document.readyState === 'complete') {
  startObserving();
} else {
  window.addEventListener('load', startObserving);
}

// ── Manual capture from popup ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'MANUAL_CAPTURE') {
    const messages = extractMessages();
    if (messages && messages.length > 0) {
      messages.forEach(m => capturedMessageIds.add(m.id));
      sendResponse({
        platform: window.location.hostname,
        url: window.location.href,
        title: document.title,
        timestamp: Date.now(),
        messages
      });
    } else {
      sendResponse(null);
    }
  }
  return true;
});
