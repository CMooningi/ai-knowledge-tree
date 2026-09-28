globalThis.IntakePolicy = {
  normalize(value){
    const values=Array.isArray(value)?value:String(value||'').split(/[,，;；\n]+/);
    const result=[],seen=new Set();
    for(const item of values){const tag=String(item).trim();if(!tag)continue;if(tag.length>60)throw Error('每个标签最多 60 个字符');const key=tag.toLowerCase();if(!seen.has(key)){seen.add(key);result.push(tag);}}
    if(result.length>20)throw Error('最多填写 20 个标签');
    return result;
  },
  scope(tags){return 'intake-v1:'+JSON.stringify(tags.map(t=>t.toLowerCase()).sort());},
  matches(values,tags){return Array.isArray(values)?[...new Set(values.filter(v=>typeof v==='string').map(v=>tags.find(t=>t.toLowerCase()===v.trim().toLowerCase())).filter(Boolean))]:[];}
};
