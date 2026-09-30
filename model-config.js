const ModelConfig = {
  llmKeys:['llm_provider','deepseek_api_key','deepseek_model','openrouter_api_key','openrouter_model'],
  jevKeys:['jev_provider','jev_api_key','jev_openrouter_api_key','jev_openrouter_model','jev_verified','jev_retry_after'],
  key(value){if(typeof value!=='string'||!value.trim()||value.trim().length>4096)throw Error('请输入有效的 API Key');return value.trim();},
  model(value,fallback){const model=String(value||fallback).trim();if(!model||model.length>160||/\s/.test(model))throw Error('模型 ID 无效');return model;},
  llm(settings){
    const provider=settings.llm_provider||'deepseek';
    if(!['deepseek','openrouter'].includes(provider))throw Error('不支持的笔记模型渠道');
    const router=provider==='openrouter';
    const model=this.model(router?settings.openrouter_model:settings.deepseek_model,router?'':'deepseek-chat');
    if(router&&/^~?typesafe\/jev-(?!router)/i.test(model))throw Error('Jev 是决策模型，请在 Jev 预审区域配置；笔记整理需要能生成文本的模型');
    return {provider,model,key:router?settings.openrouter_api_key:settings.deepseek_api_key,
      endpoint:router?'https://openrouter.ai/api/v1/chat/completions':'https://api.deepseek.com/v1/chat/completions'};
  },
  jev(settings){
    const provider=settings.jev_provider||'typesafe';
    if(!['typesafe','openrouter'].includes(provider))throw Error('不支持的 Jev 渠道');
    const router=provider==='openrouter';
    const model=router?this.model(settings.jev_openrouter_model,'typesafe/jev-1.13'):'jev-latest';
    if(router&&!/^(typesafe\/jev-\d[\w.-]*|~typesafe\/jev-latest)$/.test(model))throw Error('请选择 Jev 决策模型，例如 typesafe/jev-1.13');
    return {provider,model,key:router?settings.jev_openrouter_api_key:settings.jev_api_key,
      endpoint:router?'https://openrouter.ai/api/alpha/decisions':'https://api.typesafe.ai/v1/systemone'};
  }
};
