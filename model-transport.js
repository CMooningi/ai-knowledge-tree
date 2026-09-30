// All model traffic goes through one transport, including configuration probes.
const ModelTransport = {
  async request({endpoint,provider,key,body,label,trace,timeoutMs=90000}){
    DevLog.secret(key);
    const request=DevLog.start('API '+label,{parentTask:trace?.id,provider,endpoint,model:body.model,timeoutMs});
    trace?.step('调用 API：'+label,{requestId:request.id,provider,model:body.model});
    request.step('请求体（认证密钥不记录）',body);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(body),signal:controller.signal});
      request.step('HTTP 返回',{status:response.status,ok:response.ok});
      let data;
      try{
        if(typeof response.text==='function'){
          const raw=await response.text();
          try{data=JSON.parse(raw);}
          catch{request.step('非 JSON 返回体（最多 8000 字符）',raw.slice(0,8000));if(response.ok)throw Error(label+'返回了无法解析的 JSON');}
        }else data=await response.json();
      }catch(error){if(response.ok)throw Error(label+'返回了无法解析的 JSON');}
      request.step('API 原始返回值',data??{message:'返回体不是 JSON'});
      if(!response.ok||data?.error){
        const detail=typeof data?.error?.message==='string'?DevLog.hide(data.error.message).slice(0,300):'';
        throw Error(`${label}失败（${response.status||'API error'}）${detail?'：'+detail:''}`);
      }
      request.end('API 返回完成',{id:data?.id,model:data?.model,usage:data?.usage});
      return data;
    }catch(error){
      const safe=Error(error.name==='AbortError'?label+'请求超时':DevLog.hide(error.message||'网络请求失败'));
      request.error(safe);throw safe;
    }finally{clearTimeout(timer);}
  }
};
