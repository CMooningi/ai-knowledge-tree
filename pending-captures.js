// Raw conversations stay local until the idle deadline. This short queue never
// waits for a model request, so closing a tab during another capture is safe.
const PendingCaptures = (() => {
  const key = 'knowledge_pending_captures_v1', alarm = 'knowledge-capture-idle';
  const idleMs = 5 * 60 * 1000, active = new Set();
  let queue = Promise.resolve(), runCapture;
  function serial(task) {
    const job = queue.then(task); queue = job.catch(() => {}); return job;
  }
  const read = async () => (await chrome.storage.local.get(key))[key] || {};
  async function sourceKey(url) {
    const source = new URL(url); source.hash = ''; return CaptureState.hash(source.href);
  }
  function clean(payload) {
    if (!payload || !Array.isArray(payload.messages)) throw Error('未检测到有效对话缓存');
    const messages = payload.messages.filter(m => ['user','assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim())
      .map(m => ({role:m.role, content:m.content.replace(/\r\n/g,'\n').trim(), headings:Array.isArray(m.headings)?m.headings.filter(h=>typeof h==='string').slice(0,24).map(h=>h.slice(0,300)):[]}));
    return {url:payload.url, platform:String(payload.platform||''), title:String(payload.title||'').slice(0,300), messages};
  }
  const fingerprint = payload => CaptureState.hash(JSON.stringify(payload.messages.map(m=>[m.role,m.content])));
  // Preserve cached turns when the website virtualizes earlier messages. Only
  // merge an unambiguous shared prefix; a changed answer replaces its suffix.
  function merge(previous, incoming) {
    if (!previous?.length || !incoming.length) return incoming;
    const same = (a,b) => a.role===b.role && a.content===b.content;
    const offsets = previous.flatMap((m,i)=>same(m,incoming[0])?[i]:[]);
    const matches=offsets.map(offset=>{
      let shared=0;
      while(shared<incoming.length && previous[offset+shared] && same(previous[offset+shared],incoming[shared]))shared++;
      return {offset,shared};
    }).sort((a,b)=>b.shared-a.shared);
    if(matches[0]?.shared===incoming.length)return previous;
    if(!matches.length || (matches.length>1 && matches[0].shared===matches[1].shared))return [...previous,...incoming];
    const {offset}=matches[0];
    return [...previous.slice(0,offset),...incoming];
  }
  async function schedule(records = null) {
    records ||= await read();
    const settings = await chrome.storage.local.get('auto_capture');
    const entries = Object.entries(records);
    if(settings.auto_capture===false || !entries.length) { await chrome.alarms.clear(alarm); return; }
    const next = Math.min(...entries.map(([id,r])=>active.has(id)?Date.now()+60000:Math.max(r.lastActivity+idleMs,r.retryAt||0)));
    await chrome.alarms.create(alarm,{when:Math.max(Date.now()+1000,next)});
  }
  async function cache(payload, activityAt) {
    return serial(async()=>{
      const settings=await chrome.storage.local.get(['auto_capture','intake_tags',...ModelConfig.jevKeys]);
      if(settings.auto_capture===false)return {status:'skipped'};
      const id=await sourceKey(payload.url), records=await read(), old=records[id];
      const now=Date.now(), at=Math.min(now,Number(activityAt)||now);
      if(!Array.isArray(payload.messages)) {
        if(old) { old.lastActivity=Math.max(old.lastActivity,at); old.revision=crypto.randomUUID(); old.retryAt=0; await chrome.storage.local.set({[key]:records}); }
        await schedule(records); return {status:'cached'};
      }
      const value=clean(payload);
      value.messages=merge(old?.payload.messages,value.messages);
      if(!value.messages.some(m=>m.role==='assistant'&&m.content.length>=20))return {status:'skipped'};
      const scope=await intakeScope(settings);
      if((await CaptureState.prepare(value.url,value.messages,scope)).unchanged) {
        if(old) {delete records[id];await chrome.storage.local.set({[key]:records});}
        await schedule(records); return {status:'skipped'};
      }
      const signature=await fingerprint(value);
      // Activity received from the page advances the persisted idle deadline.
      const lastActivity=old && signature===old.signature ? Math.max(old.lastActivity,at) : at;
      records[id]={payload:value,signature,lastActivity,revision:crypto.randomUUID(),retryAt:0,attempts:0,error:''};
      await chrome.storage.local.set({[key]:records,pending_capture_error:''});
      DevLog.event('缓存','完整对话已在本地暂存',{messageCount:value.messages.length,dueAt:lastActivity+idleMs});
      await schedule(records); return {status:'cached'};
    }).catch(async error=>{
      await chrome.storage.local.set({pending_capture_error:'对话缓存失败：'+error.message}).catch(()=>{});
      throw error;
    });
  }
  async function valid(id, revision) {
    const data=await chrome.storage.local.get([key,'auto_capture']), record=data[key]?.[id];
    if(data.auto_capture===false || !record || record.revision!==revision || Date.now()<record.lastActivity+idleMs) {
      const error=Error('对话已继续或自动整理已暂停，等待新的空闲时间');error.name='PendingSuperseded';throw error;
    }
  }
  async function process(id, record) {
    DevLog.event('调度','空闲到期 → 开始处理缓存',{cacheId:id.slice(0,12),attempt:(record.attempts||0)+1});
    try {
      await runCapture(record.payload,
        ()=>valid(id,record.revision),
        task=>serial(async()=>{await valid(id,record.revision);return task();}));
      await serial(async()=>{
        const records=await read();
        if(records[id]?.revision===record.revision){delete records[id];await chrome.storage.local.set({[key]:records});}
      });
    } catch(error) {
      if(error.name==='PendingSuperseded')DevLog.event('调度','对话继续或配置改变 → 旧任务让路',{});
      if(error.name!=='PendingSuperseded')await serial(async()=>{
        const records=await read(), current=records[id];
        if(current?.revision!==record.revision)return;
        current.attempts=(current.attempts||0)+1;
        current.retryAt=Date.now()+Math.min(60,5*2**Math.min(current.attempts-1,4))*60000;
        current.error=error.message;
        DevLog.event('调度','处理失败 → 保留缓存并延后重试',{cacheId:id.slice(0,12),retryAt:current.retryAt,error:error.message});
        await chrome.storage.local.set({[key]:records});
      });
    } finally {
      active.delete(id);await serial(()=>schedule());
    }
  }
  async function drain() {
    const ready=await serial(async()=>{
      const data=await chrome.storage.local.get([key,'auto_capture']), records=data[key]||{};
      if(data.auto_capture===false){await schedule(records);return [];}
      const ready=Object.entries(records).filter(([id,r])=>!active.has(id)&&Date.now()>=Math.max(r.lastActivity+idleMs,r.retryAt||0));
      ready.forEach(([id])=>active.add(id));await schedule(records);return ready;
    });
    await Promise.all(ready.map(([id,r])=>process(id,r)));
  }
  async function discardProcessed(payload) {
    return serial(async()=>{
      const id=await sourceKey(payload.url), records=await read();
      if(records[id]?.signature===await fingerprint(clean(payload))){delete records[id];await chrome.storage.local.set({[key]:records});}
      await schedule(records);
    });
  }
  async function status() {
    const data=await chrome.storage.local.get([key,'auto_capture','pending_capture_error']), records=Object.values(data[key]||{});
    return {pendingCount:records.length,pendingPaused:data.auto_capture===false,pendingError:data.pending_capture_error||records.find(r=>r.error)?.error||''};
  }
  async function clear() {return serial(async()=>{await chrome.storage.local.remove([key,'pending_capture_error']);await chrome.alarms.clear(alarm);});}
  function init(run) {
    runCapture=run;
    const recover=()=>drain().catch(error=>console.warn('[知识树] 后台整理调度失败:',error.message));
    chrome.alarms.onAlarm.addListener(event=>{if(event.name===alarm)recover();});
    chrome.runtime.onStartup.addListener(recover);
    chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.auto_capture)recover();});
    // Recreate the alarm from durable timestamps on every service-worker start.
    recover();
  }
  return {cache,discardProcessed,status,clear,init,drain,key,alarm};
})();
