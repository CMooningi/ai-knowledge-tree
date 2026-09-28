const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
function runtime(){
 let now=0,next=0,generating=false,listener,mutation,settingsListener,auto=true;
 const timers=new Map(),events={},sent=[];
 class Clock extends Date {static now(){return now;}}
 const messages=['Explain Python lists','Python lists are mutable sequences with ordered elements.'].map((text,i)=>({innerText:text,getAttribute(name){return name==='data-message-author-role'?(i?'assistant':'user'):null;},contains(){return false;},querySelectorAll(){return [];},compareDocumentPosition(){return i?0:4;}}));
 const ctx=vm.createContext({Date:Clock,console,Node:{DOCUMENT_POSITION_FOLLOWING:4},location:{href:'https://chatgpt.com/c/test',hostname:'chatgpt.com'},
  document:{body:{},title:'chat',addEventListener(name,fn){events[name]=fn;},querySelectorAll(selector){if(selector.includes('data-message-author-role'))return messages;if(selector==='button, [role="button"]'&&generating)return [{textContent:'停止生成',getClientRects(){return [1];},getAttribute(){return '';}}];return [];}},window:{addEventListener(){}},
  MutationObserver:class{constructor(fn){mutation=fn;}observe(){}disconnect(){}},
  setTimeout(fn,delay){timers.set(++next,{fn,at:now+delay});return next;},clearTimeout(id){timers.delete(id);},
  chrome:{runtime:{id:'test',async sendMessage(msg){sent.push(msg);return {status:'success'};},onMessage:{addListener(fn){listener=fn;}}},storage:{local:{async get(){return {auto_capture:auto};}},onChanged:{addListener(fn){settingsListener=fn;}}}}
 });
 vm.runInContext(fs.readFileSync(__dirname+'/../content.js','utf8'),ctx);
 return {sent,messages,ctx,mutation:()=>mutation(),setGenerating(v){generating=v;},setAuto(v){auto=v;},
  input(){events.input({isTrusted:true,type:'input',target:{closest(selector){return selector.startsWith('nav')?null:{};}}});},
  manual(){return new Promise(resolve=>listener({type:'MANUAL_CAPTURE'},null,resolve));},
  settings(){settingsListener({intake_tags:{}},'local');},
  async advance(ms){const until=now+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;timers.delete(due[0]);now=due[1].at;await due[1].fn();}now=until;}
 };
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 let r=runtime();await flush();assert.equal(r.sent[0].type,'CACHE_CONVERSATION');assert.equal(r.sent[0].payload.messages.length,2);await r.advance(600000);await flush();assert.equal(r.sent.filter(m=>m.type==='CAPTURE_CONVERSATION').length,0,'page never triggers automatic LLM calls');assert.equal(r.sent.length,1,'idle polling does not rewrite cached body');
 r.input();await flush();assert.equal(r.sent.at(-1).payload.messages,undefined,'typing touches deadline without sending draft');
 r=runtime();await flush();for(let i=0;i<60;i++){r.mutation();await r.advance(5000);}await flush();assert.equal(r.sent.length,1,'unrelated DOM mutations do not count as conversation activity');
 r=runtime();await flush();r.setGenerating(true);r.messages[1].innerText='incomplete answer';r.mutation();await r.advance(750);await flush();assert.equal(r.sent.at(-1).payload.messages,undefined,'streaming first answer must not be cached as completed');r.setGenerating(false);r.messages[1].innerText='Completed answer with useful learning content.';r.mutation();await r.advance(750);await flush();assert.equal(r.sent.at(-1).payload.messages.length,2);
 await r.manual();assert.equal(r.sent.at(-1).type,'CAPTURE_CONVERSATION','manual still runs immediately');
 r=runtime();await flush();r.ctx.location.href='https://chatgpt.com/c/other';await r.advance(10000);await flush();assert.equal(r.sent.at(-1).payload.url,r.ctx.location.href);
 console.log('PASS prompt local caching, no page-owned auto capture, typing touches, no DOM-noise resets, partial-answer exclusion, completion snapshot, manual capture, navigation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
