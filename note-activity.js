globalThis.NoteActivity = {
  key:'knowledge_note_activity',
  recent(entries, now=Date.now()) {
    // Cap before removing read items: reading one must not reveal older hidden dots.
    return Object.entries(entries).filter(([,v])=>v.updatedAt>now-7*86400000)
      .sort((a,b)=>b[1].updatedAt-a[1].updatedAt).slice(0,10).filter(([,v])=>v.updatedAt>(v.readAt||0));
  },
  day(now){const d=new Date(now);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');},
  evolve(previous,result,revisited=[],now=Date.now()){
    const next={};
    for(const {from,to} of result.remap||[])if(previous[from])next[to]=structuredClone(previous[from]);
    const events=[...(result.activity||[]),...revisited.map(id=>({from:[id],to:(result.remap||[]).find(r=>r.from===id)?.to,updated:false}))];
    for(const event of events){
      if(!event.to)continue;
      const sources=(event.from||[]).map(id=>previous[id]).filter(Boolean);
      const base=next[event.to]||sources[0]||{uid:crypto.randomUUID(),updatedAt:0,readAt:0,days:[]};
      const days=new Set([...base.days,...sources.flatMap(v=>v.days||[]),this.day(now)]);
      next[event.to]={...base,days:[...days].sort(),updatedAt:event.updated?now:base.updatedAt};
    }
    return next;
  },
  read(entries,receipts){
    const next=structuredClone(entries);
    for(const entry of Object.values(next))if(receipts.some(r=>r.uid===entry.uid&&r.updatedAt===entry.updatedAt))entry.readAt=entry.updatedAt;
    return next;
  }
};
