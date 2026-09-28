// Extract message bodies instead of arbitrary ancestor containers.
(() => {
  let timer, sampleTimer, observer;
  let inFlight = false, stopped = false;
  let lastActivity = Date.now(), lastSignature = '', wasGenerating = false;
  let cacheQueue = Promise.resolve();
  function stop() {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(sampleTimer);
    observer?.disconnect();
  }
  function contextAvailable() {
    try { return !stopped && Boolean(chrome.runtime?.id); }
    catch { return false; }
  }
  const ROLE_SELECTOR = '[data-message-author-role], [data-role="user"], [data-role="assistant"]';
  const BODY_SELECTORS = [
    ['.chat-item-user .chat-item-content', 'user'],
    ['.chat-item-assistant .markdown', 'assistant'],
    ['[data-testid="user-message"]', 'user'],
    ['[data-testid="assistant-message"]', 'assistant'],
    ['.font-user-message', 'user'],
    ['.ds-markdown', 'assistant'],
    ['.markdown', 'assistant'],
    ['.markdown-body', 'assistant'],
    ['.prose', 'assistant']
  ];

  function extractMessages() {
    const candidates = [];
    for (const el of document.querySelectorAll(ROLE_SELECTOR)) {
      const role = el.getAttribute('data-message-author-role') || el.getAttribute('data-role');
      if (role === 'user' || role === 'assistant') candidates.push({ el, role });
    }
    for (const [selector, role] of BODY_SELECTORS) {
      for (const el of document.querySelectorAll(selector)) {
        if (el.closest('nav, aside, header, footer, [contenteditable="true"]')) continue;
        if (candidates.some(c => c.el === el || c.el.contains(el) || el.contains(c.el))) continue;
        candidates.push({ el, role });
      }
    }
    return candidates
      .filter(c => !candidates.some(other => other !== c && c.el.contains(other.el)))
      .sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
      .map(({ el, role }, index) => {
        const content = (el.innerText || el.textContent || '').trim();
        const headings = role === 'assistant' ? Array.from(el.querySelectorAll('h1,h2,h3,h4,h5,h6'))
          .filter(h => !h.closest('pre,code')).map(h => (h.innerText || h.textContent || '').trim()).filter(Boolean) : [];
        return { role, content, headings, id: JSON.stringify([location.href, index, role, content]) };
      })
      .filter(m => m.content);
  }

  function isGenerating() {
    return Array.from(document.querySelectorAll('button, [role="button"]')).some(btn => {
      if (btn.getClientRects().length === 0) return false;
      const label = [btn.textContent, btn.getAttribute('aria-label'), btn.getAttribute('data-testid')].filter(Boolean).join(' ');
      return /stop.?generat|stop.?response|stop-button|停止生成|停止回答|停止输出|^\s*(stop|停止)\s*$/i.test(label);
    });
  }

  async function capture(manual = false) {
    if (!contextAvailable()) {
      stop();
      return { status: 'error', error: '扩展已重新加载，请刷新当前 AI 聊天页面后重试' };
    }
    if (inFlight) return { status: 'skipped', reason: '正在处理对话，请稍候' };
    if (isGenerating()) return { status: 'skipped', reason: 'AI 正在回答，请等回答完成后再抓取' };
    inFlight = true;
    try {
      const messages = extractMessages();
      if (!messages.some(m => m.role === 'assistant')) {
        return { status: 'skipped', reason: '未找到对话正文，该页面可能需要适配' };
      }
      // New answers trigger processing, but summarization needs all visible turns
      // to resolve corrections and incorporate the user's intermediate conclusions.
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_CONVERSATION',
        payload: {
          platform: location.hostname, url: location.href, title: document.title,
          timestamp: Date.now(), messages
        }
      });
      if (!response || response.error || response.status === 'error') {
        throw new Error(response?.error || '后台未返回处理结果，请检查扩展错误并重新加载');
      }
      return response;
    } catch (err) {
      if (!contextAvailable() || /Extension context invalidated/i.test(err.message)) {
        stop();
        return { status: 'error', error: '扩展已重新加载，请刷新当前 AI 聊天页面后重试' };
      }
      console.warn('[知识树] 抓取失败:', err.message);
      return { status: 'error', error: err.message };
    } finally {
      inFlight = false;
    }
  }

  // Persist while the page is alive; unload is only a best-effort final flush.
  // Serial sends preserve the order of snapshots without waiting for any LLM.
  function persist(payload, activityAt) {
    cacheQueue=cacheQueue.catch(()=>{}).then(async()=>{
      if(!contextAvailable()){stop();return;}
      try {
        const result=await chrome.runtime.sendMessage({type:'CACHE_CONVERSATION',payload,activityAt});
        if(result?.error)throw Error(result.error);
      } catch(error) {
        if(!contextAvailable() || /Extension context invalidated/i.test(error.message)){stop();return;}
        lastSignature=''; // Retry the snapshot on the next sample.
        console.warn('[知识树] 本地缓存失败:',error.message);
      }
    });
  }
  function sampleActivity(force=false){
    if(!contextAvailable()){stop();return;}
    const messages=extractMessages(),generating=isGenerating();
    const signature=location.href+'\n'+JSON.stringify(messages.map(m=>[m.role,m.content]));
    const changed=signature!==lastSignature, finished=wasGenerating&&!generating;
    if(changed||generating||wasGenerating)lastActivity=Date.now();
    if(changed||finished||force){
      let complete=messages;
      // Never treat a currently streaming answer (or its unanswered question)
      // as a complete turn. Earlier completed turns can still be summarized.
      if(generating && complete.at(-1)?.role==='assistant'){
        const index=complete.findLastIndex(m=>m.role==='assistant');
        complete=index>=0?complete.slice(0,index):[];
      }
      const end=complete.findLastIndex(m=>m.role==='assistant');
      complete=complete.slice(0,end+1);
      if(complete.length)persist({platform:location.hostname,url:location.href,title:document.title,messages:complete},lastActivity);
      else persist({url:location.href},lastActivity);
    }else if(generating)persist({url:location.href},lastActivity);
    lastSignature=signature;wasGenerating=generating;
  }
  function onComposerActivity(event){
    if(!event.isTrusted||!contextAvailable())return;
    const target=event.target;
    if(target?.closest?.('nav,aside,header,footer'))return;
    if(event.type==='submit'||target?.closest?.('textarea,[contenteditable="true"],[role="textbox"],input[type="text"],input:not([type])')){
      lastActivity=Date.now();
      persist({url:location.href},lastActivity);
    }
  }
  document.addEventListener('input',onComposerActivity,true);
  document.addEventListener('keydown',onComposerActivity,true);
  document.addEventListener('submit',onComposerActivity,true);
  window.addEventListener('pagehide',()=>sampleActivity());
  function schedule(delay = 10000) {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(() => {sampleActivity();schedule();}, delay);
  }
  function start() {
    sampleActivity();
    observer = new MutationObserver(() => {
      if(sampleTimer||stopped)return;
      sampleTimer=setTimeout(()=>{sampleTimer=null;sampleActivity();},750);
    });
    observer.observe(document.body, {childList:true,subtree:true,characterData:true});
    schedule();
  }
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local'&&(changes.intake_tags||changes.jev_api_key||changes.jev_verified||changes.auto_capture)&&contextAvailable())sampleActivity(true);
  });
  if (document.body) start();
  else window.addEventListener('DOMContentLoaded', start, { once: true });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'MANUAL_CAPTURE') return;
    capture(true).then(sendResponse);
    return true;
  });
})();
