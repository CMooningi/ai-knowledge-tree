const $ = id => document.getElementById(id);
const M = KnowledgeModel;
let model, markdown='', selected, activeAnchor='', expanded=new Set(), saved={}, saveTimer, searchTimer, frame;
let anchors=[], anchorMap=new Map(), outlines=new Map(), navButtons=new Map(), navRows=new Map();
let viewNode, readingMode=false, locations={};
let noteActivity={}, recentOpen=false, readingTimer, readingKey='';
function recentIds(){return new Set(NoteActivity.recent(noteActivity).map(([id])=>id));}
function drawRecent(){
  const nodes=NoteActivity.recent(noteActivity).map(([id])=>model.nodes.find(n=>n.id===id)).filter(Boolean);
  const control=$('recent-control'),button=$('recent-updates'),panel=$('recent-panel'),list=$('recent-list');
  control.hidden=!nodes.length;if(!nodes.length)recentOpen=false;
  button.textContent=`最近更新 · ${nodes.length} ${recentOpen?'⌃':'⌄'}`;
  button.setAttribute('aria-expanded',String(recentOpen));panel.hidden=!recentOpen;
  // Rebuild only when titles or paths change so an open list keeps focus and scroll.
  const signature=JSON.stringify(nodes.map(node=>[node.id,node.title]));
  if(list.dataset.signature===signature)return;
  list.dataset.signature=signature;list.replaceChildren();
  for(const node of nodes){
    const item=make('button',undefined,'recent-item');
    item.append(make('strong',node.title),make('small',M.path(node).slice(1,-1).map(n=>n.title).join(' / ')));
    item.title='在目录中定位：'+node.title;
    item.onclick=()=>revealRecent(node.id);list.append(item);
  }
}
function revealRecent(id){
  const node=model.nodes.find(n=>n.id===id);if(!node)return;
  recentOpen=false;$('search').value='';choose(node);
  // Scroll only the outline, keeping the page and reader layout in place.
  const row=navRows.get(node.id),tree=$('tree');if(!row)return;
  const rect=row.getBoundingClientRect(),bounds=tree.getBoundingClientRect();
  const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  tree.scrollTo({top:Math.max(0,tree.scrollTop+rect.top-bounds.top-tree.clientHeight/2+rect.height/2),behavior:reduce?'auto':'smooth'});
  row.classList.add('recent-target');navButtons.get(node.id)?.focus({preventScroll:true});
}
function badge(node,parent){
  if(node.children.length)return;
  const info=noteActivity[node.id];if(!info)return;
  const count=info.days?.length||0;
  if(count>=2){const star=make('span',count>=4?'★':'☆','learning-star');star.title='已在 '+count+' 天的学习中出现';star.setAttribute('aria-label',star.title);parent.append(star);}
  if(recentIds().has(node.id)){const dot=make('span','', 'new-dot');dot.title='近期新增或补充，尚未阅读';dot.setAttribute('aria-label',dot.title);parent.append(dot);}
}
function scheduleRead(){
  const info=noteActivity[selected?.id];
  const key=readingMode&&selected&&!selected.children.length&&info&&info.updatedAt>(info.readAt||0)?info.uid+':'+info.updatedAt:'';
  if(key===readingKey)return;
  readingKey=key;clearTimeout(readingTimer);if(!key)return;
  const receipt={uid:info.uid,updatedAt:info.updatedAt};
  readingTimer=setTimeout(async()=>{
    if(document.visibilityState==='hidden'){readingKey='';return;}
    try{const response=await chrome.runtime.sendMessage({type:'READ_NOTES',receipts:[receipt]});if(response?.error)throw Error(response.error);}
    catch{readingKey='';notify('阅读状态保存失败，下次打开会重试');}
  },900);
}
const make=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
function nodeTarget(el,node){el.dataset.actionNodeId=node.id;}
function notify(text){$('notice').textContent=text;$('notice').style.display='block';setTimeout(()=>$('notice').style.display='none',3000);}
function anchorTop(anchor){return anchor.el.getBoundingClientRect().top-$('reader').getBoundingClientRect().top+$('reader').scrollTop;}
function locationState(){const anchor=anchorMap.get(activeAnchor)||anchors[0];return {anchor:anchor?.key,offset:anchor?$('reader').scrollTop-anchorTop(anchor):0};}
function remember(){if(viewNode)locations[viewNode.id]=locationState();}
function persist(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{remember();return chrome.storage.local.set({knowledge_reader:{version:3,view:viewNode?.id,selected:selected?.id,expanded:[...expanded],locations,width:saved.width}}).catch(()=>notify('阅读位置保存失败'));},250);}
function inline(parent,text){
  const pattern=/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g;let end=0;
  for(const match of text.matchAll(pattern)){
    parent.append(document.createTextNode(text.slice(end,match.index)));const token=match[0];
    if(token.startsWith('`'))parent.append(make('code',token.slice(1,-1)));
    else if(token.startsWith('**'))parent.append(make('strong',token.slice(2,-2)));
    else {const link=token.match(/^\[([^\]]+)\]\((.+)\)$/),url=M.safeUrl(link[2]);
      if(url){const a=make('a',link[1]);a.href=url;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);}else parent.append(document.createTextNode(token));}
    end=match.index+token.length;
  }
  parent.append(document.createTextNode(text.slice(end)));
}
function renderMarkdown(lines,target,onHeading){
  let list=null;
  for(let i=0;i<lines.length;i++){
    const line=lines[i],fence=line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if(fence){const code=[];while(++i<lines.length){const close=lines[i].match(/^\s{0,3}(`{3,}|~{3,})\s*$/);if(close&&close[1][0]===fence[1][0]&&close[1].length>=fence[1].length)break;code.push(lines[i]);}
      const pre=make('pre'),content=make('code',code.join('\n')),button=make('button','复制代码');
      button.onclick=async()=>{try{await navigator.clipboard.writeText(content.textContent);notify('代码已复制');}catch{notify('复制失败，请选中代码后复制');}};
      pre.append(button,content);target.append(pre);list=null;continue;}
    if(!line.trim()){list=null;continue;}
    if([M.NOTE_START,M.NOTE_END,NoteEditor.MARKER].includes(line.trim()))continue;
    const heading=line.match(/^(#{1,6})\s+(.+?)\s*$/);
    const legacyHeading=!heading&&line.match(/^\*\*([^*]{1,100})\*\*$/);
    if(heading||legacyHeading){const depth=heading?heading[1].length:2,text=heading?heading[2].replace(/\s+#+$/,''):legacyHeading[1];
      const h=make('h'+Math.min(6,Math.max(3,depth+1)));inline(h,text);target.append(h);onHeading?.(h,text,depth);list=null;continue;}

    if(line.includes('|') && i+1<lines.length && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i+1])) {
      const split=row=>row.trim().replace(/^\||\|$/g,'').split('|').map(s=>s.trim());
      const wrap=make('div',undefined,'table-wrap'),table=make('table'),head=make('thead'),tr=make('tr');
      split(line).forEach(text=>{const th=make('th');inline(th,text);tr.append(th);});head.append(tr);table.append(head);
      const body=make('tbody');i++;
      while(i+1<lines.length&&lines[i+1].trim()&&lines[i+1].includes('|')){const row=make('tr');split(lines[++i]).forEach(text=>{const td=make('td');inline(td,text);row.append(td);});body.append(row);}
      table.append(body);wrap.append(table);target.append(wrap);list=null;continue;
    }
    if(/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)){target.append(make('hr'));list=null;continue;}
    const item=line.match(/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/);
    if(item){const tag=item[1]?'ul':'ol';if(!list||list.tagName.toLowerCase()!==tag){list=make(tag);target.append(list);}const li=make('li');inline(li,item[2]);list.append(li);continue;}
    list=null;const quote=line.match(/^>\s?(.*)$/);const p=make(quote?'blockquote':'p');if(/⭐/.test(line))p.className='important';inline(p,quote?quote[1]:line);target.append(p);
  }
}
function registerAnchor(el,node,key,label,depth,isNote){
  // Keep stable UI IDs such as "title"; only generated headings need new IDs.
  if(!el.id)el.id='reading-anchor-'+anchors.length;
  el.classList.add('reading-anchor');
  const anchor={el,node,key,label,depth,isNote};anchors.push(anchor);anchorMap.set(key,anchor);return anchor;
}
function isReadingNode(node){
  return !node.children.length ||
    (node.level>=4 && node.children.every(child=>!child.children.length));
}
function renderDocument(node){
  viewNode=node;readingMode=isReadingNode(node);
  anchors=[];anchorMap=new Map();outlines=new Map();
  $('title').textContent=node.title;
  nodeTarget($('title'),node);
  $('meta').textContent=readingMode?'笔记阅读 · 点击小节大纲定位，也可上下滚动':node.children.length+' 个下级主题 · 选择一项继续浏览';
  $('body').replaceChildren();$('children').replaceChildren();registerAnchor($('title'),node,node.id,node.title,0,true);
  function renderNodeBody(node,target){
    const entries=[],counts=new Map();outlines.set(node.id,entries);
    renderMarkdown(node.body,target,(el,title,depth)=>{
      const count=counts.get(title)||0;counts.set(title,count+1);
      const key=node.id+'::'+encodeURIComponent(title)+'~'+count;
      entries.push(registerAnchor(el,node,key,title,depth,false));
    });
  }
  if(readingMode)renderNodeBody(node,$('body'));else renderMarkdown(node.body,$('body'));
  function visit(node){
    const section=make('section',undefined,'knowledge-section');
    section.dataset.nodeId=node.id;
    const heading=make('h'+Math.min(6,Math.max(2,node.level)),node.title,'knowledge-heading');
    nodeTarget(heading,node);
    if(!node.children.length)heading.classList.add('note-title');
    section.append(heading);$('body').append(section);
    registerAnchor(heading,node,node.id,node.title,0,true);renderNodeBody(node,section);
    node.children.forEach(visit);
  }
  if(readingMode)node.children.forEach(visit);
  else {
    const cards=make('div',undefined,'cards');
    for(const child of node.children){const card=make('button',child.title,'card');nodeTarget(card,child);card.append(make('small',isReadingNode(child)?'阅读笔记 →':child.children.length+' 个下级主题 →'));card.onclick=()=>choose(child);cards.append(card);}
    $('children').append(cards);
  }
  if(model.nodes.length===1&&!model.root.body.some(line=>line.trim()&&!line.startsWith('>'))){$('body').replaceChildren(make('p','知识树还没有内容。完成一次 AI 对话抓取后，这里会显示连续阅读的笔记。','empty'));}
}
function updateCrumbs(){
  $('crumbs').replaceChildren();if(!selected)return;
  M.path(selected).forEach((node,i)=>{if(i)$('crumbs').append(make('span','/'));const button=make('button',node.title);button.onclick=()=>choose(node);$('crumbs').append(button);});
}
function paintActive(){
  navRows.forEach((row,id)=>row.classList.toggle('active',id===selected?.id));
  navButtons.forEach((button,key)=>{const active=key===activeAnchor;button.classList.toggle('current-heading',active);button.setAttribute('aria-current',active?'location':'false');});
}
function drawTree(){
  if(!model)return;
  const tree=$('tree'),previousScroll=tree.scrollTop;tree.replaceChildren();navButtons=new Map();navRows=new Map();
  const query=$('search').value.trim();
  drawRecent();
  if(query){const results=M.search(model.nodes,query);$('count').textContent=results.length+' 个搜索结果';
    for(const node of results){const button=make('button',undefined,'result');nodeTarget(button,node);button.append(make('strong',node.title),make('small',M.path(node).slice(1).map(n=>n.title).join(' / ')));
      const text=node.body.filter(line=>![M.NOTE_START,M.NOTE_END].includes(line.trim())).join(' ').replace(/\s+/g,' '),index=text.toLowerCase().indexOf(query.toLowerCase());
      if(text)button.append(make('small',text.slice(Math.max(0,index-25),Math.max(0,index-25)+110)));
      button.onclick=()=>{$('search').value='';choose(node);};tree.append(button);}
    if(!results.length)tree.append(make('p','没有匹配内容，试试更短的关键词。','empty'));return;
  }
  $('count').textContent=(model.nodes.length-1)+' 个目录与笔记';
  function row(node,depth){
    const local=outlines.get(node.id)||[],hasChildren=node.children.length||local.length;
    const el=make('div',undefined,'row');el.style.paddingLeft=depth*12+'px';navRows.set(node.id,el);
    nodeTarget(el,node);
    const toggle=make('button',hasChildren?(expanded.has(node.id)?'⌄':'›'):'·','toggle');toggle.disabled=!hasChildren;
    if(hasChildren){toggle.setAttribute('aria-expanded',expanded.has(node.id));toggle.setAttribute('aria-label','展开或收起 '+node.title);}
    toggle.onclick=()=>{expanded.has(node.id)?expanded.delete(node.id):expanded.add(node.id);drawTree();persist();};
    const label=make('button',undefined,'label');label.append(make('span',node.title,'node-label-text'));badge(node,label);label.title=node.title;label.onclick=()=>choose(node);navButtons.set(node.id,label);
    el.append(toggle,label);tree.append(el);
    if(expanded.has(node.id)){
      const baseDepth=local.length?Math.min(...local.map(a=>a.depth)):0;
      local.forEach(anchor=>{const button=make('button',anchor.label,'outline-item');button.title=anchor.label;button.style.paddingLeft=((depth+1)*12+24+Math.max(0,anchor.depth-baseDepth)*10)+'px';
        button.onclick=()=>jumpTo(anchor.key);navButtons.set(anchor.key,button);tree.append(button);});
      node.children.forEach(child=>row(child,depth+1));
    }
  }
  row(model.root,0);paintActive();tree.scrollTop=previousScroll;
}
function activate(anchor,expand=true){
  const changed=selected!==anchor.node;selected=anchor.node;activeAnchor=anchor.key;
  let opened=false;
  if(expand)for(const node of M.path(selected)){if(!expanded.has(node.id)){expanded.add(node.id);opened=true;}}
  if(changed)updateCrumbs();
  if(opened)drawTree();else paintActive();
  scheduleRead();
}
function jumpTo(key,smooth=true){
  const anchor=anchorMap.get(key);if(!anchor)return;
  activate(anchor);if(!$('search').value)drawTree();
  const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  $('reader').scrollTo({top:Math.max(0,anchorTop(anchor)-20),behavior:smooth&&!reduce?'smooth':'auto'});persist();
}
function choose(node){
  if(readingMode&&anchorMap.has(node.id)){jumpTo(node.id);return;}
  remember();renderDocument(node);selected=null;
  const state=locations[node.id],target=anchorMap.get(state?.anchor)||anchors[0];
  activate(target);updateCrumbs();drawTree();
  const offset=state?.anchor===target.key&&Number.isFinite(state.offset)?state.offset:0;
  $('reader').scrollTo({top:state?Math.max(0,anchorTop(target)+offset):0,behavior:'auto'});persist();
}
function syncScroll(){
  frame=null;if(!anchors.length)return;
  const top=$('reader').getBoundingClientRect().top+32;
  let active=anchors[0];
  for(const anchor of anchors){if(anchor.el.getBoundingClientRect().top<=top)active=anchor;else break;}
  if($('reader').scrollHeight>$('reader').clientHeight&&$('reader').scrollTop+$('reader').clientHeight>=$('reader').scrollHeight-2)active=anchors.at(-1);
  activate(active);persist();
}
function load(md,restore){
  remember();
  const fallback=viewNode?.id||saved.view||saved.selected;
  const state=restore||locations[fallback]||saved.location;
  markdown=md;model=M.parse(md);selected=null;renderDocument(model.nodes.find(node=>node.id===fallback)||model.root);
  const target=anchorMap.get(state?.anchor)||anchors[0];
  activate(target);updateCrumbs();drawTree();
  const offset=state?.anchor===target.key&&Number.isFinite(state.offset)?state.offset:0;
  $('reader').scrollTop=Math.max(0,anchorTop(target)+offset);
}
function width(value){saved.width=Math.max(220,Math.min(480,value));document.documentElement.style.setProperty('--sidebar',saved.width+'px');$('resizer').setAttribute('aria-valuenow',saved.width);}
$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(drawTree,120);});
$('collapse').onclick=()=>{expanded=new Set(['root']);drawTree();persist();};
$('reader').addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(syncScroll);},{passive:true});
$('resizer').onpointerdown=e=>{e.preventDefault();$('resizer').setPointerCapture(e.pointerId);};
$('resizer').onpointermove=e=>{if($('resizer').hasPointerCapture(e.pointerId))width(e.clientX);};
$('resizer').onpointerup=e=>{$('resizer').releasePointerCapture(e.pointerId);persist();};
$('resizer').onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();width((saved.width||300)+(e.key==='ArrowLeft'?-20:20));persist();}};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('search').focus();}if(e.key==='Escape'&&document.activeElement===$('search')){$('search').value='';drawTree();}});
$('recent-updates').onclick=()=>{recentOpen=!recentOpen;drawRecent();};
document.addEventListener('click',e=>{if(recentOpen&&!$('recent-control').contains(e.target)){recentOpen=false;drawRecent();}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&recentOpen){recentOpen=false;drawRecent();$('recent-updates').focus();}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){clearTimeout(readingTimer);readingKey='';}else scheduleRead();});
setInterval(()=>{if(model)drawTree();},60000);
$('export').onclick=async()=>{try{const result=await chrome.runtime.sendMessage({type:'DOWNLOAD_TREE'});if(result?.error)throw Error(result.error);}catch(e){notify('导出未完成：'+e.message);}};
(async()=>{try{
  const data=await chrome.storage.local.get(['knowledge_tree_md','knowledge_reader',NoteActivity.key]);noteActivity=data[NoteActivity.key]||{};saved=data.knowledge_reader||{};locations=saved.locations||{};expanded=new Set(saved.expanded||['root']);if(saved.width)width(saved.width);load(data.knowledge_tree_md||'');
  chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes[NoteActivity.key])noteActivity=changes[NoteActivity.key].newValue||{};if(changes.knowledge_tree_md){load(changes.knowledge_tree_md.newValue||'');notify('知识树已更新');}else if(changes[NoteActivity.key]){drawTree();scheduleRead();}});
}catch(e){$('title').textContent='暂时无法读取知识树';$('body').textContent='请重新加载扩展后，再打开预览。'+e.message;}})();
