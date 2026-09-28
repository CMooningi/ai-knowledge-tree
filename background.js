// Capture, classification and automatic reorganization share a serialized write queue.
importScripts('preview/model.js', 'taxonomy.js', 'preview/editor-model.js', 'tree-actions.js', 'capture-state.js', 'pending-captures.js', 'note-activity.js', 'intake-policy.js', 'jev-client.js', 'deepseek-client.js', 'knowledge-tree.js');
let captureQueue=Promise.resolve();
function enqueue(task,sendResponse){
  const job=captureQueue.then(task);captureQueue=job.catch(()=>{});
  job.then(sendResponse).catch(error=>sendResponse({status:'error',error:error.message}));
  return job;
}
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg.type==='CACHE_CONVERSATION'){
    PendingCaptures.cache(msg.payload,msg.activityAt).then(sendResponse).catch(error=>sendResponse({status:'error',error:error.message}));return true;
  }
  if(msg.type==='DELETE_NODE'){
    enqueue(async()=>{
      const before=await getTree(),data=await chrome.storage.local.get(NoteActivity.key);
      const result=TreeActions.remove(before,msg.payload),activity={};
      for(const {from,to} of result.remap)if(data[NoteActivity.key]?.[from])activity[to]=data[NoteActivity.key][from];
      await chrome.storage.local.set({[STORAGE_KEY]:result.md,[NoteActivity.key]:activity,knowledge_tree_before_delete:{md:before,activity:data[NoteActivity.key]||{},createdAt:Date.now()},knowledge_reader:{}});
      return {status:'success',md:result.md,nodeId:result.nodeId,removed:result.removed};
    },sendResponse);return true;
  }
  if(msg.type==='SAVE_JEV_KEY'){
    enqueue(async()=>{
      const key=typeof msg.key==='string'?msg.key.trim():'';
      if(key.length>4096)throw Error('API Key 长度异常');
      await Jev.verify(key);
      await chrome.storage.local.set({jev_api_key:key,jev_verified:true,jev_retry_after:0,jev_status:{state:'active',message:'验证成功：Jev 已用于收录预审',at:Date.now()}});
      return {status:'success'};
    },sendResponse);return true;
  }
  if(msg.type==='REMOVE_JEV_KEY'){
    enqueue(async()=>{await chrome.storage.local.remove(['jev_api_key','jev_verified','jev_retry_after','jev_status']);return {status:'success'};},sendResponse);return true;
  }
  if(msg.type==='READ_NOTES'){
    enqueue(async()=>{const data=await chrome.storage.local.get(NoteActivity.key);await chrome.storage.local.set({[NoteActivity.key]:NoteActivity.read(data[NoteActivity.key]||{},Array.isArray(msg.receipts)?msg.receipts:[])});return {status:'success'};},sendResponse);return true;
  }
  if(msg.type==='DOWNLOAD_TREE'){
    enqueue(startTreeDownload,sendResponse);return true;
  }
  if(msg.type==='SAVE_NOTE'){
    enqueue(async()=>{
      const stored=await chrome.storage.local.get(STORAGE_KEY),before=stored[STORAGE_KEY]||'',result=NoteEditor.apply(before,msg.payload);
      if(result.changed){
        const data=await chrome.storage.local.get(NoteActivity.key),entries=data[NoteActivity.key]||{},next={};
        for(const [id,value] of Object.entries(entries)){
          const renamed=id===msg.payload.nodeId||id.startsWith(msg.payload.nodeId+'/');
          next[renamed?result.nodeId+id.slice(msg.payload.nodeId.length):id]=value;
        }
        await chrome.storage.local.set({[STORAGE_KEY]:result.md,[NoteActivity.key]:next,knowledge_tree_before_manual_edit:{md:before,createdAt:Date.now()}});
      }
      return {status:'success',...result};
    },sendResponse);return true;
  }
  if(msg.type==='CAPTURE_CONVERSATION'){
    enqueue(async()=>{const result=await handleCapture(msg.payload);await PendingCaptures.discardProcessed(msg.payload);return result;},sendResponse);return true;
  }
  if(msg.type==='GET_TREE'||msg.type==='EXPORT_TREE'){
    getTree().then(md=>sendResponse({md})).catch(error=>sendResponse({error:error.message}));return true;
  }
  if(msg.type==='GET_STATUS'){
    getStatus().then(sendResponse).catch(error=>sendResponse({error:error.message}));return true;
  }
  if(msg.type==='CLEAR_TREE'){
    enqueue(async()=>{await PendingCaptures.clear();await chrome.storage.local.remove([STORAGE_KEY,CaptureState.key,NoteActivity.key,'knowledge_pending_exports','capture_status','knowledge_tree_before_reorganization','knowledge_tree_before_manual_edit','knowledge_tree_undo']);return {success:true};},sendResponse);return true;
  }
});
async function handleCapture(payload,ensureCurrent=async()=>{},commit=task=>task()){
  await ensureCurrent();
  if(!payload||!Array.isArray(payload.messages))throw new Error('未检测到有效对话');
  const messages=payload.messages.filter(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content.trim()).map(({role,content,headings})=>({role,content,headings:Array.isArray(headings)?headings.filter(h=>typeof h==='string').slice(0,24).map(h=>h.slice(0,300)):[]}));
  if(!messages.some(m=>m.role==='assistant'&&m.content.trim().length>=20))throw new Error('请等待 AI 回答完成后再抓取');
  const settingKeys=['intake_tags','jev_api_key','jev_verified','jev_retry_after'];
  const settings=await chrome.storage.local.get(settingKeys),tags=IntakePolicy.normalize(settings.intake_tags);
  const scope=await intakeScope(settings);
  const checkpoint=await CaptureState.prepare(payload.url,messages,scope);
  async function checkPolicy(){await ensureCurrent();const current=await chrome.storage.local.get(settingKeys);if(await intakeScope(current)!==scope)throw Error('收录范围或审核模型在处理期间已修改，请重新抓取');}
  if(checkpoint.unchanged)return {status:'skipped',reason:'没有新增或修改的对话，已跳过（未调用 AI）'};
  let conversation=checkpoint.conversation;
  if(JSON.stringify(conversation).length>120000)throw new Error('本次对话过长，知识树未修改，请分段抓取');
  const currentTree=await getTree(),snapshot=Taxonomy.snapshot(currentTree),outline=Taxonomy.outline(snapshot);
  const brief=CaptureState.brief(conversation);
  const judgment=await Jev.review(settings,brief,tags);
  if(judgment?.decision==='skip'){
    await checkPolicy();await commit(()=>chrome.storage.local.set(CaptureState.update(checkpoint)));
    return {status:'skipped',reason:'Jev 判断本次内容无需收录或不符合收录标签，已跳过'};
  }
  const classification=await classifyConversation(brief,outline,String(payload.title||'').slice(0,300),tags,judgment);
  if(!classification.needs_body_review&&(!classification.is_learning||(tags.length&&!classification.matched_tags.length))){
    await checkPolicy();await commit(()=>chrome.storage.local.set(CaptureState.update(checkpoint)));
    return {status:'skipped',reason:!classification.is_learning?'AI 判断本次内容无需整理为学习笔记':'本次学习内容不符合任何收录标签，已跳过'};
  }
  if(classification.needs_full_context){
    conversation=messages.map((m,i)=>({...m,context_only:i<checkpoint.first}));
    if(JSON.stringify(conversation).length>120000)throw new Error('本次纠错需要的前文过长，未更新处理进度');
  }
  const related=Taxonomy.related(snapshot,classification);
  const sections=await extractKnowledge(conversation,related.filter(note=>Taxonomy.sameSource(note.content,payload.url)),related,tags);
  await checkPolicy();
  const revisited=(sections.revisited||[]).map(id=>snapshot.records.find(r=>r.id===id)?.node.id).filter(Boolean);
  const activityData=await chrome.storage.local.get(NoteActivity.key);
  const previousActivity=activityData[NoteActivity.key]||{};
  const identity={remap:snapshot.records.map(r=>({from:r.node.id,to:r.node.id}))};
  if(!sections.length){
    await commit(()=>chrome.storage.local.set({...CaptureState.update(checkpoint),[NoteActivity.key]:NoteActivity.evolve(previousActivity,identity,revisited)}));
    return {status:'skipped',reason:'没有需要新增或补充的知识'};
  }
  const plan=await planTaxonomy(classification,sections,related,outline);
  const result=Taxonomy.apply(currentTree,classification,sections,related,plan,payload.url);
  await checkPolicy();
  const activity=NoteActivity.evolve(previousActivity,result,revisited);
  if(!result.added&&!result.moved&&!result.updated){
    await commit(()=>chrome.storage.local.set({...CaptureState.update(checkpoint),[NoteActivity.key]:activity}));
    return {status:'skipped',reason:'无新增知识或需要调整的目录'};
  }
  const previous=await chrome.storage.local.get('capture_status');
  const hierarchy=(result.paths[0]||classification.hierarchy).join(' > ');
  await commit(()=>commitLearning(currentTree,result,{
    lastCapture:Date.now(),lastPlatform:payload.platform,lastTitle:payload.title,lastHierarchy:hierarchy,
    newPoints:result.added,updatedNotes:result.updated,reorganizedNotes:result.moved,reorganizationSummary:result.summary,
    totalConversations:(previous.capture_status?.totalConversations||0)+1
  },{...CaptureState.update(checkpoint),[NoteActivity.key]:activity}));
  return {status:'success',hierarchy,newPoints:result.added,updatedNotes:result.updated,reorganizedNotes:result.moved,keywords:classification.keywords||[]};
}
async function intakeScope(settings){
  const base=IntakePolicy.scope(IntakePolicy.normalize(settings.intake_tags));
  return settings.jev_verified&&settings.jev_api_key?base+':jev:'+await CaptureState.hash(settings.jev_api_key):base;
}
async function getStatus(){
  const result=await chrome.storage.local.get('capture_status'),tree=await getTree();
  return {...(result.capture_status||{}),...await PendingCaptures.status(),treeSize:tree.length,treeLines:tree.split('\n').length};
}
chrome.runtime.onInstalled.addListener(()=>initTree().catch(error=>console.warn('[知识树] 初始化失败:',error.message)));

async function startTreeDownload(){
  const md=await getTree(),data=await chrome.storage.local.get(NoteActivity.key);
  const receipts=Object.values(data[NoteActivity.key]||{}).map(({uid,updatedAt})=>({uid,updatedAt}));
  const id=await chrome.downloads.download({url:'data:text/markdown;charset=utf-8,'+encodeURIComponent(md),filename:'knowledge-tree-'+new Date().toISOString().slice(0,10)+'.md',saveAs:true});
  const pending=(await chrome.storage.local.get('knowledge_pending_exports')).knowledge_pending_exports||{};
  pending[id]=receipts;await chrome.storage.local.set({knowledge_pending_exports:pending});
  await settleExport(id);
  return {status:'success'};
}
async function settleExport(id){
  const data=await chrome.storage.local.get(['knowledge_pending_exports',NoteActivity.key]);
  const pending=data.knowledge_pending_exports||{};if(!pending[id])return;
  const [download]=await chrome.downloads.search({id:Number(id)});
  if(download&&download.state==='in_progress')return;
  const update={};
  if(download?.state==='complete')update[NoteActivity.key]=NoteActivity.read(data[NoteActivity.key]||{},pending[id]);
  delete pending[id];update.knowledge_pending_exports=pending;await chrome.storage.local.set(update);
}
chrome.downloads.onChanged.addListener(delta=>{
  if(delta.state)enqueue(()=>settleExport(delta.id),()=>{});
});
// Finish receipts even if the preview/popup closed or the worker restarted.
enqueue(async()=>{const data=await chrome.storage.local.get('knowledge_pending_exports');for(const id of Object.keys(data.knowledge_pending_exports||{}))await settleExport(id);},()=>{});

PendingCaptures.init((payload,guard,commit)=>enqueue(()=>handleCapture(payload,guard,commit),()=>{}));
