// AI Knowledge Tree — Content Script
// Injected into AI chat pages to extract conversation content.

const PLATFORMS = {
  'chat.deepseek.com': {
    name: 'DeepSeek',
    selectors: {
      userMessages: '[class*="question"] [class*="markdown"], .ds-markdown',
      aiMessages: '[class*="answer"] [class*="markdown"], .ds-markdown',
      chatContainer: '[class*="chat"]',
      stopButton: '[class*="stop"]',
      inputBox: 'textarea, [contenteditable="true"]'
    }
  },
  'kimi.moonshot.cn': {
    name: 'Kimi',
    selectors: {
      userMessages: '[class*="question"]',
      aiMessages: '[class*="answer"], .markdown',
      chatContainer: '[class*="chat"]',
      stopButton: '[class*="stop"]',
      inputBox: 'textarea, [contenteditable="true"]'
    }
  },
  'chat.openai.com': {
    name: 'ChatGPT',
    selectors: {
      userMessages: '[data-message-author-role="user"]',
      aiMessages: '[data-message-author-role="assistant"]',
      chatContainer: '[class*="react-scroll-to-bottom"]',
      stopButton: '[data-testid="stop-button"]',
      inputBox: '#prompt-textarea'
    }
  },
  'claude.ai': {
    name: 'Claude',
    selectors: {
      userMessages: '[class*="user"] [class*="content"]',
      aiMessages: '.chat-message-content',
      chatContainer: '[class*="chat"]',
      stopButton: '[class*="stop"]',
      inputBox: '[contenteditable="true"]'
    }
  },
  'yuanbao.tencent.com': {
    name: '元宝',
    selectors: {
      userMessages: '[class*="question"]',
      aiMessages: '[class*="answer"], .hyc-content-markdown',
      chatContainer: '[class*="chat"]',
      stopButton: '[class*="stop"]',
      inputBox: 'textarea, [contenteditable="true"]'
    }
  },
  'tongyi.aliyun.com': {
    name: '通义千问',
    selectors: {
      userMessages: '[class*="user"]',
      aiMessages: '[class*="assistant"], [class*="bot"]',
      chatContainer: '[class*="chat"]',
      stopButton: '[class*="stop"]',
      inputBox: 'textarea, [contenteditable="true"]'
    }
  },
  'yiyan.baidu.com': {
    name: '文心一言',
    selectors: {
      userMessages: '[class*="user"]',
      aiMessages: '[class*="assistant"], [class*="bot"]',
      chatContainer: '[class*="chat"]',
      stopButton: '[class*="stop"]',
      inputBox: 'textarea, [contenteditable="true"]'
    }
  }
};

const hostname = window.location.hostname;
const platform = PLATFORMS[hostname] || {
  name: hostname,
  selectors: {
    userMessages: '[class*="user"], [class*="question"], [class*="human"]',
    aiMessages: '[class*="assistant"], [class*="answer"], [class*="bot"], [class*="markdown"]',
    chatContainer: '[class*="chat"], [class*="conversation"], main',
    stopButton: '[class*="stop"], [aria-label*="停止"], [aria-label*="stop"]',
    inputBox: 'textarea, [contenteditable="true"]'
  }
};

let capturedMessageIds = new Set();
let processingTimer = null;

function getMessageId(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `${window.location.href}|${hash}|${text.length}`;
}

function extractMessages() {
  const sel = platform.selectors;

  // Try to find all message elements
  const allElems = document.querySelectorAll(
    `${sel.userMessages}, ${sel.aiMessages}`
  );

  if (allElems.length === 0) {
    // Fallback: try to find any message-like containers
    const fallback = document.querySelectorAll(
      '[class*="message"], [class*="turn"], [class*="dialogue"]'
    );
    if (fallback.length === 0) return null;
  }

  // Group into user/AI pairs
  const userElems = document.querySelectorAll(sel.userMessages);
  const aiElems = document.querySelectorAll(sel.aiMessages);

  const messages = [];
  const seenTexts = new Set();

  for (let i = 0; i < Math.max(userElems.length, aiElems.length); i++) {
    if (userElems[i]) {
      const text = userElems[i].textContent.trim();
      const id = getMessageId(text);
      if (!seenTexts.has(text) && text.length > 10) {
        seenTexts.add(text);
        messages.push({ role: 'user', content: text, id });
      }
    }
    if (aiElems[i]) {
      const text = aiElems[i].textContent.trim();
      const id = getMessageId(text);
      if (!seenTexts.has(text) && text.length > 10) {
        seenTexts.add(text);
        messages.push({ role: 'assistant', content: text, id });
      }
    }
  }

  return messages;
}

function isConversationComplete() {
  const sel = platform.selectors;
  // Check if input is enabled (means AI stopped generating)
  const input = document.querySelector(sel.inputBox);
  const stopBtn = document.querySelector(sel.stopButton);
  // Complete when no stop button visible and input is editable
  const inputReady = input && !input.disabled && !input.readOnly;
  const stopped = !stopBtn || stopBtn.offsetParent === null;
  return inputReady && stopped;
}

function processConversation() {
  if (!isConversationComplete()) {
    // Not done yet, check again later
    processingTimer = setTimeout(processConversation, 2000);
    return;
  }

  const messages = extractMessages();
  if (!messages || messages.length < 2) {
    processingTimer = setTimeout(processConversation, 3000);
    return;
  }

  // Check if we have new messages
  const newMessages = messages.filter(m => !capturedMessageIds.has(m.id));
  if (newMessages.length === 0) {
    processingTimer = setTimeout(processConversation, 5000);
    return;
  }

  // Mark as captured
  newMessages.forEach(m => capturedMessageIds.add(m.id));

  // Send to background
  chrome.runtime.sendMessage({
    type: 'CAPTURE_CONVERSATION',
    payload: {
      platform: platform.name,
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      messages: messages,
      newMessages: newMessages
    }
  }).catch(() => {
    // Background might not be ready, retry
    setTimeout(() => processConversation(), 2000);
  });
}

// Observe DOM changes
const observer = new MutationObserver(() => {
  // Debounce: wait for DOM to settle
  clearTimeout(processingTimer);
  processingTimer = setTimeout(processConversation, 3000);
});

function startObserving() {
  const sel = platform.selectors;
  const container = document.querySelector(sel.chatContainer) || document.body;
  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true
  });
  // Initial check
  processingTimer = setTimeout(processConversation, 3000);
}

// Start after page load
if (document.readyState === 'complete') {
  startObserving();
} else {
  window.addEventListener('load', startObserving);
}

// Listen for manual capture request from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'MANUAL_CAPTURE') {
    const messages = extractMessages();
    if (messages && messages.length > 0) {
      messages.forEach(m => capturedMessageIds.add(m.id));
      sendResponse({
        platform: platform.name,
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
