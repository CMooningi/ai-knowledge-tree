(() => {
  let session=null,busy=false;
  const dialog=$('note-editor');
  const dirty=()=>session&&($('note-title').value!==session.title||$('note-content').value!==session.content);
  function updateCount(){ $('editor-count').textContent=$('note-content').value.length+' 字符'+(dirty()?' · 未保存':''); }
  function mode(preview){
    $('note-content').hidden=preview;$('format-tools').hidden=preview;$('note-preview').hidden=!preview;
    $('tab-write').setAttribute('aria-pressed',!preview);$('tab-preview').setAttribute('aria-pressed',preview);
    if(preview){$('note-preview').replaceChildren();renderMarkdown($('note-content').value.split('\n'),$('note-preview'));}
  }
  function close(){
    if(busy)return;
    if(dirty()&&!confirm('有尚未保存的修改，确定放弃吗？'))return;
    session=null;dialog.close();
  }
  globalThis.openNoteEditor=node=>{
    if(!node||node===model.root||node.children.length||busy||dialog.open)return;
    const content=NoteEditor.split(node.body).content;
    session={nodeId:node.id,baseMd:markdown,title:node.title,content};
    $('editor-heading').textContent='编辑笔记';
    $('editor-path').textContent=M.path(node).map(n=>n.title).join(' / ');
    $('note-title').value=node.title;$('note-content').value=content;$('editor-error').textContent='';
    updateCount();mode(false);dialog.showModal();$('note-content').focus();
  };
  $('tab-write').onclick=()=>mode(false);$('tab-preview').onclick=()=>mode(true);
  $('note-title').oninput=updateCount;$('note-content').oninput=updateCount;
  function insert(before,after=''){
    const input=$('note-content'),start=input.selectionStart,end=input.selectionEnd;
    input.setRangeText(before+input.value.slice(start,end)+after,start,end,'end');input.focus();updateCount();
  }
  $('format-heading').onclick=()=>insert('\n## ');
  $('format-star').onclick=()=>insert('⭐ ');
  $('format-code').onclick=()=>insert('\n```\n','\n```\n');
  $('editor-close').onclick=close;$('editor-cancel').onclick=close;
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();if(!busy)$('note-form').requestSubmit();}
  });
  window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
  $('note-form').onsubmit=async event=>{
    event.preventDefault();if(!session||busy)return;
    busy=true;$('editor-save').disabled=true;$('editor-save').textContent='保存中…';$('editor-error').textContent='';
    const payload={...session,title:$('note-title').value,content:$('note-content').value};
    // Freeze the submitted fields so typing during a queued save cannot be silently lost.
    $('note-title').readOnly=true;$('note-content').readOnly=true;
    for(const id of ['format-heading','format-star','format-code'])$(id).disabled=true;
    try{
      const response=await chrome.runtime.sendMessage({type:'SAVE_NOTE',payload});
      if(response?.status!=='success')throw new Error(response?.error||'未收到保存结果，请保留输入并刷新确认');
      session=null;dialog.close();load(response.md);const node=model.nodes.find(n=>n.id===response.nodeId);if(node)choose(node);
      notify(response.changed?'修改已保存':'内容没有变化');
    }catch(error){$('editor-error').textContent=error.message;}
    finally{busy=false;$('editor-save').disabled=false;$('editor-save').textContent='保存修改';$('note-title').readOnly=false;$('note-content').readOnly=false;for(const id of ['format-heading','format-star','format-code'])$(id).disabled=false;updateCount();}
  };
})();
