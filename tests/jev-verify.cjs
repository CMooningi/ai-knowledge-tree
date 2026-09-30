const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const store={},requests=[],answers=[];let listener;
const ctx=vm.createContext({URL,TextEncoder,AbortController,setTimeout,clearTimeout,structuredClone,crypto:require('node:crypto').webcrypto,console,
 chrome:{downloads:{onChanged:{addListener(){}},async search(){return [];}},storage:{local:{async get(){return {...structuredClone(store),deepseek_api_key:'test-only'};},async set(v){Object.assign(store,structuredClone(v));},async remove(keys){keys.forEach(k=>delete store[k]);}}},runtime:{onMessage:{addListener(fn){listener=fn;}},onInstalled:{addListener(){}}}},
 fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});assert(answers.length,'unexpected request');const answer=answers.shift();if(answer.error)return {ok:false,status:answer.error};return {ok:true,json:async()=>url.includes('typesafe')?answer:({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]})};}
});
ctx.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(__dirname+'/../'+file,'utf8'),ctx));
ctx.chrome.alarms={async create(){},async clear(){},onAlarm:{addListener(){}}};ctx.chrome.runtime.onStartup={addListener(){}};ctx.chrome.storage.onChanged={addListener(){}};Object.assign(ctx,{AbortController,setTimeout,clearTimeout});ctx.console={...console,log(){},warn(){},groupCollapsed(){},groupEnd(){}};vm.runInContext(fs.readFileSync(__dirname+'/../background.js','utf8'),ctx);
const send=msg=>new Promise(resolve=>listener(msg,{},resolve));
const choice=(value,confidence=1)=>({answers:{intake:{type:'choice',choice:value,confidence,probabilities:{[value]:confidence}}}});
const payload={url:'https://example.test/jev',messages:[{role:'user',content:'Tell me about Python lists'},{role:'assistant',content:'Python lists are mutable ordered collections of values.',headings:['Python lists']}]};
const capture=()=>send({type:'CAPTURE_CONVERSATION',payload});
const classification={is_learning:true,technology:'Python',hierarchy:['Python'],related_ids:[],matched_tags:[]};
(async()=>{
 answers.push({error:401});assert.equal((await send({type:'SAVE_JEV_KEY',key:'invalid-test'})).status,'error');assert(!store.jev_api_key);
 answers.push(choice('programming'));assert.equal((await send({type:'SAVE_JEV_KEY',key:'valid-test'})).status,'success');assert(store.jev_verified);
 answers.push(choice('skip'));assert.equal((await capture()).status,'skipped');assert.equal(requests.at(-1).body.model,'jev-latest');assert.equal(requests.filter(r=>r.url.includes('deepseek')).length,0);assert(!JSON.stringify(requests.at(-1).body).includes('mutable ordered'));
 const count=requests.length;await capture();assert.equal(requests.length,count);
 // Low confidence skip must continue to full-text processing, never discard.
 payload.url+='-uncertain';answers.push(choice('skip',0.55),{...classification,is_learning:false},{sections:[]});assert.equal((await capture()).status,'skipped');assert.equal(requests.at(-1).url.includes('deepseek'),true);
 // Runtime API outage falls back and enters a short cooldown.
 payload.url+='-outage';answers.push({error:503},{is_learning:false});assert.equal((await capture()).status,'skipped');assert.equal(store.jev_status.state,'fallback');assert(store.jev_retry_after>Date.now());
 payload.url+='-cooldown';const jevCount=requests.filter(r=>r.url.includes('typesafe')).length;answers.push({is_learning:false});await capture();assert.equal(requests.filter(r=>r.url.includes('typesafe')).length,jevCount);
 // Failed replacement key cannot overwrite the working configuration.
 answers.push({error:401});await send({type:'SAVE_JEV_KEY',key:'another-invalid'});assert.equal(store.jev_api_key,'valid-test');
 await send({type:'REMOVE_JEV_KEY'});assert(!store.jev_verified);assert(!store.jev_api_key);
 // Bad response fails validation; no accidental approval.
 answers.push({answers:{intake:{type:'choice',choice:'invented',confidence:1,probabilities:{invented:1}}}});assert.equal((await send({type:'SAVE_JEV_KEY',key:'shape-test'})).status,'error');
 assert.equal(answers.length,0);console.log('PASS Jev official request schema, key verification/save/remove, reject before DeepSeek, no body in precheck, confidence review, outage/cooldown fallback, invalid response.');
})().catch(e=>{console.error(e);process.exitCode=1;});
