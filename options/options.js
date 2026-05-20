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
    'notify_on_capture'
  ]);

  if (result.deepseek_api_key) {
    document.getElementById('apiKey').value = result.deepseek_api_key;
  }
  if (result.deepseek_model) {
    document.getElementById('modelSelect').value = result.deepseek_model;
  }
  document.getElementById('autoCapture').checked = result.auto_capture !== false;
  document.getElementById('notifyOnCapture').checked = result.notify_on_capture !== false;
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
  document.getElementById('btnViewTree').addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({ type: 'GET_TREE' });
    if (result.md) {
      const url = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(result.md);
      chrome.tabs.create({ url });
    }
  });

  // Export tree
  document.getElementById('btnExportTree').addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({ type: 'EXPORT_TREE' });
    if (result.md) {
      const url = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(result.md);
      const timestamp = new Date().toISOString().split('T')[0];
      chrome.downloads.download({
        url,
        filename: `knowledge-tree-${timestamp}.md`,
        saveAs: true
      });
    }
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
