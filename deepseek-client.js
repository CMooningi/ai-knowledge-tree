// DeepSeek API Client
// Two API calls: classify → (structure + dedup combined)

const DEEPSEEK_API_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

async function getApiKey() {
  const result = await chrome.storage.local.get('deepseek_api_key');
  return result.deepseek_api_key || '';
}

async function callDeepSeek(systemPrompt, userPrompt, { temperature = 0.3, maxTokens = 2000 } = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('DeepSeek API Key 未配置，请在扩展设置中配置。');
  }

  const response = await fetch(`${DEEPSEEK_API_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek API 错误 (${response.status}): ${err}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content.trim();
  const jsonStr = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`JSON 解析失败: ${e.message}\n原始返回: ${content.substring(0, 500)}`);
  }
}

// ── Step 1: Classify → is this learning content? what's the topic hierarchy? ──

async function classifyConversation(conversation) {
  const userQuestions = conversation.filter(m => m.role === 'user').map(m => m.content).join('\n---\n');
  const aiAnswers = conversation.filter(m => m.role === 'assistant').map(m => m.content).join('\n---\n');

  const systemPrompt = '你是一个知识分类专家。只返回JSON，不含解释。';

  const userPrompt = `判断这段对话是否属于学习/知识获取类（编程、数学、科学、学术、技能等）。如果是，请归类到2-4级知识层级。

=== 用户问题 ===
${userQuestions.substring(0, 2000)}

=== AI回答摘要 ===
${aiAnswers.substring(0, 1000)}

返回JSON：
{
  "is_learning": true,
  "hierarchy": ["一级类", "二级类", "三级主题"],
  "keywords": ["关键词"]
}`;

  return callDeepSeek(systemPrompt, userPrompt, { temperature: 0.2, maxTokens: 1000 });
}

// ── Step 2: Extract knowledge from AI response (structure + dedup in one call) ──

async function extractKnowledge(aiResponse, existingSectionContent, sourceUrl) {
  // Trim the AI response to avoid token waste
  const contentToExtract = aiResponse.substring(0, 8000);

  const systemPrompt =
    '你是知识提取器。输入一段AI教程回答，你从原文中提取知识点，输出为JSON。' +
    '每条content必须是原文中实际出现的知识点，用原文的语言表述。' +
    '禁止输出方法论文本（如"提炼"、"拆解"、"结构化"等元描述），只输出知识本身。';

  const userPrompt =
`【已有知识】（用于去重）
${existingSectionContent.substring(0, 2000)}

【原文内容】
${contentToExtract}

【任务】
从【原文内容】中逐段提取知识点。每条1-2句，保留关键概念、代码、公式。
只提取【原文内容】中实际出现的知识，不要凭空编造。
如果与【已有知识】重复，跳过该条。

返回JSON：
{
  "sections": [
    {"heading": "知识点标题(≤15字)", "level": 3, "content": "原文中的具体知识点内容"}
  ]
}`;

  return callDeepSeek(systemPrompt, userPrompt, { temperature: 0.2, maxTokens: 3000 });
}
