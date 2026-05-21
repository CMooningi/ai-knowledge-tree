// DeepSeek API Client v4

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

// ── Step 1: Classify ──

async function classifyConversation(conversation) {
  const text = conversation
    .map(m => `[${m.role === 'user' ? '用户' : 'AI'}] ${m.content}`)
    .join('\n\n');

  const content = await chat([
    { role: 'system', content: '知识分类器。只输出JSON。' },
    { role: 'user', content: `判断对话是否属于学习内容。是则给出2-4级层级分类。

${text.substring(0, 3000)}

输出JSON: {"is_learning":true,"hierarchy":["大类","子类","主题"],"keywords":["k1","k2"]}` }
  ], { temperature: 0.1, maxTokens: 800 });

  try {
    return JSON.parse(content.replace(/```json|```/g, '').trim());
  } catch (e) {
    throw new Error('分类JSON解析失败: ' + content.slice(0, 200));
  }
}

// ── Step 2: Extract knowledge with full detail ──

async function extractKnowledge(aiResponse, existingContent, sourceUrl) {
  const response = await chat([
    { role: 'system', content:
      '你是知识提炼师。从AI教程回答中提取知识点，每个知识点包含标题和详细正文。' +
      '正文要尽量保留原文中的解释、概念、代码、公式等细节，不要过度精简。' +
      '只输出知识点本身，不输出任何任务描述或元分析。'
    },
    { role: 'user', content:
`【已有知识】（重复则跳过）
${existingContent.slice(0, 1000)}

【要提炼的AI回答】
${aiResponse.slice(0, 8000)}

逐条列出新知识点。每条格式：
## 知识点标题
详细正文（保留原文的解释、代码、公式。3-8句为宜）
---` }
  ], { temperature: 0.2, maxTokens: 4000 });

  console.log('[知识树] API原始返回:\n', response);

  // Parse: split by ## heading or numbered items
  const sections = [];
  const blocks = response.split(/\n(?=##\s)/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length === 0) continue;

    let heading = '';
    const contentLines = [];

    for (const line of lines) {
      const hMatch = line.match(/^##\s+(.+)/);
      if (hMatch && !heading) {
        heading = hMatch[1].trim();
      } else if (!/^---\s*$/.test(line) && line.trim()) {
        contentLines.push(line.trim());
      }
    }

    const content = contentLines.join('\n').trim();

    // Filter invalid entries
    if (!content || content.length < 15) continue;
    if (/拆解|提炼|结构化.*方法|返回.*JSON|请提供.*内容|以下.*回答|上述.*原文/i.test(content)) continue;
    if (/^[#*\-\d]/.test(content) && content.length < 30) continue;

    sections.push({
      heading: heading || content.slice(0, 25),
      level: 4,
      content: content
    });
  }

  console.log('[知识树] 解析出', sections.length, '个知识点');
  return { sections };
}
