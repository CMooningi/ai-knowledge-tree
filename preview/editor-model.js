globalThis.NoteEditor = {
  MARKER:'<!-- aitree-user-edited -->',
  split(lines){
    const content=[],sources=[];let fence=null;
    for(const line of lines){
      const marker=line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length&&/^\s{0,3}(`{3,}|~{3,})\s*$/.test(line))fence=null;content.push(line);continue;}
      if(!fence){
        if([KnowledgeModel.NOTE_START,KnowledgeModel.NOTE_END,this.MARKER].includes(line.trim()))continue;
        if(/^> 📎 \[查看对话原文\]\(https?:\/\/.+\)\s*$/.test(line)){sources.push(line);continue;}
      }
      content.push(line);
    }
    return {content:content.join('\n').trim(),sources};
  },
  apply(currentMd,payload){
    if(!payload||typeof payload.baseMd!=='string'||typeof payload.nodeId!=='string')throw new Error('编辑请求不完整');
    const original=KnowledgeModel.parse(payload.baseMd).nodes.find(n=>n.id===payload.nodeId);
    const tree=KnowledgeModel.parse(currentMd),node=tree.nodes.find(n=>n.id===payload.nodeId);
    if(!original||!node||original.title!==node.title||original.body.join('\n').trim()!==node.body.join('\n').trim())throw new Error('这条笔记已被其他操作修改或移动。你的输入仍保留，请复制后关闭编辑，查看最新内容再修改。');
    if(node===tree.root||node.children.length)throw new Error('只有最末级笔记可以编辑');
    const title=Taxonomy.name(payload.title);
    if(typeof payload.content!=='string'||payload.content.length>200000)throw new Error('正文过长，请控制在 20 万字符以内');
    if(title!==node.title&&node.parent?.children.some(n=>n!==node&&n.title===title))throw new Error('同一目录下已有这个标题，请换一个名称');
    const previous=this.split(node.body),clean=this.split(payload.content.split('\n'));
    if(title===node.title&&clean.content===previous.content)return {md:currentMd,nodeId:node.id,changed:false};
    node.title=title;
    node.body=[this.MARKER,...Taxonomy.noteBody(clean.content),'',...previous.sources,''];
    const focus=KnowledgeModel.path(node).slice(1).map(n=>n.title);
    const md=Taxonomy.serialize(tree.root),parsed=KnowledgeModel.parse(md);
    const edited=parsed.nodes.find(n=>JSON.stringify(KnowledgeModel.path(n).slice(1).map(p=>p.title))===JSON.stringify(focus));
    return {md,nodeId:edited?.id||'root',changed:true};
  }
};
