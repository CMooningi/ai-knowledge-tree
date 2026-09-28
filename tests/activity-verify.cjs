const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const store={},downloads=new Map();let listener,downloadId=0,downloadListener,cancel=false;
const ctx=vm.createContext({URL,TextEncoder,crypto:webcrypto,structuredClone,console,
 chrome:{storage:{local:{async get(){return structuredClone(store);},async set(v){Object.assign(store,structuredClone(v));},async remove(keys){keys.forEach(k=>delete store[k]);}}},
 runtime:{onMessage:{addListener(fn){listener=fn;}},onInstalled:{addListener(){}}},
 downloads:{onChanged:{addListener(fn){downloadListener=fn;}},async download(){if(cancel)throw Error('cancelled');downloads.set(++downloadId,{id:downloadId,state:'in_progress'});return downloadId;},async search({id}){return downloads.has(id)?[downloads.get(id)]:[];}}},
});
ctx.importScripts=(...names)=>names.forEach(name=>vm.runInContext(fs.readFileSync(__dirname+'/../'+name,'utf8'),ctx));
ctx.chrome.alarms={async create(){},async clear(){},onAlarm:{addListener(){}}};ctx.chrome.runtime.onStartup={addListener(){}};ctx.chrome.storage.onChanged={addListener(){}};vm.runInContext(fs.readFileSync(__dirname+'/../background.js','utf8'),ctx);
const A=ctx.NoteActivity,T=vm.runInContext('Taxonomy',ctx),M=ctx.KnowledgeModel;
const send=msg=>new Promise(resolve=>listener(msg,{},resolve));
const now=new Date(2026,8,23,12).getTime();
function entry(id,updatedAt=now){return {uid:id,updatedAt,readAt:0,days:['2026-09-23']};}
(async()=>{
 const many=Object.fromEntries(Array.from({length:14},(_,i)=>['n'+i,entry('u'+i,now-i*1000)]));
 assert.equal(A.recent(many,now).length,10);
 many.n0.readAt=now;assert.equal(A.recent(many,now).length,9);assert(!A.recent(many,now).some(([id])=>id==='n10'));
 assert.equal(A.recent(many,now+8*86400000).length,0);
 const identity={remap:[{from:'n',to:'n'}]};
 let stats=A.evolve({}, {...identity,activity:[{from:[],to:'n',updated:true}]},[],now);
 assert.equal(stats.n.days.length,1);
 stats=A.evolve(stats,identity,['n'],now+1000);assert.equal(stats.n.days.length,1);
 stats=A.evolve(stats,identity,['n'],now+86400000);assert.equal(stats.n.days.length,2);assert.equal(stats.n.updatedAt,now);
 const read=A.read(stats,[{uid:stats.n.uid,updatedAt:now}]);assert.equal(read.n.readAt,now);
 const newer=A.evolve(read,{...identity,activity:[{from:['n'],to:'n',updated:true}]},[],now+2*86400000);
 assert.equal(A.read(newer,[{uid:stats.n.uid,updatedAt:now}]).n.readAt,now);
 const moved=A.evolve(newer,{remap:[{from:'n',to:'m'}]},[],now);assert.equal(moved.m.uid,newer.n.uid);assert(!moved.n);
 // Actual taxonomy move and replacement retain identity; moving isn't an update.
 const md='# Tree\n## Python\n### Old\n<!-- aitree-note:start -->\nPython 列表保留原有内容。\n<!-- aitree-note:end -->\n> 📎 [查看对话原文](https://example.test/chat)\n';
 const snapshot=T.snapshot(md),note=snapshot.records.find(r=>r.kind==='note');
 const result=T.apply(md,{technology:'Python'},[],[{id:note.id,path:note.path,content:note.node.body.join('\n')}],{placements:[],moves:[{id:note.id,path:['Python','通用'],evidence:'Python',reason:'通用内容'}]},'https://example.test/chat');
 const migrated=A.evolve({[note.node.id]:entry('stable')},result,[],now);assert.equal(Object.values(migrated)[0].uid,'stable');assert.equal(Object.values(migrated)[0].updatedAt,now);
 store.knowledge_tree_md=md;store[A.key]={[note.node.id]:entry('exported')};
 const first=await send({type:'DOWNLOAD_TREE'});assert.equal(first.status,'success');assert.equal(store[A.key][note.node.id].readAt,0);
 downloads.get(downloadId).state='interrupted';await vm.runInContext(`settleExport(${downloadId})`,ctx);assert.equal(store[A.key][note.node.id].readAt,0);
 cancel=true;assert.equal((await send({type:'DOWNLOAD_TREE'})).status,'error');assert.equal(store[A.key][note.node.id].readAt,0);cancel=false;
 await send({type:'DOWNLOAD_TREE'});const savedDownload=downloadId;
 store[A.key][note.node.id].updatedAt=now+100;
 downloads.get(savedDownload).state='complete';await vm.runInContext(`settleExport(${savedDownload})`,ctx);assert.equal(store[A.key][note.node.id].readAt,0);
 await send({type:'DOWNLOAD_TREE'});downloads.get(downloadId).state='complete';await vm.runInContext(`settleExport(${downloadId})`,ctx);assert.equal(store[A.key][note.node.id].readAt,now+100);
 // Rename does not discard stars or unread status.
 const renamed=await send({type:'SAVE_NOTE',payload:{baseMd:md,nodeId:note.node.id,title:'New title',content:'Python 列表保留原有内容。'}});
 assert.equal(renamed.status,'success');assert.equal(store[A.key][renamed.nodeId].uid,'exported');assert(!store[A.key][note.node.id]);
 await send({type:'CLEAR_TREE'});assert.equal(store[A.key],undefined);
 console.log('PASS: 7-day/10-note cap, no backfill after read, unique learning days, stale read receipts, moves, rename, download pending/cancel/failure/success, updates during export, clear.');
})().catch(e=>{console.error(e);process.exitCode=1;});
