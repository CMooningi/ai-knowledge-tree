const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const store={},requests=[],answers=[];let listener,changeDuringRequest=false;
const ctx=vm.createContext({URL,TextEncoder,structuredClone,crypto:require('node:crypto').webcrypto,console,
 chrome:{downloads:{onChanged:{addListener(){}},async search(){return [];}},storage:{local:{async get(){return {...structuredClone(store),deepseek_api_key:'test-only'};},async set(v){Object.assign(store,structuredClone(v));},async remove(keys){keys.forEach(k=>delete store[k]);}}},runtime:{onMessage:{addListener(fn){listener=fn;}},onInstalled:{addListener(){}}}},
 fetch:async(url,options)=>{requests.push(JSON.parse(options.body));assert(answers.length,'unexpected LLM call');if(changeDuringRequest){store.intake_tags=['changed'];changeDuringRequest=false;}return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answers.shift())}}]})};}
});
ctx.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(__dirname+'/../'+file,'utf8'),ctx));
ctx.chrome.alarms={async create(){},async clear(){},onAlarm:{addListener(){}}};ctx.chrome.runtime.onStartup={addListener(){}};ctx.chrome.storage.onChanged={addListener(){}};vm.runInContext(fs.readFileSync(__dirname+'/../background.js','utf8'),ctx);
const send=msg=>new Promise(resolve=>listener(msg,{},resolve));
const evidence='列表是一种可变的有序序列，支持索引访问和追加元素。';
const payload={url:'https://example.test/intake',messages:[{role:'user',content:'讲讲 Python 列表'},{role:'assistant',content:evidence,headings:['列表用法']}]};
const capture=()=>send({type:'CAPTURE_CONVERSATION',payload});
const accepted={is_learning:true,technology:'Python',hierarchy:['Python'],related_ids:[],matched_tags:['Python'],needs_body_review:false};
const note={heading:'列表',content:evidence,evidence:'列表是一种可变的有序序列',replaces:[],matched_tags:['Python']};
const plan={placements:[{index:0,path:['Python']}],moves:[],summary:''};
(async()=>{
 assert.equal(JSON.stringify(ctx.IntakePolicy.normalize('Python， Electron\npython;人工智能')),JSON.stringify(['Python','Electron','人工智能']));
 assert.equal(ctx.IntakePolicy.scope(['B','A']),ctx.IntakePolicy.scope(['a','b']));
 assert.throws(()=>ctx.IntakePolicy.normalize('x'.repeat(61)));
 store.intake_tags=['Electron'];answers.push({...accepted,matched_tags:[]});
 let result=await capture();assert.equal(result.status,'skipped');assert(result.reason.includes('标签'));assert.equal(requests.length,1);assert(!store.knowledge_tree_md);
 await capture();assert.equal(requests.length,1,'same rejected chat should be locally skipped');
 store.intake_tags=['Electron','Python'];answers.push(accepted,{sections:[note]},plan);
 result=await capture();assert.equal(result.status,'success');assert.equal(requests.length,4,'changing policy reevaluates old skipped input');
 const reviewInput=JSON.parse(requests[1].messages[1].content);assert.deepEqual(reviewInput.intake_tags,['Electron','Python']);assert(!requests[1].messages[1].content.includes(evidence));
 assert(store.knowledge_tree_md.includes('列表'));
 // Definite non-learning verdict stops after the existing classification call.
 payload.url='https://example.test/chitchat';answers.push({is_learning:false,matched_tags:[]});const count=requests.length;
 assert.equal((await capture()).status,'skipped');assert.equal(requests.length,count+1);
 // Unknown headings need body review, and a mixed result only saves allowed sections.
 payload.url='https://example.test/mixed';answers.push({...accepted,matched_tags:[],needs_body_review:true},{sections:[{...note,heading:'新列表主题'},{...note,heading:'其他主题',matched_tags:['旅行']}]},plan);
 result=await capture();assert.equal(result.status,'success');assert(!store.knowledge_tree_md.includes('其他主题'));
 // Invalid model tags never open the gate.
 payload.url='https://example.test/invalid';answers.push({...accepted,matched_tags:['not-a-user-tag']});assert.equal((await capture()).status,'skipped');
 // Missing schema is an error and cannot advance progress.
 payload.url='https://example.test/missing';answers.push({is_learning:true});assert.equal((await capture()).status,'error');
 answers.push({...accepted,matched_tags:[]});assert.equal((await capture()).status,'skipped');
 // A scope change during a model request cannot commit obsolete policy results.
 payload.url='https://example.test/race';changeDuringRequest=true;answers.push({...accepted,matched_tags:[]});assert.equal((await capture()).status,'error');
 assert.equal(answers.length,0);
 console.log('PASS: OR tags, normalization, semantic gate, rejected-input cache, tag changes recheck, title-only input, body fallback, mixed-topic filtering, invalid output, policy race.');
})().catch(e=>{console.error(e);process.exitCode=1;});
