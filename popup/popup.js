// AI Knowledge Tree — Popup Script

document.addEventListener('DOMContentLoaded', () => {
  loadStatus();
  setupButtons();
});

async function loadStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    updateUI(status);
  } catch (err) {
    document.getElementById('statusText').textContent = '请刷新 AI 页面';
    document.getElementById('statusDot').classList.add('error');
  }
}

function updateUI(status) {
  if (!status) return;

  document.getElementById('treeLines').textContent = status.treeLines || 0;
  document.getElementById('captureCount').textContent = status.totalConversations || 0;
  document.getElementById('lastPoints').textContent = status.newPoints || '-';

  if (status.lastCapture) {
    document.getElementById('lastCapture').style.display = 'block';
    document.getElementById('lastTitle').textContent = status.lastTitle || '';
    document.getElementById('lastHierarchy').textContent = status.lastHierarchy || '';
  }

  // Update status dot
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (status.lastCapture && Date.now() - status.lastCapture < 60000) {
    dot.classList.add('active');
    text.textContent = '最近已抓取';
  }
}

function setupButtons() {
  document.getElementById('btnPreview').addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({ type: 'GET_TREE' });
    if (result.md) {
      // Open preview in new tab
      const blob = new Blob([result.md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      chrome.tabs.create({ url });
    }
  });

  document.getElementById('btnExport').addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({ type: 'EXPORT_TREE' });
    if (result.md) {
      const blob = new Blob([result.md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().split('T')[0];
      chrome.downloads.download({
        url,
        filename: `knowledge-tree-${timestamp}.md`,
        saveAs: true
      });
    }
  });

  document.getElementById('btnCapture').addEventListener('click', async () => {
    const btn = document.getElementById('btnCapture');
    btn.textContent = '⏳ 抓取中...';
    btn.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'MANUAL_CAPTURE' });

      if (!result) {
        showToast('当前页面未检测到 AI 对话');
        return;
      }

      // Send to background for processing
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_CONVERSATION',
        payload: {
          ...result,
          newMessages: result.messages
        }
      });

      if (response.status === 'success') {
        showToast(`✅ 新增 ${response.newPoints} 个知识点`);
        loadStatus();
      } else if (response.status === 'skipped') {
        showToast(`⏭️ ${response.reason}`);
      } else {
        showToast(`❌ ${response.error || '未知错误'}`);
      }
    } catch (err) {
      showToast(`❌ 抓取失败: ${err.message}`);
    } finally {
      btn.textContent = '📸 手动抓取';
      btn.disabled = false;
    }
  });

  document.getElementById('btnSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('btnClear').addEventListener('click', async () => {
    if (confirm('确定要清空整个知识树吗？此操作不可恢复。')) {
      await chrome.runtime.sendMessage({ type: 'CLEAR_TREE' });
      showToast('知识树已清空');
      loadStatus();
    }
  });
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 12px;
    left: 16px;
    right: 16px;
    background: #333;
    color: #fff;
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 13px;
    text-align: center;
    z-index: 1000;
    animation: fadeIn 0.3s ease;
  `;

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
