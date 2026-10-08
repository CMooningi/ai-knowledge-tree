// AI Knowledge Tree — Popup Script
const POPUP_VERSION = '1.3.2';
let latestStatus, statusLoading = false, manualBusy = false;

document.addEventListener('DOMContentLoaded', () => {
  loadStatus();
  setupButtons();
  setInterval(loadStatus, 5000);
  setInterval(() => { if(latestStatus&&!manualBusy)updateUI(latestStatus); }, 1000);
});

async function loadStatus() {
  if(statusLoading||manualBusy)return;
  statusLoading=true;
  try {
    const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if(!status||status.error)throw Error(status?.error||'后台未返回状态');
    if(!manualBusy){latestStatus=status;updateUI(status);}
  } catch (err) {
    if(!manualBusy){latestStatus=null;document.getElementById('statusText').textContent = '无法读取后台状态，请重新加载扩展';
    document.getElementById('statusDot').classList.add('error');}
  } finally {statusLoading=false;}
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
  const detail = document.getElementById('statusDetail');
  const oldWorker=status.backgroundVersion!==POPUP_VERSION;
  document.getElementById('versionText').textContent=status.backgroundVersion?'v'+status.backgroundVersion:'后台待更新';
  dot.classList.remove('error','active');
  const seconds=Math.max(0,Math.ceil(((status.pendingNextAt||0)-Date.now())/1000));
  const remaining=`${Math.floor(seconds/60)}分${String(seconds%60).padStart(2,'0')}秒`;
  const retryTime=status.pendingNextAt?new Date(status.pendingNextAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'';
  if(status.pendingState==='paused'||status.pendingPaused&&status.pendingCount){
    text.textContent=`${status.pendingCount} 个对话已暂存，自动整理已关闭`;
  }else if(status.pendingState==='processing'){
    dot.classList.add('active');text.textContent=`${status.pendingProcessing} 个对话正在处理或排队，等待模型返回`;
  }else if(status.pendingState==='retry'){
    dot.classList.add('error');text.textContent=seconds?`处理失败 ${status.pendingRetryCount} 次，预计 ${retryTime} 重试（${remaining}）`:'重试时间已到，等待后台执行';
  }else if(status.pendingError){
    dot.classList.add('error');text.textContent=status.pendingState==='cache-error'?'对话缓存失败，请保持对话页面打开':'处理未完成，请查看下方错误';
  }else if(status.pendingCount){
    text.textContent=seconds?`${status.pendingCount} 个对话已暂存，约 ${remaining} 后自动处理`:'空闲时间已满，等待后台执行';
  }else if (status.lastCapture && Date.now() - status.lastCapture < 60000) {
    dot.classList.add('active');
    text.textContent = '最近已抓取';
  }else{
    text.textContent='就绪，没有待处理对话';
  }
  const details=[oldWorker?'后台尚未加载当前版本。请在扩展管理页点击重新加载，再刷新 AI 对话页面。':'',status.pendingError?'最近错误：'+status.pendingError:''];
  detail.textContent=details.filter(Boolean).join('\n');detail.hidden=!detail.textContent;
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
    manualBusy = true;
    latestStatus = null;
    document.getElementById('statusDot').classList.remove('error');
    document.getElementById('statusDetail').hidden = true;
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
        manualBusy=false;await loadStatus();
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
      manualBusy=false;
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
