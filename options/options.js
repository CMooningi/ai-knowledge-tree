// AI Knowledge Tree — Options Page Script
const providerDrafts={llm:{},jev:{}};
let visibleLlm='deepseek',visibleJev='typesafe';
function rememberProvider(kind){
  if(kind==='llm')providerDrafts.llm[visibleLlm]={key:document.getElementById('apiKey').value,model:document.getElementById(visibleLlm==='openrouter'?'openrouterModel':'modelSelect').value};
  else providerDrafts.jev[visibleJev]={key:document.getElementById('jevApiKey').value,model:document.getElementById('jevModel').value};
}
function renderProvider(kind){
  if(kind==='llm'){
    visibleLlm=document.getElementById('llmProvider').value;
    const router=visibleLlm==='openrouter',draft=providerDrafts.llm[visibleLlm]||{};
    document.getElementById('apiKey').value=draft.key||'';
    document.getElementById('apiKey').type='password';
    document.getElementById('llmKeyLabel').textContent=router?'OpenRouter API Key':'DeepSeek API Key';
    document.getElementById('deepseekModelRow').hidden=router;
    document.getElementById('openrouterModelRow').hidden=!router;
    document.getElementById(router?'openrouterModel':'modelSelect').value=draft.model||(router?'':'deepseek-chat');
  }else{
    visibleJev=document.getElementById('jevProvider').value;
    const router=visibleJev==='openrouter',draft=providerDrafts.jev[visibleJev]||{};
    document.getElementById('jevApiKey').value=draft.key||'';
    document.getElementById('jevApiKey').type='password';document.getElementById('btnToggleJevKey').textContent='显示';
    document.getElementById('jevApiKey').placeholder=router?'填写你的 OpenRouter API Key':'填写你的 TypeSafe API Key';
    document.getElementById('jevKeyLabel').textContent=router?'OpenRouter API Key':'TypeSafe 官方 API Key';
    document.getElementById('jevModelRow').hidden=!router;
    document.getElementById('jevModel').value=draft.model||'typesafe/jev-1.13';
  }
}
function busy(kind,value){
  const ids=kind==='jev'?['jevProvider','jevApiKey','jevModel','btnSaveJev','btnRemoveJev']:['llmProvider','apiKey','modelSelect','openrouterModel','btnSaveKey','btnTestKey'];
  ids.forEach(id=>document.getElementById(id).disabled=value);
}
async function configureLlm(test){
  const provider=document.getElementById('llmProvider').value;
  const key=document.getElementById('apiKey').value.trim(),model=document.getElementById(provider==='openrouter'?'openrouterModel':'modelSelect').value.trim();
  if(!key||!model){showTestResult('请填写 API Key 和模型 ID','error');return;}
  rememberProvider('llm');busy('llm',true);showTestResult(test?'正在测试所选模型…':'正在保存…','success');
  try{
    const result=await chrome.runtime.sendMessage({type:test?'TEST_LLM_CONFIG':'SAVE_LLM_CONFIG',provider,key,model});
    if(result?.status!=='success')throw Error(result?.error||'后台未返回结果');
    showTestResult(test?'连接与 JSON 输出测试通过；如需启用请保存配置':'已保存：'+(provider==='openrouter'?'OpenRouter':'DeepSeek')+' / '+model,'success');
  }catch(error){showTestResult(error.message,'error');}finally{busy('llm',false);}
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadTreeStats();
  setupEventListeners();
});

async function loadSettings() {
  const result = await chrome.storage.local.get([
    'deepseek_api_key',
    'deepseek_model',
    'auto_capture',
    'notify_on_capture',
    'intake_tags','jev_api_key','jev_verified','jev_status','jev_provider','jev_openrouter_api_key','jev_openrouter_model',
    'llm_provider','openrouter_api_key','openrouter_model'
  ]);

  providerDrafts.llm.deepseek={key:result.deepseek_api_key||'',model:result.deepseek_model||'deepseek-chat'};
  providerDrafts.llm.openrouter={key:result.openrouter_api_key||'',model:result.openrouter_model||''};
  providerDrafts.jev.typesafe={key:result.jev_api_key||''};
  providerDrafts.jev.openrouter={key:result.jev_openrouter_api_key||'',model:result.jev_openrouter_model||'typesafe/jev-1.13'};
  document.getElementById('llmProvider').value=result.llm_provider||'deepseek';
  document.getElementById('jevProvider').value=result.jev_provider||'typesafe';
  renderProvider('llm');renderProvider('jev');
  document.getElementById('autoCapture').checked = result.auto_capture !== false;
  document.getElementById('notifyOnCapture').checked = result.notify_on_capture !== false;
  document.getElementById('intakeTags').value = IntakePolicy.normalize(result.intake_tags).join('，');
  showJevStatus(result.jev_status?.message||(result.jev_verified?'Jev 已启用':'未配置 Jev，当前使用笔记模型审核'),result.jev_status?.state==='fallback');
}

async function loadTreeStats() {
  const result = await chrome.runtime.sendMessage({ type: 'GET_TREE' });
  if (result && result.md) {
    document.getElementById('treeSize').textContent =
      `${(result.md.length / 1024).toFixed(1)} KB`;
    document.getElementById('treeLines').textContent =
      `${result.md.split('\n').length} 行`;
  }
}

function setupEventListeners() {
  document.getElementById('llmProvider').addEventListener('change',()=>{rememberProvider('llm');renderProvider('llm');showTestResult('当前仅切换填写区域；保存后才改变实际调用渠道','success');});
  document.getElementById('jevProvider').addEventListener('change',()=>{rememberProvider('jev');renderProvider('jev');showJevStatus('当前仅切换填写区域；验证并保存后生效');});
  document.getElementById('btnToggleJevKey').addEventListener('click',()=>{const input=document.getElementById('jevApiKey');input.type=input.type==='password'?'text':'password';document.getElementById('btnToggleJevKey').textContent=input.type==='password'?'显示':'隐藏';});
  document.getElementById('btnSaveJev').addEventListener('click',async()=>{
    rememberProvider('jev');busy('jev',true);showJevStatus('正在验证 Jev…');
    try{const response=await chrome.runtime.sendMessage({type:'SAVE_JEV_KEY',key:document.getElementById('jevApiKey').value.trim(),provider:document.getElementById('jevProvider').value,model:document.getElementById('jevModel').value.trim()});if(response?.error||response?.status!=='success')throw Error(response?.error||'后台没有返回验证结果');showJevStatus('验证成功：已启用 Jev 收录预审');}
    catch(error){showJevStatus(error.message+'；未更改已保存的配置',true);}
    finally{busy('jev',false);}
  });
  document.getElementById('btnRemoveJev').addEventListener('click',async()=>{
    busy('jev',true);try{const response=await chrome.runtime.sendMessage({type:'REMOVE_JEV_KEY'});if(response?.error)throw Error(response.error);providerDrafts.jev={};document.getElementById('jevApiKey').value='';showJevStatus('已移除 Jev 密钥，使用笔记模型审核');}
    catch(error){showJevStatus(error.message,true);}finally{busy('jev',false);}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.jev_status){const status=changes.jev_status.newValue;showJevStatus(status?.message||'未配置 Jev，当前使用笔记模型审核',status?.state==='fallback');}});
  document.getElementById('btnSaveIntake').addEventListener('click',async()=>{
    const result=document.getElementById('intakeResult');
    try{
      const tags=IntakePolicy.normalize(document.getElementById('intakeTags').value);
      await chrome.storage.local.set({intake_tags:tags});
      document.getElementById('intakeTags').value=tags.join('，');
      result.textContent=tags.length?'已保存：符合任意一个标签的学习知识才会收录。':'已保存：不限主题，由 AI 判断是否值得记录。';
      result.className='test-result success';
    }catch(error){result.textContent=error.message;result.className='test-result error';}
  });
  document.getElementById('backLink').addEventListener('click', (e) => {
    e.preventDefault();
    window.close();
  });

  // Toggle API key visibility
  document.getElementById('btnToggleKey').addEventListener('click', () => {
    const input = document.getElementById('apiKey');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('btnSaveKey').addEventListener('click',()=>configureLlm(false));
  document.getElementById('btnTestKey').addEventListener('click',()=>configureLlm(true));

  // View tree
  document.getElementById('btnViewTree').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('preview/preview.html') });
  });
  // Export tree
  document.getElementById('btnExportTree').addEventListener('click', async () => {
    try{const result=await chrome.runtime.sendMessage({type:'DOWNLOAD_TREE'});if(result?.error)throw Error(result.error);}
    catch(error){showTestResult('导出未完成：'+error.message,'error');}
  });

  // Clear tree
  document.getElementById('btnClearTree').addEventListener('click', async () => {
    if (confirm('确定要清空整个知识树吗？此操作不可恢复。')) {
      await chrome.runtime.sendMessage({ type: 'CLEAR_TREE' });
      loadTreeStats();
      showTestResult('🗑️ 知识树已清空', 'success');
    }
  });

  // Save auto capture settings
  document.getElementById('btnSaveSettings').addEventListener('click', async () => {
    await chrome.storage.local.set({
      auto_capture: document.getElementById('autoCapture').checked,
      notify_on_capture: document.getElementById('notifyOnCapture').checked
    });
    showTestResult('✅ 设置已保存', 'success');
  });
}

function showTestResult(message, type) {
  const el = document.getElementById('testResult');
  el.textContent = message;
  el.className = 'test-result ' + type;
}
function showJevStatus(message,error=false){const el=document.getElementById('jevResult');el.textContent=message;el.className='test-result '+(error?'error':'success');}
