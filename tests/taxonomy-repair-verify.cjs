const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const store={deepseek_api_key:'test-only'},requests=[],answers=[],logs=[];let listener;
const ctx=vm.createContext({URL,TextEncoder,structuredClone,AbortController,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,
 console:Object.fromEntries(['log','warn','groupCollapsed','groupEnd'].map(k=>[k,(...args)=>logs.push(args)])),
 chrome:{downloads:{onChanged:{addListener(){}},async search(){return [];}},storage:{local:{
 async get(keys){if(typeof keys==='string')keys=[keys];return structuredClone(Object.fromEntries(keys.map(k=>[k,store[k]])));},
 async set(v){Object.assign(store,structuredClone(v));},async remove(keys){keys.forEach(k=>delete store[k]);}},onChanged:{addListener(){}}},
 runtime:{onMessage:{addListener(fn){listener=fn;}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},alarms:{async create(){},async clear(){},onAlarm:{addListener(){}}}},
 fetch:async(url,options)=>{requests.push(JSON.parse(options.body));assert(answers.length,'unexpected model call');return {ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answers.shift())}}]})};}
});
ctx.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(__dirname+'/../'+file,'utf8'),ctx));
vm.runInContext(fs.readFileSync(__dirname+'/../background.js','utf8'),ctx);
const send=msg=>new Promise(resolve=>listener(msg,{},resolve));
const bad={is_learning:true,technology:'Electron',hierarchy:['软件开发','桌面应用开发'],related_ids:[]};
const good={...bad,hierarchy:['软件开发','桌面应用开发','Electron']};
const body='Electron 使用主进程管理应用生命周期，渲染进程负责展示页面。';
const payload={url:'https://example.test/manual-now',messages:[{role:'user',content:'解释 Electron 的进程'},{role:'assistant',content:body,headings:['进程职责']}]};
const section={sections:[{heading:'进程职责',content:body,evidence:'主进程管理应用生命周期',replaces:[]}]};
const plan={placements:[{index:0,path:good.hierarchy}],moves:[],summary:'按 Electron 整理'};
(async()=>{
 // A fresh cached conversation must still be processed manually before its deadline.
 await send({type:'CACHE_CONVERSATION',payload,activityAt:Date.now()});
 const pending=vm.runInContext('PendingCaptures',ctx),record=Object.values(store[pending.key])[0];
 assert(record);await pending.drain();assert.equal(requests.length,0,'automatic capture waits five minutes');
 record.retryAt=Date.now()+3600000;record.error='previous automatic failure';store.auto_capture=false;
 // Deliberately reorder fields: JSON object order must not reject a valid repair.
 answers.push(bad,{related_ids:[],hierarchy:good.hierarchy,technology:'Electron',is_learning:true},section,plan);
 const result=await send({type:'CAPTURE_CONVERSATION',payload});
 assert.equal(result.status,'success',result.error);assert.equal(requests.length,4);
 assert.equal(Object.keys(store[pending.key]).length,0,'manual success removes matching cache');
 assert(store.knowledge_tree_md.includes('#### Electron'));assert(store.knowledge_tree_md.includes(body));
 assert(!requests[0].messages[1].content.includes(body));assert(!requests[1].messages[1].content.includes(body),'classification repair still uses only questions/headings');
 assert(JSON.stringify(logs).includes('自动修正一次'));
 const before=store.knowledge_tree_md,checkpoints=JSON.stringify(store.capture_checkpoints_v1);
 // Repeated invalid paths stop after one repair and preserve tree/checkpoints.
 payload.url+='-invalid';answers.push(bad,bad);const n=requests.length;
 const failed=await send({type:'CAPTURE_CONVERSATION',payload});
 assert.equal(failed.status,'error');assert(failed.error.includes('自动修正后'));assert.equal(requests.length,n+2);
 assert.equal(store.knowledge_tree_md,before);assert.equal(JSON.stringify(store.capture_checkpoints_v1),checkpoints);
 // A repair must not evade the requirement by dropping the technology.
 answers.push(bad,{...bad,technology:null});
 assert((await send({type:'CAPTURE_CONVERSATION',payload})).error.includes('改变了其他字段'));
 assert.equal(store.knowledge_tree_md,before);
 const planTaxonomy=vm.runInContext('planTaxonomy',ctx);
 // Planning placements and moves both need independent technology layers.
 const badPlan={placements:[{index:0,path:['桌面应用开发']}],moves:[{id:'n7',path:['旧分类'],evidence:'旧笔记依据',reason:'正文支持'}],summary:'整理'};
 const fixedPlan={...badPlan,placements:[{index:0,path:good.hierarchy}],moves:[{...badPlan.moves[0],path:['Electron','通用']}]};
 answers.push(badPlan,fixedPlan);
 const fixed=await planTaxonomy(good,section.sections,[],[]);
 assert.equal(fixed.moves[0].path[0],'Electron');
 // Protect unrelated move targets even when paths become valid.
 answers.push(badPlan,{...fixedPlan,moves:[{...fixedPlan.moves[0],id:'n8'}]});
 await assert.rejects(()=>planTaxonomy(good,section.sections,[],[]),/改变了其他字段/);
 // Four-level limit is repairable; no append-to-five-level workaround.
 const deep={...good,hierarchy:['知识','计算机','软件开发','桌面应用','Electron']};
 answers.push(deep,good);const classify=vm.runInContext('classifyConversation',ctx);
 assert.equal((await classify([],[],'')).hierarchy.length,3);
 // Jev approval must not erase a known technology when hierarchy is absent.
 const missing={...good};delete missing.hierarchy;
 answers.push(missing,good);const approved=await classify([],[],'',[],{decision:'collect'});
 assert.equal(approved.technology,'Electron');assert.equal(approved.hierarchy.at(-1),'Electron');
 // Valid paths and ordinary concept notes cost exactly one call.
 answers.push(good);const normal=requests.length;await classify([],[],'');assert.equal(requests.length,normal+1);
 answers.push({...good,technology:null,hierarchy:['通用概念']});await classify([],[],'');
 assert.equal(answers.length,0);
 console.log('PASS bounded taxonomy repair, preserved decisions/evidence, title-only context, atomic failures, immediate manual capture despite automatic deadline/retry/pause, matching cache cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1;});
