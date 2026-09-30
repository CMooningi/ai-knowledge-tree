const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const store={deepseek_api_key:'official-secret-only-for-tests'},requests=[],answers=[],logs=[];let listener,mutate;
const consoleMock=Object.fromEntries(['log','warn','groupCollapsed','groupEnd'].map(name=>[name,(...args)=>logs.push({name,args:structuredClone(args)})]));
const ctx=vm.createContext({URL,TextEncoder,AbortController,setTimeout,clearTimeout,structuredClone,crypto:require('node:crypto').webcrypto,console:consoleMock,
 chrome:{downloads:{onChanged:{addListener(){}},async search(){return [];}},storage:{local:{async get(keys){if(typeof keys==='string')keys=[keys];return structuredClone(Object.fromEntries(keys.map(k=>[k,store[k]])));},async set(v){Object.assign(store,structuredClone(v));},async remove(keys){keys.forEach(k=>delete store[k]);}},onChanged:{addListener(){}}},runtime:{onMessage:{addListener(fn){listener=fn;}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},alarms:{async create(){},async clear(){},onAlarm:{addListener(){}}}},
 fetch:async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});assert(answers.length,'unexpected API call');if(mutate){mutate();mutate=null;}const a=answers.shift();if(a.reject)throw Error(a.reject);return {ok:!a.status||a.status<400,status:a.status||200,async text(){return a.raw!==undefined?a.raw:JSON.stringify(a.body);}};}
});
ctx.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(__dirname+'/../'+file,'utf8'),ctx));
vm.runInContext(fs.readFileSync(__dirname+'/../background.js','utf8'),ctx);
const send=msg=>new Promise(resolve=>listener(msg,{},resolve));
const choice=(value,confidence=1)=>({body:{model:'typesafe/jev-1.13',answers:{intake:{type:'choice',choice:value,confidence,probabilities:{[value]:confidence}}},usage:{input_tokens:32,output_tokens:8,cost:0.00001}}});
const chat=value=>({body:{choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:10}}});
const payload={url:'https://example.test/router',messages:[{role:'user',content:'Explain Python lists'},{role:'assistant',content:'Python lists are mutable ordered collections of values.',headings:['Python lists']}]};
const capture=()=>send({type:'CAPTURE_CONVERSATION',payload});
(async()=>{
 answers.push(choice('programming'));assert.equal((await send({type:'SAVE_JEV_KEY',provider:'openrouter',key:'router-jev-secret',model:'typesafe/jev-1.13'})).status,'success');
 assert.equal(requests.at(-1).url,'https://openrouter.ai/api/alpha/decisions');assert.equal(requests.at(-1).body.model,'typesafe/jev-1.13');assert(requests.at(-1).body.questions.intake);assert(!requests.at(-1).body.messages);assert.equal(requests.at(-1).options.headers.Authorization,'Bearer router-jev-secret');assert.equal(store.jev_provider,'openrouter');
 answers.push(choice('skip'));assert.equal((await capture()).status,'skipped');const count=requests.length;await capture();assert.equal(requests.length,count);
 // A failed provider switch must preserve the active verified configuration.
 answers.push({status:401,body:{error:{message:'denied router-new-secret'}}});assert.equal((await send({type:'SAVE_JEV_KEY',provider:'typesafe',key:'router-new-secret'})).status,'error');assert.equal(store.jev_provider,'openrouter');assert.equal(store.jev_openrouter_api_key,'router-jev-secret');
 assert.equal((await send({type:'SAVE_LLM_CONFIG',provider:'openrouter',key:'router-note-secret',model:'typesafe/jev-1.13'})).status,'error');assert(!store.llm_provider);
 assert.equal((await send({type:'SAVE_LLM_CONFIG',provider:'openrouter',key:'router-note-secret',model:'example/json-model'})).status,'success');assert.equal(store.deepseek_api_key,'official-secret-only-for-tests');assert.equal(store.openrouter_api_key,'router-note-secret');
 answers.push(chat({ok:true}));assert.equal((await send({type:'TEST_LLM_CONFIG',provider:'openrouter',key:'probe-secret',model:'example/json-model'})).status,'success');assert.equal(requests.at(-1).url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(requests.at(-1).body.response_format.type,'json_object');assert.equal(store.openrouter_api_key,'router-note-secret','probe must not save credentials');
 // Jev outage must fall back to the selected OpenRouter text model, never DeepSeek.
 payload.url+='-outage';answers.push({status:503,body:{error:{message:'temporarily unavailable'}}},chat({is_learning:false}));assert.equal((await capture()).status,'skipped');assert.equal(requests.at(-1).url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(requests.at(-1).options.headers.Authorization,'Bearer router-note-secret');assert.equal(store.jev_status.state,'fallback');
 await send({type:'REMOVE_JEV_KEY'});assert(!store.jev_openrouter_api_key);assert(!store.jev_verified);
 // Full selected-provider pipeline: classify -> summarize -> reorganize -> commit.
 payload.url+='-complete';const text=payload.messages[1].content;
 answers.push(chat({is_learning:true,technology:'Python',hierarchy:['Python'],related_ids:[]}),chat({sections:[{heading:'Lists',content:text,evidence:'Python lists are mutable',replaces:[]}]}),chat({placements:[{index:0,path:['Python']}],moves:[],summary:''}));
 assert.equal((await capture()).status,'success');assert(store.knowledge_tree_md.includes(text));assert(requests.slice(-3).every(r=>r.url==='https://openrouter.ai/api/v1/chat/completions'));
 // Embedded errors and non-JSON replies are observable but redact keys.
 answers.push({body:{error:{message:'bad credential probe-secret',api_key:'other-hidden-key'}}});assert.equal((await send({type:'TEST_LLM_CONFIG',provider:'openrouter',key:'probe-secret',model:'example/json-model'})).status,'error');
 answers.push({raw:'<html>probe-secret upstream error</html>',status:502});await send({type:'TEST_LLM_CONFIG',provider:'openrouter',key:'probe-secret',model:'example/json-model'});
 answers.push({raw:'not-json'});assert.equal((await send({type:'TEST_LLM_CONFIG',provider:'openrouter',key:'probe-secret',model:'example/json-model'})).status,'error');
 const output=JSON.stringify(logs);
 for(const key of ['router-jev-secret','router-note-secret','router-new-secret','probe-secret','other-hidden-key'])assert(!output.includes(key),'secret leaked: '+key);
 for(const marker of ['开始','请求体','原始返回值','Jev 决策','兜底审核','解析后的结果','保存知识树','结束','失败','非 JSON','usage','cost'])assert(output.includes(marker),'missing trace: '+marker);
 assert.equal(logs.filter(x=>x.name==='groupCollapsed').length,logs.filter(x=>x.name==='groupEnd').length,'groups must be balanced');
 const parents=logs.filter(x=>x.name==='log'&&x.args[0]?.parentTask).map(x=>x.args[0].parentTask);assert(parents.length>0,'API logs must link to their task');
 const C=vm.runInContext('ModelConfig',ctx);assert.equal(C.jev({}).endpoint,'https://api.typesafe.ai/v1/systemone');assert.equal(C.llm({}).model,'deepseek-chat');assert.throws(()=>C.jev({jev_provider:'openrouter',jev_openrouter_model:'typesafe/jev-router'}));
 assert.equal(answers.length,0);console.log('PASS OpenRouter Jev Decisions contract, legacy defaults, provider/key isolation, authenticated JSON probe, failed-switch preservation, fallback routing, full text pipeline, trace linkage, errors and credential redaction.');
})().catch(error=>{console.error(error);process.exitCode=1;});
