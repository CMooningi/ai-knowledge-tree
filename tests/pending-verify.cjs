const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const webcrypto=require('node:crypto').webcrypto;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function runtime(store={},clock={now:1000000},handler=async()=>({status:'success'})){
  const alarms=new Map(),events={},calls=[];let failWrite=false;
  class Clock extends Date{static now(){return clock.now;}}
  const ctx=vm.createContext({Date:Clock,URL,TextEncoder,crypto:webcrypto,console,intakeScope:async()=>'',chrome:{
    storage:{local:{async get(keys){if(typeof keys==='string')keys=[keys];return structuredClone(Object.fromEntries(keys.map(k=>[k,store[k]])));},async set(value){if(failWrite&&value.knowledge_pending_captures_v1)throw Error('quota exceeded');Object.assign(store,structuredClone(value));},async remove(keys){keys.forEach(k=>delete store[k]);}},onChanged:{addListener(fn){events.changed=fn;}}},
    runtime:{onStartup:{addListener(fn){events.startup=fn;}}},
    alarms:{async create(name,info){alarms.set(name,info);},async clear(name){alarms.delete(name);},onAlarm:{addListener(fn){events.alarm=fn;}}}
  }});
  for(const file of ['capture-state.js','pending-captures.js'])vm.runInContext(fs.readFileSync(__dirname+'/../'+file,'utf8'),ctx);
  const pending=vm.runInContext('PendingCaptures',ctx);
  pending.init(async(payload,guard,commit)=>{calls.push(payload);await guard();return handler(payload,guard,commit);});
  return {pending,store,clock,calls,alarms,events,ctx,failWrite(v){failWrite=v;}};
}
const payload={url:'https://chatgpt.com/c/example',platform:'chatgpt.com',title:'Python',messages:[{role:'user',content:'Explain lists'},{role:'assistant',content:'Python lists are mutable ordered sequences of elements.',headings:['Lists']}]};
async function cached(r,p=payload){await r.pending.cache(p,r.clock.now);}
const record=r=>Object.values(r.store[r.pending.key]||{})[0];
(async()=>{
  let r=runtime();await cached(r);assert.equal(r.calls.length,0,'caching must never call a model');assert(record(r));assert.equal(r.alarms.get(r.pending.alarm).when,r.clock.now+300000);
  r.clock.now+=299999;await r.pending.drain();assert.equal(r.calls.length,0);r.clock.now++;await r.pending.drain();assert.equal(r.calls.length,1,'closed page needs no content-script callback');assert.equal((await r.pending.status()).pendingCount,0);
  r=runtime();await cached(r);r.clock.now+=240000;await r.pending.cache({url:payload.url},r.clock.now);r.clock.now+=60000;await r.pending.drain();assert.equal(r.calls.length,0);r.clock.now+=240000;await r.pending.drain();assert.equal(r.calls.length,1,'typing restarts deadline');
  r=runtime();await cached(r);const store=r.store,clock=r.clock;clock.now+=400000;r=runtime(store,clock);await r.pending.drain();await flush();assert.equal(r.calls.length,1,'restart recovers persisted expired work');
  r=runtime({},undefined,async()=>{throw Error('network unavailable');});await cached(r);r.clock.now+=300000;await r.pending.drain();assert(record(r).error);assert.equal(record(r).retryAt,r.clock.now+300000);await r.pending.drain();assert.equal(r.calls.length,1,'failure backs off');r.clock.now+=300000;await r.pending.drain();assert.equal(r.calls.length,2);assert.equal(record(r).retryAt,r.clock.now+600000);
  let release,committed=false;const gate=new Promise(resolve=>release=resolve);
  r=runtime({},undefined,async(_p,_g,commit)=>{await gate;await commit(async()=>{committed=true;});return {status:'success'};});await cached(r);r.clock.now+=300000;const running=r.pending.drain();while(!r.calls.length)await flush();await r.pending.cache({url:payload.url},r.clock.now);release();await running;assert.equal(committed,false,'resuming during inference prevents stale commit');assert(record(r),'new revision survives old completion');
  r=runtime();await cached(r);r.store.auto_capture=false;r.clock.now+=400000;await r.pending.drain();assert.equal(r.calls.length,0);assert(record(r));assert.equal(r.alarms.size,0);r.store.auto_capture=true;await r.pending.drain();assert.equal(r.calls.length,1);
  r=runtime();await cached(r);await r.pending.discardProcessed({...payload,messages:[...payload.messages,{role:'user',content:'new'}]});assert(record(r));await r.pending.discardProcessed(payload);assert(!record(r),'manual cleanup requires matching transcript');
  r=runtime();await cached(r);const newer={...payload,messages:[...payload.messages,{role:'user',content:'append?'},{role:'assistant',content:'Append adds a new element at the end of the list.'}]};await cached(r,newer);await cached(r,{...newer,messages:newer.messages.slice(2)});assert.equal(record(r).payload.messages.length,4,'virtualized suffix retains earlier pending turns');await cached(r,{...payload,messages:[{role:'user',content:'A wholly new virtualized turn'},{role:'assistant',content:'Another completed answer that is now visible.'}]});assert.equal(record(r).payload.messages.length,6,'no overlap must not discard older pending turns');await r.pending.clear();assert(!record(r));assert.equal(r.alarms.size,0);
  r=runtime();await cached(r);r.failWrite(true);await assert.rejects(()=>cached(r,newer),/quota/);assert.equal(record(r).payload.messages.length,2,'quota failure preserves previous snapshot');assert((await r.pending.status()).pendingError.includes('quota'));
  console.log('PASS durable cache, 5-minute deadline, closed tabs, restart, typing reset, failure retention/backoff, in-flight revision guards, pause/resume, manual cleanup, virtualized history, clear, quota failure.');
})().catch(error=>{console.error(error);process.exitCode=1;});
