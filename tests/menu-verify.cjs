const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const events={},elements={},calls=[],notes=[];let allow=false,changed,edited,chosen;
function element(id){return elements[id]||= {hidden:false,dataset:{},style:{},offsetWidth:200,offsetHeight:110,focus(){doc.activeElement=this;},contains(other){return other===this;}};}
const root={id:'root',title:'Tree',children:[]},branch={id:'branch',title:'Directory',children:[]},leaf={id:'leaf',title:'Note',children:[]};root.children=[branch];branch.children=[leaf];
const doc={addEventListener(type,fn){events[type]=fn;},activeElement:null};
const ctx=vm.createContext({document:doc,window:{innerWidth:800,innerHeight:600,addEventListener(){}},$:element,model:{root,nodes:[root,branch,leaf]},markdown:'before',openNoteEditor(node){edited=node;},confirm(text){notes.push(text);return allow;},load(){},choose(node){chosen=node;},notify(text){notes.push(text);},chrome:{runtime:{async sendMessage(msg){calls.push(msg);return {status:'success',md:'after',nodeId:'branch'};}},storage:{onChanged:{addListener(fn){changed=fn;}}}}});
vm.runInContext(fs.readFileSync(__dirname+'/../preview/context-menu.js','utf8'),ctx);
function target(node){const el={dataset:{actionNodeId:node.id},getBoundingClientRect(){return {left:50,bottom:100};},focus(){}};el.closest=()=>el;return el;}
function open(node){let prevented=false;events.contextmenu({type:'contextmenu',target:target(node),clientX:790,clientY:590,preventDefault(){prevented=true;}});assert(prevented);assert.equal(element('node-menu').style.left,'592px');assert.equal(element('node-menu').style.top,'482px');}
(async()=>{
 open(branch);assert(element('node-menu-edit').hidden);assert(element('node-menu-delete').textContent.includes('目录'));
 await element('node-menu-delete').onclick();assert.equal(calls.length,0);assert(notes.at(-1).includes('1 个'));
 open(leaf);assert(!element('node-menu-edit').hidden);element('node-menu-edit').onclick();assert.equal(edited,leaf,'edit must use right-click target, not current selection');
 open(root);assert(element('node-menu-edit').hidden);assert(element('node-menu-delete').textContent.includes('全部'));
 events.keydown({key:'Escape',preventDefault(){}});assert(element('node-menu').hidden);
 open(leaf);changed({knowledge_tree_md:{}},'local');assert(element('node-menu').hidden);
 events.keydown({type:'keydown',key:'F10',shiftKey:true,target:target(leaf),preventDefault(){}});assert(!element('node-menu').hidden);
 allow=true;await element('node-menu-delete').onclick();assert.equal(calls[0].payload.nodeId,'leaf');assert.equal(calls[0].payload.baseMd,'before');assert.equal(chosen,branch);
 console.log('PASS context menu by node depth, targeted editing, subtree confirmation/cancel, viewport placement, Escape/keyboard, stale-menu close, delete navigation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
