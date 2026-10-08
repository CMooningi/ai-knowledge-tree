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
  if(status.pendingError){
    dot.classList.add('error');text.textContent='待处理：'+status.pendingError;
  }else if(status.pendingCount){
    text.textContent=`${status.pendingCount} 个对话${status.pendingPaused?'已暂存，自动整理已关闭':'已暂存，等待自动整理'}`;
  }else if (status.lastCapture && Date.now() - status.lastCapture < 60000) {
    dot.classList.add('active');
    text.textContent = '最近已抓取';
  }
}

function setupButtons() {
  document.getElementById('btnPreview').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('preview/preview.html') });
  });
  document.getElementById('btnExport').addEventListener('click', async () => {
    try{const result=await chrome.runtime.sendMessage({type:'DOWNLOAD_TREE'});if(result?.error)throw Error(result.error);}
    catch(error){showToast('导出未完成：'+error.message);}
  });

  document.getElementById('btnCapture').addEventListener('click', async () => {
    const btn = document.getElementById('btnCapture');
    btn.textContent = '⏳ 正在整理…';
    btn.disabled = true;
    document.getElementById('statusText').textContent = '正在处理当前对话，无需等待五分钟';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'MANUAL_CAPTURE' });

      if (!response) {
        document.getElementById('statusText').textContent = '当前页面未检测到 AI 对话';
        showToast('当前页面未检测到 AI 对话');
        return;
      }

      if (response.status === 'success') {
        showToast(`✅ 新增 ${response.newPoints} 篇笔记` + (response.updatedNotes ? `，更新 ${response.updatedNotes} 篇旧笔记` : '') + (response.reorganizedNotes ? `，自动归类 ${response.reorganizedNotes} 条旧笔记` : ''));
        loadStatus();
      } else if (response.status === 'skipped') {
        document.getElementById('statusText').textContent = response.reason;
        showToast(`⏭️ ${response.reason}`);
      } else {
        document.getElementById('statusText').textContent = '抓取未完成：'+(response.error || '未知错误');
        showToast(`❌ ${response.error || '未知错误'}`);
      }
    } catch (err) {
      document.getElementById('statusText').textContent = '抓取未完成，请刷新 AI 页面后重试';
      showToast(/Receiving end does not exist|Could not establish connection/i.test(err.message)
        ? '❌ 请先重新加载扩展，再刷新支持的 AI 聊天页面'
        : `❌ 抓取失败: ${err.message}`);
    } finally {
      btn.textContent = '📸 立即抓取';
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
