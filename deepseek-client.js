// DeepSeek API Client
// Three API calls: classify → structure → dedup

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

// ── Call 1: Classify conversation ──

async function classifyConversation(conversation) {
  const userQuestions = conversation.filter(m => m.role === 'user').map(m => m.content).join('\n---\n');
  const aiAnswers = conversation.filter(m => m.role === 'assistant').map(m => m.content).join('\n---\n');

  const systemPrompt = '你是一个知识分类专家。你只返回JSON，不返回任何解释文字。';

  const userPrompt = `判断以下对话是否属于学习/知识获取内容（编程、数学、科学、学术、技能等）。
如果不是学习内容则 is_learning=false。
如果是学习内容，请归类到合适的知识层级（2-4级，从大到小）。

=== 用户问题 ===
${userQuestions.substring(0, 2000)}

=== AI回答（前段） ===
${aiAnswers.substring(0, 1000)}

返回JSON格式（不要包含其他文字）：
{
  "is_learning": true,
  "hierarchy": ["一级大类", "二级子类", "三级具体主题", "四级细分点"],
  "keywords": ["关键词1", "关键词2"]
}`;

  return callDeepSeek(systemPrompt, userPrompt, { temperature: 0.2, maxTokens: 1000 });
}

// ── Call 2: Structure AI response into knowledge points ──

async function structureContent(aiResponse) {
  const systemPrompt = '你是一个知识提炼师。你的任务是从AI教程回答中直接提取知识点。你只返回JSON，每条content是可直接入知识库的总结句。';

  const userPrompt = `从以下AI回答中，逐条提炼核心知识点。每条知识点用1-2句话概括（保留关键概念、代码片段、公式等）。
不要输出"如何拆解"或"结构化方法"之类的元描述，直接输出知识点本身。

=== 要提炼的AI回答 ===
${aiResponse.substring(0, 6000)}

返回JSON（只返回JSON，无其他文字）：
{
  "sections": [
    {"heading": "这个知识点的简短标题(≤15字)", "level": 3, "content": "知识点的核心内容，1-2句话，保留代码/公式"}
  ]
}

level含义：2=大主题, 3=具体概念, 4=细节补充, 5=最细粒度点`;

  return callDeepSeek(systemPrompt, userPrompt, { temperature: 0.2, maxTokens: 3000 });
}

// ── Call 3: Dedup against existing knowledge ──

async function dedupContent(existingSectionContent, newSections) {
  const newContentStr = JSON.stringify(newSections);

  const systemPrompt = '你是一个知识去重专家。对比已有知识和新知识，只返回真正新增的内容。你只返回JSON。';

  const userPrompt = `对比已有知识和新知识，只保留实质性不同的新知识。

已有知识：
${existingSectionContent.substring(0, 3000)}

新知识候选：
${newContentStr.substring(0, 3000)}

去重标准：
- 核心概念相同、仅表述不同 → 去掉
- 已有知识已经完全覆盖 → 去掉
- 补充了新细节、新角度、新代码示例 → 保留
- 完全新的概念 → 保留

返回JSON（只返回JSON）：
{
  "is_duplicate": true,
  "new_sections": [],
  "reason": "简要说明"
}`;

  return callDeepSeek(systemPrompt, userPrompt, { temperature: 0.1, maxTokens: 2000 });
}
