const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const note=(title,text,url)=>`#### ${title}\n<!-- aitree-note:start -->\n${text}\n<!-- aitree-note:end -->\n> 📎 [查看对话原文](${url})\n`;
const oldA='VectorStoreIndex 负责组织向量索引；构建时需要保留节点与索引的关联。';
const oldB='索引对象协调检索入口；StorageContext 管理不同存储组件，不等于向量数据库。';
const before='# 知识树\n## LlamaIndex\n### 查询流程\n'+note('查询入口','查询入口组织一次检索及后续处理。','https://example.test/query')+
 '### 向量索引\n'+note('VectorStoreIndex 的作用与返回值',oldA,'https://example.test/a')+note('LlamaIndex 中 VectorStoreIndex 与存储组件的职责划分',oldB,'https://example.test/b')+
 '### 文档解析\n'+note('文本切分','文档解析得到用于后续索引的数据单元。','https://example.test/parse')+
 '### 配置与全局设置\n'+note('模型选择','先配置用于本次处理的模型和参数。','https://example.test/settings')+'## Python\n### 列表\n无关分支必须保留。\n';
const store={knowledge_tree_md:before,deepseek_api_key:'test-only'},requests=[],answers=[];let listener;
const ctx=vm.createContext({URL,TextEncoder,structuredClone,AbortController,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,
 console:{log(){},warn(){},groupCollapsed(){},groupEnd(){}},
 chrome:{downloads:{onChanged:{addListener(){}},async search(){return [];}},storage:{local:{
 async get(keys){if(typeof keys==='string')keys=[keys];return structuredClone(Object.fromEntries(keys.map(k=>[k,store[k]])));},
 async set(v){Object.assign(store,structuredClone(v));},async remove(keys){keys.forEach(k=>delete store[k]);}},onChanged:{addListener(){}}},
 runtime:{onMessage:{addListener(fn){listener=fn;}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},alarms:{async create(){},async clear(){},onAlarm:{addListener(){}}}},
 fetch:async(url,options)=>{requests.push(JSON.parse(options.body));assert(answers.length,'unexpected call');return {ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answers.shift())}}]})};}
});
ctx.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(__dirname+'/../'+file,'utf8'),ctx));
vm.runInContext(fs.readFileSync(__dirname+'/../background.js','utf8'),ctx);
const T=vm.runInContext('Taxonomy',ctx),initial=T.snapshot(before);
const a=initial.records.find(r=>r.node.title==='VectorStoreIndex 的作用与返回值'),b=initial.records.find(r=>r.node.title.startsWith('LlamaIndex 中'));
const cls={is_learning:true,technology:'LlamaIndex',hierarchy:['LlamaIndex','向量索引'],related_ids:[a.id,b.id]};
const related=T.related(initial,cls),input='VectorStoreIndex 的构建返回索引对象，查询阶段通过它取得检索入口。';
const merged={heading:'VectorStoreIndex',content:'## 定位与职责\n'+oldA+'\n'+oldB+'\n## 构建与查询\n'+input,evidence:'构建返回索引对象，查询阶段通过它取得检索入口',replaces:[a.id,b.id],merge_evidence:[{id:a.id,quote:oldA},{id:b.id,quote:oldB}]};
const order={path:['LlamaIndex'],children:['配置与全局设置','文档解析','向量索引','查询流程'],reason:'按前置配置、数据准备、索引构建、查询使用的依赖排序'};
const plan={placements:[{index:0,path:cls.hierarchy}],moves:[],orders:[order],summary:'合并索引主题并按依赖组织目录'};
const payload={url:'https://example.test/new',messages:[{role:'user',content:'总结索引职责、构建与查询的关系'},{role:'assistant',content:input,headings:['职责与使用']}]};
const send=msg=>new Promise(resolve=>listener(msg,{},resolve));
const capture=()=>send({type:'CAPTURE_CONVERSATION',payload});
(async()=>{
 assert.equal(related[0].id,a.id);assert.equal(related[1].id,b.id,'explicit merge candidates precede generic technology neighbors');
 store.knowledge_note_activity={[a.node.id]:{uid:'a',updatedAt:1,readAt:1,days:['2026-01-01']},[b.node.id]:{uid:'b',updatedAt:2,readAt:2,days:['2026-02-01']}};
 answers.push(cls,{sections:[merged]},plan);const result=await capture();assert.equal(result.status,'success',result.error);assert.equal(result.updatedNotes,2);assert.equal(result.reorderedDirectories,1);assert.equal(requests.length,3,'no extra organization call');
 const after=T.snapshot(store.knowledge_tree_md),technology=after.records.find(r=>r.node.title==='LlamaIndex');
 assert.equal(JSON.stringify(technology.node.children.map(n=>n.title)),JSON.stringify(order.children));
 const notes=after.records.filter(r=>r.kind==='note'&&r.path.includes('向量索引'));assert.equal(notes.length,1);assert.equal(notes[0].node.title,'VectorStoreIndex');
 const content=notes[0].node.body.join('\n');assert(content.includes(oldA));assert(content.includes(oldB));assert(content.includes(input));
 for(const url of ['https://example.test/a','https://example.test/b','https://example.test/new'])assert(content.includes(url));
 assert.equal(T.sourceLinks(content).length,3);assert(!T.sameSource(content,payload.url));assert(T.canMerge({content,path:notes[0].path},'LlamaIndex',payload.url));
 const python=after.records.find(r=>r.node.title==='列表'),oldPython=initial.records.find(r=>r.node.title==='列表');assert.equal(python.node.body.join('\n'),oldPython.node.body.join('\n'));assert.equal(python.node.id,oldPython.node.id);
 assert.equal(store.knowledge_tree_before_reorganization.md,before);
 const days=store.knowledge_note_activity[notes[0].node.id].days;assert(days.includes('2026-01-01'));assert(days.includes('2026-02-01'));
 const extraction=JSON.parse(requests[1].messages[1].content);assert.equal(extraction.classification.technology,'LlamaIndex');assert(extraction.comparison_notes.find(n=>n.id===a.id).mergeable);assert(!requests[0].messages[1].content.includes(input));
 assert.equal((await capture()).status,'skipped');assert.equal(requests.length,3);
 // A complete sibling permutation changes only order. Invalid permutations fail closed.
 const onlyOrder={placements:[],moves:[],orders:[order]};
 const sorted=T.apply(before,cls,[],related,onlyOrder,payload.url);assert.equal(sorted.reordered,1);assert.equal(sorted.added,0);
 assert.equal(T.apply(sorted.md,cls,[],[],onlyOrder,payload.url).reordered,0,'sorting is idempotent');
 for(const bad of [
 {...order,children:order.children.slice(1)},
 {...order,children:['文档解析','文档解析','向量索引','查询流程']},
 {...order,children:['虚构目录',...order.children.slice(1)]},
 {...order,path:['Python'],children:['列表']},
 {...order,path:[]},
 {...order,reason:''}
 ])assert.throws(()=>T.apply(before,cls,[],related,{...onlyOrder,orders:[bad]},payload.url));
 assert.throws(()=>T.apply(before,cls,[],related,{...onlyOrder,orders:[order,order]},payload.url),/重复排序/);
 // Cross-source merging requires real old-body evidence and protects manual edits.
 assert.throws(()=>T.apply(before,cls,[{...merged,merge_evidence:[]}],related,plan,payload.url),/旧笔记正文依据/);
 assert.throws(()=>T.apply(before,cls,[{...merged,merge_evidence:[{id:a.id,quote:'https://example.test/a'},{id:b.id,quote:oldB}]}],related,plan,payload.url),/旧笔记正文依据/);
 const protectedNotes=related.map(n=>n.id===a.id?{...n,content:'<!-- aitree-user-edited -->\n'+n.content}:n);
 assert(!T.canMerge(protectedNotes[0],'LlamaIndex',payload.url));assert.throws(()=>T.apply(before,cls,[merged],protectedNotes,plan,payload.url),/可合并/);
 assert(!T.canMerge({path:['Python','列表'],content:oldA+'\n> 📎 [查看对话原文](https://example.test/x)'},'LlamaIndex',payload.url));
 // The extractor must reject replacing notes excluded by its bounded input.
 const extract=vm.runInContext('extractKnowledge',ctx),many=Array.from({length:9},(_,i)=>({id:'n'+i,path:['LlamaIndex','笔记'+i],content:oldA,mergeable:true}));
 answers.push({sections:[{...merged,replaces:['n8'],merge_evidence:[{id:'n8',quote:oldA}]}]});
 await assert.rejects(()=>extract(payload.messages,[],many,[],null,cls),/未提供或受保护/);
 assert.equal(JSON.parse(requests.at(-1).messages[1].content).comparison_notes.length,8);
 answers.push({sections:[{...merged,replaces:['n0'],merge_evidence:[{id:'n0',quote:oldA}]}]});
 await assert.rejects(()=>extract(payload.messages,[],[{...many[0],mergeable:false}],[],null,cls),/未提供或受保护/);
 assert.equal(answers.length,0);
 console.log('PASS contextual titles, bounded cross-source merge/evidence, retained unique details and sources, manual protection, provenance across later merges, scoped complete ordering, stable metadata, backups and unchanged-input checkpoints.');
})().catch(error=>{console.error(error);process.exitCode=1;});
