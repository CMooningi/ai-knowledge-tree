// DeepSeek API Client v3
// Minimal prompts, plain text output, manual parsing

const DEEPSEEK_API_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

async function getApiKey() {
  const result = await chrome.storage.local.get('deepseek_api_key');
  return result.deepseek_api_key || '';
}

async function chat(messages, { temperature = 0.3, maxTokens = 2000 } = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('DeepSeek API Key 未配置。');

  const resp = await fetch(`${DEEPSEEK_API_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`API 错误 (${resp.status}): ${err}`);
  }

  const data = await resp.json();
  return data.choices[0].message.content.trim();
}

// ── Call 1: Classify ──

async function classifyConversation(conversation) {
  const text = conversation.map(m => `[${m.role === 'user' ? '问' : '答'}] ${m.content}`).join('\n\n');

  const content = await chat([
    { role: 'system', content: '你是知识分类器。只输出JSON，无解释。' },
    { role: 'user', content: `判断是否为学习内容（编程/数学/科学/学术等），是则给出2-4级分类层级。

${text.substring(0, 3000)}

输出JSON: {"is_learning":true,"hierarchy":["大类","子类","主题"],"keywords":["k1"]}` }
  ], { temperature: 0.1, maxTokens: 800 });

  try {
    const json = JSON.parse(content.replace(/```json|```/g, '').trim());
    return json;
  } catch (e) {
    throw new Error('分类JSON解析失败: ' + content.slice(0, 200));
  }
}

// ── Call 2: Extract knowledge ──

async function extractKnowledge(aiResponse, existingContent, sourceUrl) {
  const response = await chat([
    { role: 'system', content: '你是知识提取器。从AI回答中逐条提取知识点，每条一行。只输出知识点本身，不要任何解释、不要标题、不要点评。如果与已有知识重复就跳过。' },
    { role: 'user', content: `【已有知识】
${existingContent.slice(0, 1500)}

【AI回答原文】
${aiResponse.slice(0, 6000)}

逐条列出原文中出现的新知识点（每条一行，-"开头）：` }
  ], { temperature: 0.1, maxTokens: 2500 });

  console.log('[知识树] API原始返回:\n', response);

  // Parse bullet-list response into sections
  const lines = response.split('\n').filter(line => {
    const t = line.trim();
    return t.startsWith('-') || t.startsWith('•') || t.match(/^\d+[\.\)]/);
  });

  const sections = lines.map(line => {
    const cleaned = line.replace(/^[-•\d]+[\.\)]\s*/, '').trim();
    return {
      heading: cleaned.slice(0, 20),
      level: 4,
      content: cleaned
    };
  }).filter(s => {
    const c = s.content;
    // Aggressive filter: reject anything that looks like meta-instruction
    if (c.length < 10) return false;
    if (/拆解|提炼|提取.*知识|结构化|层级.*标题|知识点.*包含|返回.*JSON|输出.*格式|以下.*内容|上述.*原文|上述.*回答/i.test(c)) return false;
    return true;
  });

  console.log('[知识树] 解析后sections:', sections.length, '条');
  return { sections };
}
