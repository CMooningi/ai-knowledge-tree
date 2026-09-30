// Developer console only: no storage, UI rendering, or remote log collection.
// Close each group synchronously; concurrent requests must not nest by accident.
const DevLog = (() => {
  let sequence=0;
  const secrets=new Set();
  function hide(text) {
    let result=String(text);
    for(const secret of secrets)if(secret)result=result.split(secret).join('[REDACTED]');
    return result.replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [REDACTED]')
      .replace(/\b(?:sk-(?:or-v1-)?|jv_live_|github_pat_|ghp_)[A-Za-z0-9_-]{8,}/g,'[REDACTED]');
  }
  function sanitize(value,seen=new WeakSet()) {
    if(typeof value==='string')return hide(value);
    if(!value||typeof value!=='object')return value;
    if(seen.has(value))return '[Circular]';seen.add(value);
    const out=Array.isArray(value)?[]:{};
    for(const [key,item] of Object.entries(value))out[key]=/authorization|api[-_]?key|password|secret|cookie|access[-_]?token|refresh[-_]?token/i.test(key)?'[REDACTED]':sanitize(item,seen);
    seen.delete(value);return out;
  }
  function event(id,label,data,level='log') {
    try {
      const heading=`[知识树][${id}] ${new Date().toISOString()} ── ${hide(label)}`;
      if(console.groupCollapsed)console.groupCollapsed(heading);else console.log(heading);
      (console[level]||console.log).call(console,sanitize(data));
      if(console.groupCollapsed)console.groupEnd();
    }catch{/* Diagnostics must never break capture or expose unsanitized data. */}
  }
  function start(label,details={}) {
    const id=`${Date.now().toString(36)}-${++sequence}`,started=Date.now();
    event(id,'════ 开始：'+label,details);
    return {id,step:(name,data)=>event(id,name,data),
      end:(name,data)=>event(id,'════ 结束：'+name,{elapsedMs:Date.now()-started,result:data}),
      error:error=>event(id,'════ 失败',{elapsedMs:Date.now()-started,name:error?.name,message:error?.message},'warn')};
  }
  return {start,event,sanitize,hide,secret:key=>{if(typeof key==='string'&&key)secrets.add(key);}};
})();
