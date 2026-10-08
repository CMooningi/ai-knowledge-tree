// LLM proposes taxonomy changes; this module applies only validated moves and additions.
const Taxonomy = {
  name(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 120 || /[\r\n]/.test(value)) throw new Error('LLM 返回了无效的分类名称');
    const title = value.trim().replace(/^#+\s*/, '').replace(/\s+#+$/, '');
    if (!title) throw new Error('分类名称不能为空');
    return title;
  },
  path(value, technology) {
    const invalid = message => Object.assign(new Error(message), {code:'INVALID_TAXONOMY_PATH'});
    if (!Array.isArray(value) || value.length < 1 || value.length > 4) throw invalid('分类路径应为 1–4 层，另保留一层知识点');
    const path = value.map(name => this.name(name));
    if (technology && !path.some(name => name.toLowerCase() === technology.toLowerCase())) throw invalid('分类路径缺少独立的主要技术层：'+technology);
    return path;
  },
  snapshot(md) {
    const tree = KnowledgeModel.parse(md);
    const records = tree.nodes.map((node, index) => ({
      id: 'n' + index, node,
      path: KnowledgeModel.path(node).slice(1).map(n => n.title),
      kind: node === tree.root || node.children.length || !node.body.some(line => line.trim()) ? 'category' : 'note'
    }));
    return { ...tree, records };
  },
  outline(snapshot) {
    const outline = snapshot.records.map(({ id, path, kind }) => ({ id, path, kind }));
    if (JSON.stringify(outline).length > 100000) throw new Error('知识树目录过大，本次未修改，请缩小待整理范围后重试');
    return outline;
  },
  related(snapshot, classification) {
    const ids = new Set(classification.related_ids);
    for (const id of ids) if (!snapshot.records.some(r => r.id === id)) throw new Error('LLM 选择了不存在的旧目录');
    const tech = classification.technology?.toLowerCase();
    // Include technology-named branches even if the classifier omitted a legacy alias such as Python教程.
    const roots = snapshot.records.filter(r => ids.has(r.id) || (tech && r.path.some(name => name.toLowerCase().includes(tech))));
    const notes = snapshot.records.filter(r => r.kind === 'note' && roots.some(parent => KnowledgeModel.path(r.node).includes(parent.node)));
    const explicit=snapshot.records.filter(r=>ids.has(r.id));
    const priority=record=>ids.has(record.id)?0:explicit.some(parent=>KnowledgeModel.path(record.node).includes(parent.node))?1:2;
    notes.sort((a,b)=>priority(a)-priority(b));
    const context = notes.map(r => ({ id: r.id, path: r.path, content: r.node.body.join('\n') }));
    // Never silently truncate old evidence and then let the model reorganize unseen content.
    if (JSON.stringify(context).length > 120000) throw new Error('相关旧笔记超出本次整理容量，知识树未修改');
    return context;
  },
  serialize(root) {
    const lines = ['# ' + root.title, ...root.body];
    function visit(node, level) {
      if (level > 6) throw new Error('调整后的目录过深，知识树未修改');
      // Parsed bodies already include the separator before the next heading.
      // Reuse it so repeated saves do not grow whitespace in every node.
      if (lines.length && lines[lines.length - 1].trim()) lines.push('');
      lines.push('#'.repeat(level) + ' ' + node.title, ...node.body);
      node.children.forEach(child => visit(child, level + 1));
    }
    root.children.forEach(node => visit(node, 2));
    return lines.join('\n');
  },
  ensure(root, path) {
    let parent = root;
    for (const title of path) {
      const matches = parent.children.filter(node => node.title === title);
      if (matches.length > 1) throw new Error('目标路径存在同名目录，无法安全定位');
      let node = matches[0];
      if (node && !node.children.length && node.body.some(line => line.trim())) throw new Error('LLM 将知识点误用为分类目录，本次未保存');
      if (!node) {
        node = { title, body: [], children: [], parent };
        parent.children.push(node);
      }
      parent = node;
    }
    return parent;
  },
  noteBody(content) {
    let fence = null;
    const body = content.split('\n').map(line => {
      if(!fence&&[KnowledgeModel.NOTE_START,KnowledgeModel.NOTE_END].includes(line.trim()))return null;
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s{0,3}(`{3,}|~{3,})\s*$/.test(line)) fence = null;
        return line;
      }
      return line;
    }).filter(line=>line!==null);
    if (fence) body.push(fence);
    return [KnowledgeModel.NOTE_START,...body,KnowledgeModel.NOTE_END];
  },
  sameSource(content, sourceUrl) {
    if(content.split('\n').some(line=>line.trim()==='<!-- aitree-user-edited -->'))return false;
    const url=KnowledgeModel.safeUrl(sourceUrl)?.replace(/\)/g,'%29');
    const sources=content.split('\n').map(line=>line.match(/^> 📎 \[查看对话原文\]\((.+)\)\s*$/)).filter(Boolean).map(match=>match[1]);
    return Boolean(url)&&sources.length>0&&sources.every(source=>source===url);
  },
  sourceLinks(content) {
    return NoteEditor.split(content.split('\n')).sources.filter(line=>{
      const match=line.match(/^> 📎 \[查看对话原文\]\((.+)\)\s*$/);
      return match&&KnowledgeModel.safeUrl(match[1]);
    });
  },
  canMerge(note, technology, sourceUrl) {
    if(note.content.split('\n').some(line=>line.trim()===NoteEditor.MARKER))return false;
    if(this.sameSource(note.content,sourceUrl))return true;
    return Boolean(technology&&this.sourceLinks(note.content).length&&note.path.slice(0,-1).some(name=>name.toLowerCase().includes(technology.toLowerCase())));
  },
  validateMergeEvidence(note, evidence) {
    const quote=evidence.find(item=>item?.id===note.id)?.quote;
    const text=typeof quote==='string'?quote.replace(/\s/g,''):'';
    if(text.length<8||!NoteEditor.split(note.content.split('\n')).content.replace(/\s/g,'').includes(text))throw Error('跨对话合并缺少有效的旧笔记正文依据，本次未保存');
  },
  orderChildren(root, orders, classification) {
    if(!Array.isArray(orders)||orders.length>50)throw Error('目录排序方案格式错误');
    const seen=new Set();
    // Validate every complete sibling permutation before applying any order.
    const actions=orders.map(order=>{
      const path=this.path(order.path,classification.technology);
      if(!classification.technology&&!(classification.hierarchy?.length&&classification.hierarchy.every((title,i)=>path[i]===title)))throw Error('不能排序本次主题以外的目录');
      const id=JSON.stringify(path);if(seen.has(id))throw Error('同一目录重复排序');seen.add(id);
      let parent=root;
      for(const title of path){const matches=parent.children.filter(node=>node.title===title);if(matches.length!==1)throw Error('排序目标不存在或有重名目录');parent=matches[0];}
      if(typeof order.reason!=='string'||!order.reason.trim())throw Error('目录排序缺少依据');
      const names=order.children,byName=new Map(parent.children.map(node=>[node.title,node]));
      if(!Array.isArray(names)||names.length!==parent.children.length||new Set(names).size!==names.length||byName.size!==parent.children.length||names.some(name=>!byName.has(name)))throw Error('目录排序必须恰好包含全部直接子节点，不得遗漏、重名或新增');
      return {parent,children:names.map(name=>byName.get(name))};
    });
    let changed=0;
    for(const {parent,children} of actions){if(children.some((node,i)=>node!==parent.children[i])){parent.children=children;changed++;}}
    return changed;
  },
  apply(md, classification, sections, related, plan, sourceUrl) {
    if (!plan || !Array.isArray(plan.placements) || !Array.isArray(plan.moves)) throw new Error('LLM 整理方案格式错误');
    if (plan.placements.length !== sections.length) throw new Error('LLM 整理方案漏掉了新知识点，本次未保存');
    const snapshot = this.snapshot(md), allowed = new Map(related.map(r => [r.id, r]));
    const assigned = new Set(), moved = new Set(), oldParents = new Set(), replaced = new Set();
    for(const section of sections){
      for(const id of section.replaces||[]){
        const record=snapshot.records.find(r=>r.id===id),old=allowed.get(id);
        if(!record||record.kind!=='note'||!old||!this.canMerge(old,classification.technology,sourceUrl)||replaced.has(id))throw new Error('替换目标不是唯一、可合并的旧笔记，本次未保存');
        if(!this.sameSource(old.content,sourceUrl))this.validateMergeEvidence(old,section.merge_evidence||[]);
        replaced.add(id);
      }
    }
    // Validate the entire plan before mutating even the in-memory snapshot.
    const placements = plan.placements.map(item => {
      if (!Number.isInteger(item.index) || !sections[item.index] || assigned.has(item.index)) throw new Error('新知识点编号重复或无效');
      assigned.add(item.index);
      return { ...item, path: this.path(item.path, classification.technology) };
    });
    const moves = plan.moves.map(item => {
      const old = allowed.get(item.id), record = snapshot.records.find(r => r.id === item.id);
      if (!old || !record || record.kind !== 'note' || record.node.children.length || moved.has(item.id) || replaced.has(item.id)) throw new Error('LLM 试图移动未提供、已替换或重复的笔记');
      const evidence = item.evidence;
      if (typeof evidence !== 'string' || evidence.trim().length < 3 || !(old.path.join(' / ')+'\n'+old.content).includes(evidence)) throw new Error('旧笔记的归类证据无效，本次未保存');
      if (typeof item.reason !== 'string' || !item.reason.trim()) throw new Error('LLM 未解释旧笔记的调整原因');
      const path = this.path(item.path, classification.technology);
      if (path.length >= record.path.length && record.path.every((title, i) => title === path[i])) throw new Error('不能将笔记移动到自身下级');
      moved.add(item.id);return { ...item, path, node: record.node };
    });
    let changed = 0;
    for(const id of replaced){const node=snapshot.records.find(r=>r.id===id).node;oldParents.add(node.parent);node.parent.children=node.parent.children.filter(child=>child!==node);}
    for (const move of moves) {
      const destination = this.ensure(snapshot.root, move.path), node = move.node;
      if (destination === node.parent) continue;
      oldParents.add(node.parent);
      node.parent.children = node.parent.children.filter(child => child !== node);
      destination.children.push(node);node.parent = destination;changed++;
    }
    // Remove only vacated, text-free ancestors of moved notes. Never delete note bodies.
    for (let parent of oldParents) {
      while (parent.parent && !parent.children.length && !parent.body.some(line => line.trim())) {
        const grandparent = parent.parent;
        grandparent.children = grandparent.children.filter(child => child !== parent);
        parent = grandparent;
      }
    }
    let added = 0;
    const activity = [];
    for (const placement of placements) {
      const section = sections[placement.index], parent = this.ensure(snapshot.root, placement.path);
      const body = this.noteBody(section.content), text = body.join('\n').trim();
      const duplicate = parent.children.find(n => n.title === section.heading && n.body.join('\n').includes(text));
      if(duplicate&&section.replaces?.length)throw Error('合并目标与保留的同名笔记重复，请将完整主题一起合并；本次未保存');
      if (duplicate) { activity.push({node:duplicate,from:[duplicate.id],updated:false}); continue; }
      const node = {title: section.heading, body: ['', ...body, ''], children: [], parent};
      const links=new Set((section.replaces||[]).flatMap(id=>this.sourceLinks(allowed.get(id).content)));
      const url = KnowledgeModel.safeUrl(sourceUrl);
      if(url)links.add('> 📎 [查看对话原文](' + url.replace(/\)/g, '%29') + ')');
      if(links.size)node.body.push(...links,'');
      parent.children.push(node);if(!section.replaces?.length)added++;
      const originals=(section.replaces||[]).map(id=>snapshot.records.find(r=>r.id===id).node);
      activity.push({node,from:originals.map(n=>n.id),updated:!originals.length||originals.some(n=>NoteEditor.split(n.body).content!==section.content.trim())});
    }
    const reordered=this.orderChildren(snapshot.root,plan.orders||[],classification);
    const result = added || changed || replaced.size || reordered ? this.serialize(snapshot.root) : md;
    const ids=new Map();
    function index(node,id){ids.set(node,id);const counts=new Map();for(const child of node.children){const n=counts.get(child.title)||0;counts.set(child.title,n+1);index(child,id+'/'+encodeURIComponent(child.title)+'~'+n);}}
    index(snapshot.root,'root');
    const remap=snapshot.records.filter(r=>ids.has(r.node)).map(r=>({from:r.node.id,to:ids.get(r.node)}));
    return { md: result, added, updated:replaced.size, moved: changed, reordered, remap, activity:activity.map(a=>({from:a.from,to:ids.get(a.node),updated:a.updated})), paths: placements.map(p => p.path), summary: typeof plan.summary === 'string' ? plan.summary.slice(0,500) : '' };
  }
};
