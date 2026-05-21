// AI Knowledge Tree — Content Script v3
console.log('[知识树] ✅ content script 已注入，当前页面:', window.location.href);

const DEBUG = true;
const log = (...args) => DEBUG && console.log('[知识树]', ...args);

let capturedIds = new Set();
let processingTimer = null;

// ── Find message elements ──
// Strategy: find all large-ish text blocks, sort by DOM position,
// then classify by alternation pattern

function findAllMessages() {
  const results = [];

  // Walk all divs in the document
  const allDivs = document.querySelectorAll('div');
  const seen = new Set();

  for (const div of allDivs) {
    if (seen.has(div)) continue;

    const text = div.textContent.trim();
    // Skip tiny elements, navigation, etc.
    if (text.length < 30) continue;
    // Skip giant containers (probably the whole chat)
    if (text.length > 15000) continue;

    // Look for elements that are likely message bubbles:
    // - Have some direct text content (not just child text)
    // - Or contain markdown elements (code, lists, tables)
    const hasMarkdown = div.querySelector('pre, code, table, ul, ol, h1, h2, h3, h4');
    const childTextLength = Array.from(div.children)
      .reduce((sum, c) => sum + c.textContent.length, 0);
    const directText = text.length - childTextLength;

    // A "message" has either markdown content OR reasonable direct text
    if (hasMarkdown || (directText > 5 && div.children.length >= 1)) {
      results.push({ el: div, text, hasMarkdown: !!hasMarkdown });
      // Mark all descendants as seen to avoid double-counting
      div.querySelectorAll('div').forEach(d => seen.add(d));
    }
  }

  // Sort by DOM position (top to bottom)
  results.sort((a, b) =>
    a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  );

  log(`找到 ${results.length} 个消息候选元素`);
  return results;
}

// ── Extract and classify messages ──

function extractMessages() {
  const candidates = findAllMessages();
  if (candidates.length === 0) return null;

  const messages = [];

  for (let i = 0; i < candidates.length; i++) {
    const { el, text, hasMarkdown } = candidates[i];

    // Classification heuristic for AI messages:
    // - Contains code/markdown → AI
    // - Very long (>400 chars) → likely AI
    // - Alternating pattern: after each user message, the next is usually AI
    const prevIsUser = messages.length > 0 && messages[messages.length - 1].role === 'user';
    const looksLikeAI = hasMarkdown || text.length > 400;
    const looksLikeUser = text.match(/[?？]$/) || text.length < 150;

    let role;
    if (looksLikeAI && !looksLikeUser) {
      role = 'assistant';
    } else if (looksLikeUser && !looksLikeAI) {
      role = 'user';
    } else if (prevIsUser) {
      role = 'assistant'; // alternating: after user comes AI
    } else {
      role = 'assistant'; // default to assistant for long text
    }

    const id = `${text.length}_${text.slice(0, 50).replace(/\s/g, '')}`;
    if (capturedIds.has(id)) continue;

    messages.push({ role, content: text, id });
  }

  log(`提取 ${messages.length} 条消息:`, messages.map(m => `${m.role}(${m.content.length}字)`));
  return messages.length > 0 ? messages : null;
}

// ── Check if AI is generating ──

function isGenerating() {
  // Generic stop-button detection
  const allBtns = document.querySelectorAll('button, [role="button"]');
  for (const btn of allBtns) {
    if (btn.offsetParent === null) continue;
    const label = (btn.textContent + ' ' + btn.getAttribute('aria-label') || '').toLowerCase();
    if (/stop|停止|pause|暂停|abort/.test(label)) {
      log('AI 仍在生成...');
      return true;
    }
  }
  return false;
}

// ── Main processing loop ──

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

  const newOnes = messages.filter(m => !capturedIds.has(m.id));
  if (newOnes.length === 0) {
    processingTimer = setTimeout(processConversation, 5000);
    return;
  }

  log(`发送 ${newOnes.length} 条新消息到后台`);
  newOnes.forEach(m => capturedIds.add(m.id));

  chrome.runtime.sendMessage({
    type: 'CAPTURE_CONVERSATION',
    payload: {
      platform: window.location.hostname,
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      messages,
      newMessages: newOnes
    }
  }).catch(err => {
    log('发送失败:', err.message);
    newOnes.forEach(m => capturedIds.delete(m.id));
  });
}

// ── Observer ──

const observer = new MutationObserver(() => {
  clearTimeout(processingTimer);
  processingTimer = setTimeout(processConversation, 2500);
});

function start() {
  const chat = document.querySelector('main, [role="main"], #app') || document.body;
  observer.observe(chat, { childList: true, subtree: true, characterData: true });
  log('开始监听:', chat.tagName, chat.className?.slice(0, 30) || '');
  processingTimer = setTimeout(processConversation, 2000);
}

document.readyState === 'complete' ? start() : window.addEventListener('load', start);

// ── Manual capture ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'MANUAL_CAPTURE') {
    try {
      const messages = extractMessages();
      if (messages && messages.length > 0) {
        messages.forEach(m => capturedIds.add(m.id));
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
    } catch (err) {
      sendResponse({ error: err.message });
    }
    return true;
  }
});
