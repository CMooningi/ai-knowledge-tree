(() => {
  const menu=$('node-menu');let target=null,origin=null,busy=false;
  function close(restore=false){menu.hidden=true;target=null;if(restore)origin?.focus?.();}
  function open(event,element){
    if(busy||$('note-editor').open)return;
    const node=model?.nodes.find(n=>n.id===element.dataset.actionNodeId);if(!node)return;
    event.preventDefault();origin=element;target={node,baseMd:markdown};
    $('node-menu-title').textContent=node.title;
    $('node-menu-edit').hidden=node===model.root||node.children.length>0;
    $('node-menu-delete').textContent=node===model.root?'删除全部知识':node.children.length?'删除目录及下级内容':'删除笔记';
    menu.hidden=false;
    const rect=element.getBoundingClientRect();
    const x=event.type==='contextmenu'?event.clientX:rect.left;
    const y=event.type==='contextmenu'?event.clientY:rect.bottom;
    menu.style.left=Math.max(8,Math.min(x,window.innerWidth-menu.offsetWidth-8))+'px';
    menu.style.top=Math.max(8,Math.min(y,window.innerHeight-menu.offsetHeight-8))+'px';
    ($('node-menu-edit').hidden?$('node-menu-delete'):$('node-menu-edit')).focus();
  }
  document.addEventListener('contextmenu',event=>{
    const element=event.target.closest?.('[data-action-node-id]');if(element)open(event,element);
  });
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target))close();});
  document.addEventListener('scroll',()=>close(),true);
  window.addEventListener('resize',()=>close());
  window.addEventListener('blur',()=>close());
  document.addEventListener('keydown',event=>{
    if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){
      const element=event.target.closest?.('[data-action-node-id]');if(element)open(event,element);return;
    }
    if(menu.hidden)return;
    if(event.key==='Escape'){event.preventDefault();close(true);}
    else if(event.key==='Tab')close();
    else if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();const buttons=[$('node-menu-edit'),$('node-menu-delete')].filter(b=>!b.hidden);
      const index=buttons.indexOf(document.activeElement);buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();
    }
  });
  $('node-menu-edit').onclick=()=>{const node=target?.node;close();if(node)openNoteEditor(node);};
  $('node-menu-delete').onclick=async()=>{
    if(!target||busy)return;
    const {node,baseMd}=target;
    let descendants=0;function count(n){for(const child of n.children){descendants++;count(child);}}count(node);
    const question=node===model.root?`确定删除全部知识吗？将删除 ${descendants} 个目录与笔记。`:
      node.children.length?`确定删除「${node.title}」及其下的 ${descendants} 个目录与笔记吗？`:`确定删除笔记「${node.title}」吗？`;
    close();if(!confirm(question))return;
    busy=true;
    try{
      const response=await chrome.runtime.sendMessage({type:'DELETE_NODE',payload:{baseMd,nodeId:node.id}});
      if(response?.status!=='success')throw Error(response?.error||'删除未完成，请刷新确认');
      locations={};expanded=new Set(['root']);$('search').value='';recentOnly=false;
      load(response.md);const parent=model.nodes.find(n=>n.id===response.nodeId);if(parent)choose(parent);
      notify('已删除，删除前的知识树已自动备份');
    }catch(error){notify(error.message);}
    finally{busy=false;}
  };
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.knowledge_tree_md)close();});
})();
