// DeepSeek API Client
// Three API calls: classify → structure → dedup

const DEEPSEEK_API_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

async function getApiKey() {
  const result = await chrome.storage.local.get('deepseek_api_key');
  return result.deepseek_api_key || '';
}

async function callDeepSeek(prompt, { temperature = 0.3, maxTokens = 2000 } = {}) {
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
        { role: 'system', content: '你是一个知识整理助手。你必须只返回有效的 JSON 格式，不要包含任何其他文字、解释或 markdown 代码块标记。' },
        { role: 'user', content: prompt }
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

  // Strip markdown code fences if present
  const jsonStr = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`JSON 解析失败: ${e.message}\n原始返回: ${content.substring(0, 500)}`);
  }
}

/**
 * Call 1: Determine if learning content + classify into hierarchy
 */
async function classifyConversation(conversation) {
  const userQuestions = conversation.filter(m => m.role === 'user').map(m => m.content).join('\n\n');
  const aiAnswers = conversation.filter(m => m.role === 'assistant').map(m => m.content).join('\n\n');

  const prompt = `分析以下对话，判断这段对话是否属于"学习/知识获取/技术讨论"类型。

学习内容包括但不限于：编程技术、数学、科学、工程、语言学习、学术讨论、技能教学、原理分析等。
非学习内容：闲聊、娱乐八卦、日常问候、单纯的翻译、简单的信息查询等。

如果是学习内容，请为这段对话归类到合适的知识层级（2-4级）。
层级设计原则：一级为大领域，二级为子领域，三级为具体技术/概念，四级为细分点。

用户问题：
${userQuestions.substring(0, 2000)}

AI 回答摘要（截取前部）：
${aiAnswers.substring(0, 1000)}

返回 JSON：
{
  "is_learning": true/false,
  "hierarchy": ["一级分类", "二级分类", "三级分类", "末级标题"],
  "keywords": ["关键词1", "关键词2", "关键词3"]
}

注意：
1. hierarchy 数组长度 2-4，按从粗到细排列
2. 如果判断为非学习内容，hierarchy 和 keywords 可以为空数组
3. 末级标题要足够具体，能唯一标识这个知识点`;

  return callDeepSeek(prompt, { temperature: 0.2, maxTokens: 1000 });
}

/**
 * Call 2: Break down AI response into hierarchical knowledge points
 */
async function structureContent(aiResponse) {
  const prompt = `将以下 AI 回答/教程内容拆解为层级化知识结构。每个知识点包含标题（heading）、层级（level: 2-5）、和精简的核心内容（content）。

AI 回答内容：
${aiResponse.substring(0, 6000)}

返回 JSON：
{
  "sections": [
    {
      "heading": "知识点小标题",
      "level": 2,
      "content": "精简后的核心知识点，去除冗余表述，保留关键概念和代码（1-3句话）"
    }
  ]
}

要求：
1. heading 要简洁（不超过15个字）
2. level 2-5，2 是子主题，5 是最末级细节
3. content 精简但保留核心要点
4. 如果 AI 回答很长，取出所有重要知识点，不要遗漏
5. 按照内容原有的逻辑层级组织 sections`;

  return callDeepSeek(prompt, { temperature: 0.2, maxTokens: 3000 });
}

/**
 * Call 3: Compare existing content with new, return only new knowledge
 */
async function dedupContent(existingSectionContent, newSections) {
  const newContentStr = JSON.stringify(newSections);

  const prompt = `对比已有的知识库内容和新的知识点，找出真正新增的知识（已有内容中未出现或实质性不同的知识）。

已有知识库内容（对应章节）：
${existingSectionContent.substring(0, 3000)}

新知识点列表（JSON）：
${newContentStr.substring(0, 3000)}

判断标准：
1. 概念相同、只是表述不同 → 重复，不保留
2. 已有内容已覆盖了该知识点 → 重复，不保留
3. 全新概念、新的细节、补充说明、不同角度 → 新知识
4. 代码示例不同且展示了新用法 → 新知识

返回 JSON：
{
  "is_duplicate": true/false,
  "new_sections": [
    {"heading": "...", "level": 3, "content": "..."}
  ],
  "reason": "简短说明判断理由（1句话）"
}`;

  return callDeepSeek(prompt, { temperature: 0.1, maxTokens: 2000 });
}
