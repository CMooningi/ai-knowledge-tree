// AI Knowledge Tree — Options Page Script

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
    'intake_tags','jev_api_key','jev_verified','jev_status'
  ]);

  if (result.deepseek_api_key) {
    document.getElementById('apiKey').value = result.deepseek_api_key;
  }
  if (result.deepseek_model) {
    document.getElementById('modelSelect').value = result.deepseek_model;
  }
  document.getElementById('autoCapture').checked = result.auto_capture !== false;
  document.getElementById('notifyOnCapture').checked = result.notify_on_capture !== false;
  document.getElementById('intakeTags').value = IntakePolicy.normalize(result.intake_tags).join('，');
  document.getElementById('jevApiKey').value=result.jev_api_key||'';
  showJevStatus(result.jev_status?.message||(result.jev_verified?'Jev 已启用':'未配置 Jev，当前使用 DeepSeek 审核'),result.jev_status?.state==='fallback');
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
  document.getElementById('btnToggleJevKey').addEventListener('click',()=>{const input=document.getElementById('jevApiKey');input.type=input.type==='password'?'text':'password';document.getElementById('btnToggleJevKey').textContent=input.type==='password'?'显示':'隐藏';});
  document.getElementById('btnSaveJev').addEventListener('click',async()=>{
    const button=document.getElementById('btnSaveJev'),remove=document.getElementById('btnRemoveJev');button.disabled=true;remove.disabled=true;showJevStatus('正在验证 Jev…');
    try{const response=await chrome.runtime.sendMessage({type:'SAVE_JEV_KEY',key:document.getElementById('jevApiKey').value.trim()});if(response?.error||response?.status!=='success')throw Error(response?.error||'后台没有返回验证结果');showJevStatus('验证成功：已启用 Jev 收录预审');}
    catch(error){showJevStatus(error.message+'；未更改已保存的配置',true);}
    finally{button.disabled=false;remove.disabled=false;}
  });
  document.getElementById('btnRemoveJev').addEventListener('click',async()=>{
    try{const response=await chrome.runtime.sendMessage({type:'REMOVE_JEV_KEY'});if(response?.error)throw Error(response.error);document.getElementById('jevApiKey').value='';showJevStatus('已移除 Jev 密钥，使用 DeepSeek 审核');}
    catch(error){showJevStatus(error.message,true);}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.jev_status){const status=changes.jev_status.newValue;showJevStatus(status?.message||'未配置 Jev，当前使用 DeepSeek 审核',status?.state==='fallback');}});
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

  // Save API key
  document.getElementById('btnSaveKey').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    const model = document.getElementById('modelSelect').value;

    if (!apiKey) {
      showTestResult('请输入 API Key', 'error');
      return;
    }

    await chrome.storage.local.set({
      deepseek_api_key: apiKey,
      deepseek_model: model
    });
    showTestResult('✅ API Key 已保存', 'success');
  });

  // Test API connection
  document.getElementById('btnTestKey').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    if (!apiKey) {
      showTestResult('请先输入 API Key', 'error');
      return;
    }

    showTestResult('⏳ 测试中...', 'success');

    try {
      const response = await fetch('https://api.deepseek.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });

      if (response.ok) {
        const data = await response.json();
        showTestResult(
          `✅ 连接成功！可用模型: ${data.data?.length || 'N/A'} 个`,
          'success'
        );
      } else {
        const err = await response.text();
        showTestResult(`❌ 连接失败: ${response.status}`, 'error');
      }
    } catch (err) {
      showTestResult(`❌ 网络错误: ${err.message}`, 'error');
    }
  });

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
