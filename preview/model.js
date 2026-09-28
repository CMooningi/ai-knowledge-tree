/* Parsing only: Markdown content is rendered as DOM text, never trusted HTML. */
globalThis.KnowledgeModel = {
  NOTE_START: '<!-- aitree-note:start -->',
  NOTE_END: '<!-- aitree-note:end -->',
  parse(markdown) {
    const root = {id:'root',title:'全部知识',level:0,body:[],children:[],parent:null};
    const nodes = [root], stack = [root];
    let fence = null, inNote = false;
    for (const line of markdown.replace(/\r\n/g,'\n').split('\n')) {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if(marker[1][0]===fence[0] && marker[1].length>=fence.length && /^\s{0,3}(`{3,}|~{3,})\s*$/.test(line)) fence=null;
        stack.at(-1).body.push(line); continue;
      }
      if (!fence && line.trim() === this.NOTE_START) {inNote = true;stack.at(-1).body.push(line);continue;}
      if (!fence && line.trim() === this.NOTE_END) {inNote = false;stack.at(-1).body.push(line);continue;}
      const heading = !fence && !inNote && line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (!heading) {stack.at(-1).body.push(line);continue;}
      heading[2] = heading[2].replace(/\s+#+$/, '');
      const level=heading[1].length;
      if(level===1 && nodes.length===1){root.title=heading[2];continue;}
      while(stack.length>1 && stack.at(-1).level>=level) stack.pop();
      const parent=stack.at(-1), title=heading[2];
      const occurrence=parent.children.filter(n=>n.title===title).length;
      const node={id:parent.id+'/'+encodeURIComponent(title)+'~'+occurrence,title,level,body:[],children:[],parent};
      parent.children.push(node);nodes.push(node);stack.push(node);
    }
    return {root,nodes};
  },
  path(node){const result=[];for(let n=node;n;n=n.parent)result.unshift(n);return result;},
  search(nodes,query){const q=query.trim().toLocaleLowerCase();return q?nodes.filter(n=>n.parent&&(n.title+'\n'+n.body.join('\n')).toLocaleLowerCase().includes(q)):[];},
  safeUrl(url){try{const parsed=new URL(url);return ['https:','http:'].includes(parsed.protocol)?parsed.href:null;}catch{return null;}}
};
