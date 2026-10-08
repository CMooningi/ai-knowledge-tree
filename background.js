// Capture, classification and automatic reorganization share a serialized write queue.
// Report the executing code version, even when a new popup meets a cached worker.
const BACKGROUND_VERSION = '1.4.0';
importScripts('dev-log.js', 'model-config.js', 'model-transport.js', 'preview/model.js', 'taxonomy.js', 'preview/editor-model.js', 'tree-actions.js', 'capture-state.js', 'pending-captures.js', 'note-activity.js', 'intake-policy.js', 'jev-client.js', 'deepseek-client.js', 'knowledge-tree.js');
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
  if(msg.type==='SAVE_LLM_CONFIG'||msg.type==='TEST_LLM_CONFIG'){
    enqueue(async()=>{
      const provider=msg.provider||'deepseek',key=ModelConfig.key(msg.key);
      DevLog.secret(key);
      const values=provider==='openrouter'?{llm_provider:provider,openrouter_api_key:key,openrouter_model:msg.model}:{llm_provider:provider,deepseek_api_key:key,deepseek_model:msg.model};
      const config=ModelConfig.llm(values),trace=DevLog.start(msg.type==='TEST_LLM_CONFIG'?'测试笔记模型':'保存笔记模型',{provider,model:config.model});
      try{
        if(msg.type==='TEST_LLM_CONFIG'){
          const result=await chatJson([{role:'user',content:'Return only this JSON object: {"ok":true}'}],'连接测试',128,trace,config);
          if(result?.ok!==true)throw Error('模型未通过 JSON 输出测试，请检查所选模型是否支持结构化输出');
        }else{
          if(provider==='openrouter')values.openrouter_model=config.model;else values.deepseek_model=config.model;
          await chrome.storage.local.set(values);
        }
        trace.end('完成',{provider,model:config.model});return {status:'success',provider,model:config.model};
      }catch(error){trace.error(error);throw error;}
    },sendResponse);return true;
  }
  if(msg.type==='SAVE_JEV_KEY'){
    enqueue(async()=>{
      const key=ModelConfig.key(msg.key),provider=msg.provider||'typesafe';
      DevLog.secret(key);
      const settings={jev_provider:provider,jev_openrouter_model:msg.model};
      const config=ModelConfig.jev(settings),trace=DevLog.start('验证并保存 Jev',{provider,model:config.model});
      try{
        await Jev.verify(key,settings,trace);
        const values={jev_provider:provider,jev_verified:true,jev_retry_after:0,jev_status:{state:'active',message:'验证成功：Jev 已用于收录预审（'+(provider==='openrouter'?'OpenRouter':'TypeSafe')+'）',at:Date.now()}};
        if(provider==='openrouter'){values.jev_openrouter_api_key=key;values.jev_openrouter_model=config.model;}else values.jev_api_key=key;
        await chrome.storage.local.set(values);
        trace.end('Jev 已启用',{provider,model:config.model});return {status:'success'};
      }catch(error){trace.error(error);throw error;}
    },sendResponse);return true;
  }
  if(msg.type==='REMOVE_JEV_KEY'){
    enqueue(async()=>{await chrome.storage.local.remove([...ModelConfig.jevKeys,'jev_status']);return {status:'success'};},sendResponse);return true;
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
async function handleCapture(payload,ensureCurrent=async()=>{},commit=task=>task(),source='手动抓取'){
  const trace=DevLog.start(source,{platform:payload?.platform,messageCount:payload?.messages?.length});
  try{const result=await processCapture(payload,ensureCurrent,commit,trace);trace.end(result.status==='success'?'已写入知识树':'跳过处理',result);return result;}
  catch(error){trace.error(error);throw error;}
}
async function processCapture(payload,ensureCurrent,commit,trace){
  await ensureCurrent();
  if(!payload||!Array.isArray(payload.messages))throw new Error('未检测到有效对话');
  const messages=payload.messages.filter(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content.trim()).map(({role,content,headings})=>({role,content,headings:Array.isArray(headings)?headings.filter(h=>typeof h==='string').slice(0,24).map(h=>h.slice(0,300)):[]}));
  if(!messages.some(m=>m.role==='assistant'&&m.content.trim().length>=20))throw new Error('请等待 AI 回答完成后再抓取');
  const settingKeys=['intake_tags',...ModelConfig.jevKeys,...ModelConfig.llmKeys];
  const settings=await chrome.storage.local.get(settingKeys),tags=IntakePolicy.normalize(settings.intake_tags);
  const scope=await intakeScope(settings),modelBefore=JSON.stringify(ModelConfig.llm(settings));
  trace.step('01 检查本地增量',{tags,jevProvider:settings.jev_provider||'typesafe',llmProvider:settings.llm_provider||'deepseek'});
  const checkpoint=await CaptureState.prepare(payload.url,messages,scope);
  async function checkPolicy(){await ensureCurrent();const current=await chrome.storage.local.get(settingKeys);if(await intakeScope(current)!==scope||JSON.stringify(ModelConfig.llm(current))!==modelBefore)throw Error('收录范围或审核模型在处理期间已修改，请重新抓取');}
  if(checkpoint.unchanged)return {status:'skipped',reason:'没有新增或修改的对话，已跳过（未调用 AI）'};
  let conversation=checkpoint.conversation;
  trace.step('02 找到新增或修改的消息',{firstChanged:checkpoint.first,contextCount:conversation.filter(m=>m.context_only).length,messageCount:conversation.length});
  if(JSON.stringify(conversation).length>120000)throw new Error('本次对话过长，知识树未修改，请分段抓取');
  const currentTree=await getTree(),snapshot=Taxonomy.snapshot(currentTree),outline=Taxonomy.outline(snapshot);
  const brief=CaptureState.brief(conversation);
  const judgment=await Jev.review(settings,brief,tags,trace);
  if(judgment?.decision==='skip'){
    await checkPolicy();await commit(()=>chrome.storage.local.set(CaptureState.update(checkpoint)));
    return {status:'skipped',reason:'Jev 判断本次内容无需收录或不符合收录标签，已跳过'};
  }
  trace.step('03 轻量分类 → 只发送问题和回答标题',{briefMessages:brief.length});
  const classification=await classifyConversation(brief,outline,String(payload.title||'').slice(0,300),tags,judgment,trace);
  if(!classification.needs_body_review&&(!classification.is_learning||(tags.length&&!classification.matched_tags.length))){
    await checkPolicy();await commit(()=>chrome.storage.local.set(CaptureState.update(checkpoint)));
    return {status:'skipped',reason:!classification.is_learning?'AI 判断本次内容无需整理为学习笔记':'本次学习内容不符合任何收录标签，已跳过'};
  }
  if(classification.needs_full_context){
    trace.step('分类要求补充完整前文',{messageCount:messages.length});
    conversation=messages.map((m,i)=>({...m,context_only:i<checkpoint.first}));
    if(JSON.stringify(conversation).length>120000)throw new Error('本次纠错需要的前文过长，未更新处理进度');
  }
  const related=Taxonomy.related(snapshot,classification);
  trace.step('04 总结与去重 → 新增正文和相关旧笔记',{relatedNotes:related.length});
  const comparisons=related.map(note=>({...note,mergeable:Taxonomy.canMerge(note,classification.technology,payload.url)}));
  const sections=await extractKnowledge(conversation,related.filter(note=>Taxonomy.sameSource(note.content,payload.url)),comparisons,tags,trace,classification);
  await checkPolicy();
  const revisited=(sections.revisited||[]).map(id=>snapshot.records.find(r=>r.id===id)?.node.id).filter(Boolean);
  const activityData=await chrome.storage.local.get(NoteActivity.key);
  const previousActivity=activityData[NoteActivity.key]||{};
  const identity={remap:snapshot.records.map(r=>({from:r.node.id,to:r.node.id}))};
  if(!sections.length){
    await commit(()=>chrome.storage.local.set({...CaptureState.update(checkpoint),[NoteActivity.key]:NoteActivity.evolve(previousActivity,identity,revisited)}));
    return {status:'skipped',reason:'没有需要新增或补充的知识'};
  }
  trace.step('05 自动分层',{sections:sections.length,revisited:revisited.length});
  const plan=await planTaxonomy(classification,sections,related,outline,trace);
  const result=Taxonomy.apply(currentTree,classification,sections,related,plan,payload.url);
  await checkPolicy();
  const activity=NoteActivity.evolve(previousActivity,result,revisited);
  if(!result.added&&!result.moved&&!result.updated&&!result.reordered){
    await commit(()=>chrome.storage.local.set({...CaptureState.update(checkpoint),[NoteActivity.key]:activity}));
    return {status:'skipped',reason:'无新增知识或需要调整的目录'};
  }
  const previous=await chrome.storage.local.get('capture_status');
  const hierarchy=(result.paths[0]||classification.hierarchy).join(' > ');
  trace.step('06 校验完成 → 保存知识树',{added:result.added,updated:result.updated,moved:result.moved,reordered:result.reordered,paths:result.paths});
  await commit(()=>commitLearning(currentTree,result,{
    lastCapture:Date.now(),lastPlatform:payload.platform,lastTitle:payload.title,lastHierarchy:hierarchy,
    newPoints:result.added,updatedNotes:result.updated,reorganizedNotes:result.moved,reorderedDirectories:result.reordered,reorganizationSummary:result.summary,
    totalConversations:(previous.capture_status?.totalConversations||0)+1
  },{...CaptureState.update(checkpoint),[NoteActivity.key]:activity}));
  return {status:'success',hierarchy,newPoints:result.added,updatedNotes:result.updated,reorganizedNotes:result.moved,reorderedDirectories:result.reordered,keywords:classification.keywords||[]};
}
async function intakeScope(settings){
  const base=IntakePolicy.scope(IntakePolicy.normalize(settings.intake_tags));
  const config=ModelConfig.jev(settings);
  if(!settings.jev_verified||!config.key)return base;
  const source=config.provider==='typesafe'?'':config.provider+':'+config.model+':';
  return base+':jev:'+source+await CaptureState.hash(config.key);
}
async function getStatus(){
  const result=await chrome.storage.local.get('capture_status'),tree=await getTree();
  return {...(result.capture_status||{}),...await PendingCaptures.status(),backgroundVersion:BACKGROUND_VERSION,treeSize:tree.length,treeLines:tree.split('\n').length};
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

PendingCaptures.init((payload,guard,commit)=>enqueue(()=>handleCapture(payload,guard,commit,'空闲自动处理'),()=>{}));
