# 🌳 AI 知识树 — 浏览器扩展

自动抓取与 AI（DeepSeek、Kimi、ChatGPT 等）的学习对话，调用 DeepSeek API 智能分类并追加到一棵不断生长的 Markdown 知识树中。

**核心理念**：像人脑学习新知识一样——自动归类、只记新东西、知识树持续生长。

## ✨ 功能

- **自动抓取**：打开 AI 聊天页面即自动监听，无需手动操作
- **智能分类**：调用 DeepSeek API 将对话归类到 2~4 级层级结构
- **增量追加**：精准检索同名章节，只补新知识，不重复记录
- **学习过滤**：自动跳过闲聊、娱乐等非学习内容
- **单文件生长**：所有知识在一棵 `knowledge-tree.md` 中持续累积
- **来源追溯**：每个知识点附带原始聊天链接
- **一键导出**：随时导出 Markdown 文件

## 📸 效果预览

导出的 `knowledge-tree.md` 结构：

```markdown
# 🧠 AI 知识树

## 编程
### Python
#### 异步编程
##### asyncio 事件循环
- 事件循环是单线程内调度协程的机制 → [查看原文](https://chat.deepseek.com/...)
- `await` 交出控制权给事件循环，不阻塞线程 → [查看原文](https://chat.deepseek.com/...)

### JavaScript
#### 闭包
##### 闭包的内存管理
- 不再使用的闭包引用应手动置 null → [查看原文](https://kimi.moonshot.cn/...)
```

## 🚀 安装

### 1. 下载代码

```bash
git clone https://github.com/你的用户名/ai-knowledge-tree.git
```

或直接下载 ZIP 解压。

### 2. 加载到 Edge / Chrome

1. 打开 `edge://extensions`（Chrome 打开 `chrome://extensions`）
2. 开启右上角 **「开发人员模式」**
3. 点击 **「加载解压缩的扩展」**
4. 选择 `ai-knowledge-tree` 文件夹
5. 扩展图标出现在工具栏

### 3. 配置 API Key

1. 访问 [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) 注册并获取 API Key
2. 右键扩展图标 → **「扩展选项」**，或点击扩展图标 → **「⚙️ 设置」**
3. 填入 API Key，点击「保存配置」
4. 点击「测试连接」确认配置正确

> 💰 DeepSeek API 费用极低（约 ¥1/百万 token），正常学习使用每月不到 1 元。

## 📖 使用

### 自动模式（推荐）

1. 打开 DeepSeek / Kimi / ChatGPT 等 AI 平台
2. 正常进行学习对话
3. 当 AI 回答完成，扩展自动：
   - 抓取对话
   - 分析是否为学习内容
   - 归类到知识层级
   - 去重后追加到知识树
4. 点击扩展图标可查看抓取状态

### 手动模式

1. 在 AI 聊天页面上点击扩展图标
2. 点击 **「📸 手动抓取」**
3. 等待处理结果

### 查看 & 导出

- **预览**：点击扩展图标 → 「📄 预览知识树」
- **导出**：点击「💾 导出 MD」下载为 Markdown 文件
- **管理**：在设置页面可以查看统计、清空知识树

## 🛠️ 支持的平台

| 平台 | 网址 | 支持状态 |
|------|------|---------|
| DeepSeek | chat.deepseek.com | ✅ 已支持 |
| Kimi | kimi.moonshot.cn | ✅ 已支持 |
| ChatGPT | chat.openai.com | ✅ 已支持 |
| Claude | claude.ai | ✅ 已支持 |
| 腾讯元宝 | yuanbao.tencent.com | ✅ 已支持 |
| 通义千问 | tongyi.aliyun.com | ✅ 已支持 |
| 文心一言 | yiyan.baidu.com | ✅ 已支持 |

> 其他平台未在列表中？扩展使用通用选择器兜底，大概率仍可工作。也欢迎提 PR 添加精确适配。

## 📁 项目结构

```
ai-knowledge-tree/
├── manifest.json             # 扩展配置 (Manifest V3)
├── background.js              # Service Worker — 核心调度
├── content.js                 # 注入页面 — 抓取对话内容
├── deepseek-client.js         # DeepSeek API 封装
├── knowledge-tree.js          # MD 知识树读写管理
├── popup/
│   ├── popup.html/css/js      # 弹出窗口 UI
├── options/
│   ├── options.html/css/js    # 设置页面
├── icons/                     # 扩展图标
├── README.md
└── LICENSE
```

## 🔧 工作原理

```
AI 聊天页面
    ↓ MutationObserver 监听对话
content.js → 提取 Q&A
    ↓
background.js → DeepSeek API (3次调用)
    ├── ① 判断是否学习内容 + 层级归类
    ├── ② AI回答拆分为层级知识点
    └── ③ 与已有内容去重（精准章节检索）
    ↓
knowledge-tree.js → MD 追加新知识
    ↓
chrome.storage.local 持久化
```

## 🤝 贡献

欢迎提交 Issue 和 PR：

- 新增 AI 平台的 DOM 选择器适配
- 优化 Prompt 模板
- 改进 UI 设计
- 文档完善

## 📄 License

MIT License — 详见 [LICENSE](LICENSE)
