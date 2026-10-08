const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const version=JSON.parse(fs.readFileSync(__dirname+'/../manifest.json','utf8')).version;
const source=fs.readFileSync(__dirname+'/../popup/popup.js','utf8'),background=fs.readFileSync(__dirname+'/../background.js','utf8');
assert.equal(source.match(/POPUP_VERSION = '([^']+)'/)[1],version);
assert.equal(background.match(/BACKGROUND_VERSION = '([^']+)'/)[1],version);
let now=1000000,status,release,requests=0;const nodes={},intervals=[];
function element(){const classes=new Set();return {textContent:'',hidden:false,style:{},disabled:false,events:{},
 classList:{add(...names){names.forEach(n=>classes.add(n));},remove(...names){names.forEach(n=>classes.delete(n));},contains:n=>classes.has(n)},
 addEventListener(name,fn){this.events[name]=fn;},remove(){}};}
const el=id=>nodes[id]||=(element());class Clock extends Date {static now(){return now;}}
const ctx=vm.createContext({Date:Clock,console,setInterval(fn,ms){intervals.push({fn,ms});},setTimeout(){},
 document:{addEventListener(name,fn){if(name==='DOMContentLoaded')this.ready=fn;},getElementById:el,querySelector(){return null;},createElement:element,body:{appendChild(){}}},
 chrome:{runtime:{async sendMessage(msg){assert.equal(msg.type,'GET_STATUS');requests++;return status;}},tabs:{async query(){return [{id:1}];},sendMessage(){return new Promise(resolve=>release=resolve);}}}
});
vm.runInContext(source,ctx);const render=vm.runInContext('updateUI',ctx);
const base={backgroundVersion:version,pendingCount:1,pendingState:'waiting',pendingNextAt:now+300000};
(async()=>{
 render(base);assert(el('statusText').textContent.includes('5分00秒'));assert.equal(el('versionText').textContent,'v'+version);assert(el('statusDetail').hidden);
 render({...base,pendingState:'retry',pendingRetryCount:3,pendingError:'分类失败',pendingNextAt:now+1200000});
 assert(el('statusText').textContent.includes('失败 3 次'));assert(el('statusText').textContent.includes('20分00秒'));assert(el('statusDetail').textContent.includes('分类失败'));
 render({...base,pendingState:'processing',pendingProcessing:1,pendingError:'旧错误'});assert(el('statusText').textContent.includes('正在处理'));assert(!el('statusDot').classList.contains('error'));
 render({...base,pendingState:'paused',pendingPaused:true});assert(el('statusText').textContent.includes('已关闭'));
 render({...base,pendingState:'retry',pendingRetryCount:3,pendingNextAt:now-1});assert(el('statusText').textContent.includes('重试时间已到'));
 render({...base,pendingState:'idle',pendingCount:0});assert(el('statusText').textContent.includes('没有待处理'));assert(!el('statusDot').classList.contains('error'));
 render({pendingCount:1,pendingError:'legacy error'});assert(el('statusDetail').textContent.includes('重新加载'));assert.equal(el('versionText').textContent,'后台待更新');
 render({...base,backgroundVersion:'1.3.0'});assert.equal(el('versionText').textContent,'v1.3.0');assert(el('statusDetail').textContent.includes('重新加载'));
 render({...base,pendingState:'cache-error',pendingCount:0,pendingError:'quota'});assert(el('statusText').textContent.includes('保持对话页面打开'));
 // Opening the popup only queries status; countdown ticks do not reset work.
 status=base;ctx.document.ready();await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,1);
 now+=10000;intervals.find(x=>x.ms===1000).fn();assert(el('statusText').textContent.includes('4分50秒'));assert.equal(requests,1);
 // Background refreshes must not overwrite the immediate manual-capture state.
 const manual=el('btnCapture').events.click();await new Promise(resolve=>setImmediate(resolve));
 intervals.find(x=>x.ms===1000).fn();await intervals.find(x=>x.ms===5000).fn();assert.equal(requests,1);assert(el('statusText').textContent.includes('无需等待五分钟'));
 release({status:'skipped',reason:'没有新知识'});await manual;assert.equal(el('statusText').textContent,'没有新知识');assert.equal(el('btnCapture').disabled,false);
 status={...base,pendingCount:0,pendingState:'idle'};await intervals.find(x=>x.ms===5000).fn();assert.equal(requests,2);assert(el('statusText').textContent.includes('没有待处理'));
 console.log('PASS actual worker version, stale worker guidance, idle/retry/processing/paused/error states, live countdown, status-only polling, manual progress protection.');
})().catch(error=>{console.error(error);process.exitCode=1;});
