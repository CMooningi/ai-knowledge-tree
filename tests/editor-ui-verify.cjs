const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let documentRoot,reader,raf;const timers=new Map();let next=0,change;
class El{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.style={setProperty(){}};this.dataset={};this.attributes={};this.listeners={};this.scrollTop=0;this.value='';this.className='';this._text='';this.id='';this.classList={add:(...v)=>{this.className=[...new Set([...this.className.split(' '),...v])].join(' ')},toggle:(v,on)=>{const names=new Set(this.className.split(' '));on?names.add(v):names.delete(v);this.className=[...names].join(' ')}};}
 set textContent(t){this._text=String(t);this.children=[]}get textContent(){return this._text+this.children.map(e=>e.textContent||'').join('')}
 append(...children){for(const c of children){c.parent=this;this.children.push(c)}}replaceChildren(...c){this.children=[];this._text='';this.append(...c)}
 setAttribute(k,v){this.attributes[k]=v}addEventListener(k,fn){this.listeners[k]=fn}focus(){}showModal(){this.open=true}close(){this.open=false}setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end)}setPointerCapture(){}releasePointerCapture(){}hasPointerCapture(){return false}
 getBoundingClientRect(){if(this===reader)return {top:0};return {top:Math.max(0,walk(reader).indexOf(this))*40-reader.scrollTop};}
 scrollTo({top}){this.scrollTop=top;this.lastScroll=top}set innerHTML(_){throw Error('Raw HTML is forbidden')}
}
function walk(el){return [el,...(el.children||[]).flatMap(walk)]}
function get(id){return walk(documentRoot).find(el=>el.id===id)||null}
function create(id){const el=new El();el.id=id;return el}
documentRoot=new El('body');reader=create('reader');documentRoot.append(reader);const article=new El('article');reader.append(article);article.append(create('title'),create('meta'),create('body'),create('children'));
for(const id of ['note-editor','note-form','editor-heading','editor-path','editor-close','note-title','note-content','editor-count','tab-write','tab-preview','note-preview','format-tools','format-heading','format-star','format-code','editor-error','editor-save','editor-cancel','recent-updates','notice','crumbs','tree','count','search','collapse','resizer','export'])documentRoot.append(create(id));
const md='# AI 知识树\n## AI\n### LlamaIndex\n#### VectorStoreIndex\n<!-- aitree-note:start -->\n## 定义\n组织向量检索关系。\n## 存储边界\n⭐ 索引与原文存储应分别理解。\n```js\nconst x = 1;\n```\n<!-- aitree-note:end -->\n> 📎 [查看对话原文](https://example.test)\n#### IngestionCache\n缓存转换结果。\n#### 旧格式主题\n##### 作用\n旧格式的正文内容。\n##### 流程\n旧格式的步骤内容。';
const store={knowledge_tree_md:md};
const ctx=vm.createContext({URL,console,document:{getElementById:get,createElement:t=>new El(t),createTextNode:text=>({textContent:text}),documentElement:new El('html'),addEventListener(){}},confirm:()=>false,window:{addEventListener(){},matchMedia:()=>({matches:true})},navigator:{clipboard:{async writeText(){}}},setInterval(){},setTimeout(fn){timers.set(++next,fn);return next},clearTimeout(id){timers.delete(id)},requestAnimationFrame(fn){raf=fn;return 1},chrome:{storage:{local:{async get(){return store},async set(v){Object.assign(store,v)}},onChanged:{addListener(fn){change=fn}}},runtime:{async sendMessage(msg){if(ctx.failSave)return {status:'error',error:'This note changed elsewhere'};const result=ctx.NoteEditor.apply(store.knowledge_tree_md,msg.payload);store.knowledge_tree_md=result.md;return {status:'success',...result};}},downloads:{async download(){}}}});
vm.runInContext(fs.readFileSync(__dirname+'/../note-activity.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../preview/model.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../preview/editor-model.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(process.argv[2]||__dirname+'/../preview/preview.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../taxonomy.js','utf8'),ctx);vm.runInContext(fs.readFileSync(__dirname+'/../preview/editor.js','utf8'),ctx);
const run=code=>vm.runInContext(code,ctx);
(async()=>{
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(get('title'),'fixed title ID must survive anchor registration');
 assert.equal(get('title').textContent,'AI 知识树');assert.equal(run('readingMode'),false);
 assert.ok(get('children').textContent.includes('AI'));assert.equal(get('body').textContent.includes('组织向量'),false);
 run('choose(model.nodes.find(n=>n.title==="LlamaIndex"))');assert.equal(run('readingMode'),false);
 assert.equal(get('children').children[0].children.length,3);assert.equal(get('body').textContent.includes('缓存转换结果'),false);
 run('choose(model.nodes.find(n=>n.title==="VectorStoreIndex"))');assert.equal(run('readingMode'),true);
 assert.ok(get('body').textContent.includes('组织向量检索关系'));assert.equal(get('body').textContent.includes('缓存转换结果'),false);assert.equal(get('children').children.length,0);
 assert.ok(get('tree').textContent.includes('存储边界'));assert.equal(get('body').textContent.includes('aitree-note:'),false);
 const oldDOM=[...get('body').children],key=run('anchors.find(a=>a.label==="存储边界").key');ctx.targetKey=key;run('jumpTo(targetKey,false)');
 assert.ok(reader.scrollTop>0);assert.equal(run('activeAnchor'),key);assert.deepEqual(get('body').children,oldDOM);assert.equal(get('title').id,'title');
 run('syncScroll()');assert.equal(run('activeAnchor'),key);
 run('choose(model.nodes.find(n=>n.title==="LlamaIndex"))');assert.equal(run('readingMode'),false);assert.equal(get('title').textContent,'LlamaIndex');
 run('choose(model.nodes.find(n=>n.title==="VectorStoreIndex"))');assert.equal(run('activeAnchor'),key);assert.ok(reader.scrollTop>0);
 get('search').value='缓存转换结果';run('drawTree()');get('tree').children[0].onclick();assert.equal(get('title').textContent,'IngestionCache');assert.ok(get('body').textContent.includes('缓存转换结果'));assert.equal(get('body').textContent.includes('组织向量'),false);
 run('choose(model.nodes.find(n=>n.title==="旧格式主题"))');assert.equal(run('readingMode'),true);assert.ok(get('body').textContent.includes('旧格式的正文内容'));assert.ok(get('body').textContent.includes('旧格式的步骤内容'));
 const bodyBefore=[...get('body').children];run('choose(model.nodes.find(n=>n.title==="流程"))');assert.deepEqual(get('body').children,bodyBefore);
 assert.equal(get('title').textContent,'旧格式主题');
 for(const [id,fn] of [...timers]){timers.delete(id);fn()}await new Promise(resolve=>setImmediate(resolve));assert.equal(store.knowledge_reader.version,3);assert.ok(store.knowledge_reader.view);assert.ok(store.knowledge_reader.locations);
 change({knowledge_tree_md:{newValue:md+'\n'}},'local');assert.ok(get('title'));assert.equal(get('title').textContent,'旧格式主题');
 run('choose(model.nodes.find(n=>n.title==="VectorStoreIndex"))');
 run('openNoteEditor(selected)');assert.equal(get('note-editor').open,true);assert.ok(get('note-content').value.includes('组织向量'));assert.equal(get('note-content').value.includes('aitree-note:'),false);
 get('note-content').value='## 我的总结\n⭐ 我自己的理解。';get('note-content').oninput();get('editor-cancel').onclick();assert.equal(get('note-editor').open,true);
 get('tab-preview').onclick();assert.ok(get('note-preview').textContent.includes('我自己的理解'));assert.equal(get('note-content').hidden,true);
 get('note-title').value='我的向量索引笔记';await get('note-form').onsubmit({preventDefault(){}});assert.equal(get('note-editor').open,false);assert.equal(get('title').textContent,'我的向量索引笔记');assert.ok(get('body').textContent.includes('我自己的理解'));
 run('openNoteEditor(selected)');get('note-content').value='未保存的草稿';ctx.failSave=true;await get('note-form').onsubmit({preventDefault(){}});assert.equal(get('note-editor').open,true);assert.equal(get('note-content').value,'未保存的草稿');assert.ok(get('editor-error').textContent.includes('changed elsewhere'));assert.equal(get('note-content').readOnly,false);
 ctx.confirm=()=>true;get('editor-cancel').onclick();assert.equal(get('note-editor').open,false);
 change({knowledge_tree_md:{newValue:''}},'local');assert.ok(get('body').textContent.includes('还没有内容'));assert.equal(get('title').textContent,'全部知识');
 console.log('PASS fixed element IDs, upper-level cards, leaf-only reading, scoped legacy terminal topics, local outline scroll, unchanged document on anchor jump, per-topic restoration, search, live update and empty state.');
})().catch(e=>{console.error(e);process.exitCode=1});
