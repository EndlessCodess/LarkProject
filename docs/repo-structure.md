# Repository Structure

当前仓库按“入口、核心链路、适配器、知识源、演示材料”组织。比赛前不做大规模迁移，优先保持已验证链路稳定。

```text
LarkProject/
├─ config/
│  └─ knowledge-sources.example.json
├─ docs/
│  ├─ architecture.md
│  ├─ demo-script.md
│  ├─ next_plan.md
│  ├─ product-definition.md
│  ├─ repo-structure.md
│  ├─ 参赛要求.md
│  └─ 对话必读.md
├─ examples/
│  ├─ cli-watch-llm-e2e.md
│  ├─ lark-cli-error-samples.jsonl
│  ├─ lark-cli-error-samples-small.jsonl
│  ├─ lark-cli-rag-samples.jsonl
│  └─ lark-cloud-calendar-samples.jsonl
├─ history/
├─ knowledge/
│  ├─ skills/
│  ├─ lark-cli-errors.json
│  └─ lark-cloud-knowledge.json
├─ scripts/
│  ├─ agent-shell.ps1
│  ├─ agent-shell.sh
│  ├─ lark-cli-agent.ps1
│  └─ lark-cli-agent.sh
├─ skills/
│  └─ lark-cli-knowledge-assistant/
├─ src/
│  ├─ app/
│  ├─ bootstrap/
│  ├─ core/
│  ├─ adapters/
│  ├─ main.js
│  ├─ chatEventMain.js
│  ├─ chatPollMain.js
│  ├─ cliWatchMain.js
│  ├─ demoCliWatchLlmMain.js
│  └─ larkCliProxyMain.js
├─ tmp/
├─ package.json
└─ README.md
```

## Entry Files

- `src/demoCliWatchLlmMain.js`
  - 比赛 CLI 主入口包装器，对应 `npm run demo:competition:cli`。

- `src/chatEventMain.js`
  - 飞书群事件监听入口，对应 `npm run demo:competition:chat`。

- `src/main.js`
  - 本地样例回放入口，对应 `npm run demo` 和 `npm run demo:cloud-calendar`。

- `src/cliWatchMain.js`
  - 通用 CLI Watch / Shell 入口，对应 `npm run demo:cli-watch` 和 `npm run demo:cli-shell`。

- `src/larkCliProxyMain.js`
  - `lark-cli` 代理模式入口，对应 `npm run demo:lark-cli-proxy`。

- `src/chatPollMain.js`
  - 群消息轮询补偿/调试入口，对应 `npm run demo:chat-poll`。

## Core Modules

- `src/app/processKnowledgeEvent.js`
  - 统一知识事件处理主线。

- `src/core/matcher.js`
  - 结构化规则匹配。

- `src/core/knowledge/retriever.js`
  - 本地轻量 RAG，索引本地 Skill、错误规则和云知识 manifest。

- `src/core/agent/composer.js`
  - 模板/LLM Composer 调度。

- `src/core/agent/llmComposer.js`
  - OpenAI-compatible LLM 调用，兼容 Ark / Doubao。

- `src/core/agent/liveCliEvidence.js`
  - 动态 `lark-cli --help` 证据采集。

- `src/core/agent/decisionEngine.js`
  - 把知识、证据和执行状态整理为卡片决策对象。

## Adapters

- `src/adapters/knowledge-source/`
  - 本地规则与飞书云文档/云文件夹知识源。

- `src/adapters/lark-cli/runner.js`
  - 跨平台 `lark-cli` 子进程调用。

- `src/adapters/output/`
  - 终端卡片、飞书卡片 payload、推送策略和发送适配器。

## Knowledge Boundary

`knowledge/` 顶层只保留三个入口：

- `knowledge/skills/`
- `knowledge/lark-cli-errors.json`
- `knowledge/lark-cloud-knowledge.json`

其他运行产物和下载缓存放在 `tmp/`，不作为稳定知识入口。
