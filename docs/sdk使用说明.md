# 大模型SDK使用说明
本文档为项目中调用自定义大模型的统一规范，所有模型调用必须遵循本说明。

---

## 一、概述
本项目已接入火山引擎自定义大模型`ep-20260423223104-568xj`，用于增强知识助手的语义理解、智能建议生成、非结构化信息处理等能力。提供两种调用方式，优先使用OpenClaw内置调用。

---

## 二、环境准备
### 1. 依赖安装
```bash
# OpenClaw内置调用依赖（优先使用）
npm install @trae/ai

# 独立火山引擎SDK调用依赖（仅非OpenClaw环境使用）
npm install @volcengine/volc-sdk-nodejs
```

### 2. 配置准备
- 自定义模型`ep-20260423223104-568xj`已在TRAE平台启用，无需额外配置即可使用
- 若使用独立SDK方式，需要在环境变量中配置火山引擎AK/SK：
  ```bash
  export VOLC_ACCESSKEY="你的AK"
  export VOLC_SECRETKEY="你的SK"
  ```
  > 注意：禁止在代码中硬编码AK/SK，必须通过环境变量或配置中心获取

---

## 三、调用方式
### 🏆 方式1：OpenClaw内置调用（推荐，优先使用）
无需处理认证、SDK版本兼容等问题，直接调用TRAE内置接口即可：
```javascript
import { chatCompletion } from "@trae/ai";

/**
 * 调用自定义大模型
 * @param {string} prompt 用户提问/指令
 * @param {string} systemPrompt 系统提示词，默认为lark-cli助手角色
 * @param {Object} options 可选参数
 * @returns {string} 模型返回结果
 */
async function callModel(prompt, systemPrompt = null, options = {}) {
  const defaultSystemPrompt = `
你是专业的lark-cli智能助手，擅长解决lark-cli、飞书OpenAPI、OpenClaw技能相关的所有问题。
要求：
1. 回答必须准确、简洁，只输出和问题相关的内容，不要输出多余解释
2. 修复建议必须可直接执行，命令格式必须完全符合lark-cli规范
3. 不确定的内容不要臆测，优先提示用户查看对应技能的SKILL.md文档
4. 所有涉及lark-cli命令的部分必须用代码块包裹
`;

  const response = await chatCompletion({
    model: "ep-20260423223104-568xj",
    messages: [
      {
        role: "system",
        content: systemPrompt || defaultSystemPrompt
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: options.temperature || 0.1, // 默认低温度，保证输出稳定
    max_tokens: options.max_tokens || 1024,
    top_p: options.top_p || 0.8,
    stream: options.stream || false
  });

  return response.choices[0].message.content.trim();
}

// 使用示例
const result = await callModel(`
请分析以下lark-cli报错，给出修复建议：
命令：lark-cli base +record-update --base-token bascnxxx
错误：unknown command "+record-update"
`);
```

### 🛠️ 方式2：独立火山引擎SDK调用（仅非OpenClaw环境使用）
当项目运行在非TRAE/OpenClaw环境时使用：
```javascript
import { MaasService } from "@volcengine/volc-sdk-nodejs";

const maas = new MaasService({
  accessKeyId: process.env.VOLC_ACCESSKEY,
  secretKey: process.env.VOLC_SECRETKEY,
  region: "cn-beijing",
  endpoint: "maas-api.ml-platform-cn-beijing.volces.com",
});

async function callModel(prompt, systemPrompt = null, options = {}) {
  const defaultSystemPrompt = `
你是专业的lark-cli智能助手，擅长解决lark-cli、飞书OpenAPI、OpenClaw技能相关的所有问题。
要求：
1. 回答必须准确、简洁，只输出和问题相关的内容，不要输出多余解释
2. 修复建议必须可直接执行，命令格式必须完全符合lark-cli规范
3. 不确定的内容不要臆测，优先提示用户查看对应技能的SKILL.md文档
4. 所有涉及lark-cli命令的部分必须用代码块包裹
`;

  const response = await maas.chat({
    model: "ep-20260423223104-568xj",
    messages: [
      { role: "system", content: systemPrompt || defaultSystemPrompt },
      { role: "user", content: prompt }
    ],
    parameters: {
      temperature: options.temperature || 0.1,
      max_new_tokens: options.max_tokens || 1024,
      top_p: options.top_p || 0.8
    }
  });

  return response.choices[0].message.content.trim();
}
```

---

## 四、参数说明
| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `model` | string | `ep-20260423223104-568xj` | 固定为项目自定义模型ID，不要修改 |
| `temperature` | number | 0.1 | 温度值，越低输出越稳定，工具类场景建议0.1~0.3，创作类场景建议0.5~0.7 |
| `max_tokens` | number | 1024 | 最大输出token数，根据需要调整 |
| `top_p` | number | 0.8 | 核采样参数，不建议修改 |
| `stream` | boolean | false | 是否流式输出，默认关闭 |

---

## 五、错误处理
```javascript
try {
  const result = await callModel(prompt);
} catch (error) {
  console.error("模型调用失败:", error.message);
  // 降级处理：模型调用失败时，回退到本地规则匹配逻辑
  return fallbackToLocalRule(event);
}
```
> 重要：所有模型调用必须加降级逻辑，不能因为模型不可用影响核心功能的正常运行

---

## 六、项目最佳实践
### 1. 适用场景
- 语义匹配：用户报错和知识库规则的语义相似度匹配，解决关键词匹配覆盖不全的问题
- 智能建议生成：对于未命中本地规则的新错误，自动生成修复建议
- 非结构化信息处理：从用户的自然语言提问、长报错日志中提取关键信息
- 内容生成：生成更人性化、贴合用户场景的知识卡片内容
- 规则自动扩展：自动从新的报错场景中提取规则，补充到知识库

### 2. 不适用场景
- 不要用模型生成已知规则的修复建议，优先使用本地结构化规则，保证准确性
- 不要让模型生成涉及写操作的命令，所有写操作必须经过人工确认
- 不要用模型处理用户的身份认证、权限配置等敏感操作

### 3. 调用示例（集成到现有匹配流程）
```javascript
import { matchKnowledge } from "../core/matcher.js";
import { callModel } from "../ai/model.js";

async function processEvent(event) {
  // 1. 优先匹配本地规则
  const localMatch = matchKnowledge(event, knowledgeBase);
  if (localMatch) {
    return buildKnowledgeCard(localMatch);
  }

  // 2. 未命中本地规则时，调用大模型生成建议
  try {
    const prompt = `
请分析以下lark-cli错误，给出修复建议：
命令：${event.command}
错误：${event.stderr}
退出码：${event.exitCode}
`;
    const modelSuggestion = await callModel(prompt);
    return buildAIGeneratedCard(modelSuggestion, event);
  } catch (error) {
    // 3. 模型调用失败，返回通用提示
    return buildFallbackCard(event);
  }
}
```

---

## 七、常见问题
### Q1：模型调用返回401/无权限？
A：检查自定义模型是否已在TRAE平台启用，AK/SK是否正确配置，是否有权限访问该模型endpoint。

### Q2：模型输出不符合预期？
A：调低temperature值，优化system prompt，明确输出要求，减少模型发挥空间。

### Q3：模型响应慢？
A：调整max_tokens参数，减少不必要的输出内容，对于简单场景可以进一步降低max_tokens到512。

### Q4：如何保证输出的lark-cli命令正确？
A：在system prompt中严格要求命令必须符合lark-cli规范，必要时可以让模型先验证命令格式再输出。
