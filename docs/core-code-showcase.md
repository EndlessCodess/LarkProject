# 核心部分代码展示

这一部分建议在复赛材料中用“代码截图 + 一句话说明”的方式展示，不需要贴大段代码。重点是让评委看出项目不是一次性 Prompt Demo，而是一个有触发、检索、生成和分发闭环的 Agent 系统。

## 1. 统一知识处理主链路

展示文件：`src/app/processKnowledgeEvent.js`

推荐截图位置：

- `processKnowledgeEvent(...)`
- `pickKnowledge(...)`

展示重点：

- 所有入口最终都进入同一条知识处理链路。
- 先做结构化规则匹配，规则未命中才进入 RAG / hybrid-vector 检索。
- 后续统一完成 LLM 压缩、决策、卡片生成和飞书推送。

可放入材料的说明：

> 项目将飞书群事件和 CLI 终端事件统一收敛到 `processKnowledgeEvent`，在这里完成“规则优先、检索补全、LLM 压缩、动作决策、卡片分发”的主流程，保证不同触发入口下的知识处理逻辑一致。

## 2. 双入口主动触发

展示文件：

- `src/chatEventMain.js`
- `src/cliWatchMain.js`

推荐截图位置：

- `handleIncomingEvent(...)`
- `startSdkSubscriber(...)`
- `runCommandAndMaybeAnalyze(...)`
- `enqueueAnalysisJob(...)`

展示重点：

- 飞书群消息通过 SDK WebSocket 事件进入系统。
- CLI Shell 根据命令输出和错误信号主动触发知识分析。
- CLI 模式下采用后台串行队列，避免 LLM 分析阻塞开发者继续输入命令。

可放入材料的说明：

> 项目支持飞书群消息事件与本地 CLI 终端两类主动触发入口。群消息侧用于团队协作场景，终端侧用于开发者实时排错场景；两者都会进入同一知识处理主链路，形成可落地的主动知识分发能力。

## 3. 混合检索与向量召回

展示文件：`src/core/knowledge/retriever.js`

推荐截图位置：

- `buildKnowledgeRetriever(...)`
- `retrieveKnowledge(...)`
- `applyHybridScores(...)`
- `attachVectorStore(...)`
- `embedQuery(...)`

展示重点：

- 本地规则、官方 Skill、安装 Skill、飞书云文档会被归一化为统一 chunk。
- `hybrid-vector` 模式会对用户问题做 embedding，并和知识 chunk 向量计算相似度。
- 最终排序可解释为关键词分、语义/向量分、路由补偿分。
- chunk embedding 会落本地缓存，避免每次启动重复嵌入全部知识。

可放入材料的说明：

> 检索层不是简单关键词匹配，而是支持 keyword / hybrid / hybrid-vector 三种模式。在向量模式下，系统会对用户问题调用 embedding，并与缓存的知识 chunk 向量做相似度比较，再结合关键词命中和业务路由补偿得到最终 TopK 证据。

## 4. LLM Composer 证据压缩

展示文件：`src/core/agent/llmComposer.js`

推荐截图位置：

- `composeWithLlm(...)`
- `buildChatCompletionRequest(...)`
- `buildUserPayload(...)`
- `summarizeRetrieval(...)`

展示重点：

- LLM 不直接自由回答，而是基于上下文、规则、召回证据和动态 help 证据生成结构化结果。
- 输出被约束为 JSON，包含诊断、建议步骤、下一步命令、相关 Skill 和置信度。
- 接口兼容 OpenAI 风格，也可以通过环境变量接入火山 Ark / Doubao。

可放入材料的说明：

> LLM 在项目中承担“知识压缩器”的角色，而不是普通聊天机器人。它基于规则命中、RAG 证据和 CLI 上下文生成结构化知识卡，减少幻觉风险，同时让输出更适合终端和飞书群分发。

## 5. 飞书卡片与终端卡片分发

展示文件：

- `src/adapters/output/larkCardPayload.js`
- `src/adapters/output/terminalCard.js`

推荐截图位置：

- `buildLarkCardPayload(...)`
- `buildReleaseElements(...)`
- `buildDebugElements(...)`
- `renderTerminalCard(...)`

展示重点：

- 同一份 Agent 决策结果可以输出到飞书群卡片，也可以输出到本地终端。
- `release` 视图面向日常开发，只展示核心结论。
- `debug` 视图面向排障和评测，展示完整检索证据和链路细节。

可放入材料的说明：

> 项目将知识结果封装为可分发的卡片，而不是只在控制台打印文本。release/debug 双视图让同一套系统既能服务真实开发效率，也能在比赛演示中证明检索与生成链路。

## 建议最终展示顺序

1. 先展示 `processKnowledgeEvent.js`，说明统一 Agent 主链路。
2. 再展示 `chatEventMain.js` 和 `cliWatchMain.js`，说明主动触发来源。
3. 展示 `retriever.js`，说明混合检索和向量召回。
4. 展示 `llmComposer.js`，说明 LLM 如何基于证据压缩。
5. 展示 `larkCardPayload.js` / `terminalCard.js`，说明结果如何分发到飞书群和终端。
