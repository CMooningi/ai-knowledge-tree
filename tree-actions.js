const TreeActions = {
  remove(md,payload){
    if(!payload||typeof payload.baseMd!=='string'||typeof payload.nodeId!=='string')throw Error('删除请求不完整');
    if(md!==payload.baseMd)throw Error('知识树已发生变化，请查看最新内容后重新删除');
    const tree=KnowledgeModel.parse(md),node=tree.nodes.find(n=>n.id===payload.nodeId);
    if(!node)throw Error('该条目不存在或已经删除');
    const parent=node.parent||tree.root;
    const removed=tree.nodes.filter(n=>n===node||KnowledgeModel.path(n).includes(node)).filter(n=>n!==tree.root);
    if(node===tree.root){tree.root.children=[];tree.root.body=[];}
    else parent.children=parent.children.filter(n=>n!==node);
    const remap=[],ids=new Map();
    function index(current,id){ids.set(current,id);remap.push({from:current.id,to:id});const counts=new Map();for(const child of current.children){const count=counts.get(child.title)||0;counts.set(child.title,count+1);index(child,id+'/'+encodeURIComponent(child.title)+'~'+count);}}
    index(tree.root,'root');
    return {md:Taxonomy.serialize(tree.root),nodeId:ids.get(parent),removed:removed.length,remap};
  }
};
