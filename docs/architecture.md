# Architecture

本文档用于说明当前比赛版项目结构。目标是让新接手的人快速判断：入口在哪、知识从哪里来、核心链路在哪里、卡片从哪里出。

## 1. 整理诊断

当前项目已经具备最小可运行能力，但前期是边验证边开发，所以有几个可读性问题：

- `src/` 根目录有多个入口文件，容易分不清主入口、演示入口和调试入口。
- README 历史说明较多，推荐命令和调试命令混在一起。
- 知识源已经从本地规则扩展到本地 Skill 和云端 manifest，需要单独说明统一接口。
- 事件来源已经包含飞书群、CLI Watch、CLI Proxy，需要明确它们最终都会进入统一处理链路。

本轮整理不移动核心文件，不重写 matcher / retriever / composer，只通过入口分层、文档收敛和配置说明降低理解成本。

## 2. 主链路

```text
Event Source
  -> processKnowledgeEvent
  -> matcher
  -> retriever
  -> liveCliEvidence
  -> composer / llmComposer
  -> decision / action / outcome
  -> terminalCard
  -> larkCardPayload / sendLarkInteractiveCard
```

对应文件：

- 统一处理主线：`src/app/processKnowledgeEvent.js`
- 规则匹配：`src/core/matcher.js`
- 本地轻量 RAG：`src/core/knowledge/retriever.js`
- 动态 help 证据：`src/core/agent/liveCliEvidence.js`
- LLM 压缩：`src/core/agent/composer.js`、`src/core/agent/llmComposer.js`
- 终端卡片：`src/adapters/output/terminalCard.js`
- 飞书卡片：`src/adapters/output/larkCardPayload.js`、`src/adapters/output/sendLarkInteractiveCard.js`

## 3. 入口分层

### 比赛主入口

- `npm run demo:competition:cli`
  - 入口：`src/demoCliWatchLlmMain.js`
  - 用途：演示“本地终端命令 -> LLM 压缩 -> 知识卡 -> 飞书群推送”。

- `npm run demo:competition:chat`
  - 入口：`src/chatEventMain.js`
  - 用途：演示“飞书群消息事件 -> 官方 SDK WebSocket 长连接 -> 知识召回 -> 飞书群知识卡”。

### 日常开发调试入口

- `npm run demo`
  - 本地样例回放，适合验证规则和 RAG 召回。

- `npm run demo:cloud-calendar`
  - 使用 `knowledge/lark-cloud-knowledge.json` 验证云端知识 manifest 是否进入 RAG。

- `npm run demo:cli-watch`
  - CLI Watch 通用入口，可用于交互 Shell 或单命令调试。

- `npm run demo:lark-cli-proxy`
  - 更接近原生 `lark-cli` 的代理模式，适合产品化探索。

### 兼容入口

- `npm run demo:chat-poll`
  - 群消息轮询补偿入口。它仍然有调试价值，但比赛主线优先使用事件订阅。

- `npm run demo:auto`、`npm run demo:regression`
  - 规则回归和只读工具链路调试入口。

## 4. 知识源

`knowledge/` 顶层保持三个稳定入口：

- `knowledge/skills/`
  - 仓库内镜像的官方 `lark-*` Skill。

- `knowledge/lark-cli-errors.json`
  - 高置信结构化错误规则。

- `knowledge/lark-cloud-knowledge.json`
  - 通用飞书云知识 manifest，支持 `docs[]` 和 `folders[]`。

云端文件夹可以是普通文档文件夹，也可以是上传后的 Skill 文件夹。系统会递归展开 `SKILL.md` 和 `references/*.md` 这类 Markdown 文件，转成 RAG chunk。

## 5. 配置层次

推荐配置方式是根目录 `.env`：

- LLM / Ark：`ARK_API_KEY`、`ARK_MODEL`、`ARK_BASE_URL`
- 飞书推送：`LARK_DEMO_PUSH_CHAT_ID`、`LARK_DEMO_PUSH_AS`
- 官方事件长连接：`LARK_EVENT_SOURCE`、`LARK_APP_ID`、`LARK_APP_SECRET`、`LARK_SDK_LOG_LEVEL`
- 云知识 manifest：`LARK_RETRIEVER_SOURCES_FILE`
- 云文档缓存：`LARK_DOCS_CACHE_FILE`、`LARK_DOCS_CACHE_TTL_MS`
- 纯云端验证：`LARK_RETRIEVER_DISABLE_INSTALLED_SKILLS`

命令行参数优先级高于 `.env`，适合临时调试。旧参数 `--retriever-docs-file` 和旧环境变量 `LARK_RETRIEVER_DOCS_FILE` 仅作为兼容保留，推荐统一使用 `--retriever-sources-file` / `LARK_RETRIEVER_SOURCES_FILE`。

群事件入口推荐使用 `LARK_EVENT_SOURCE=sdk`，它基于飞书官方 Node SDK WebSocket 长连接，不需要公网 IP 或域名。`--event-source lark-cli` 仍作为兼容 fallback 保留。

## 6. 暂不整理的部分

本轮刻意没有移动 `src/*.js` 入口文件，也没有拆分 matcher / retriever / composer。原因是这些文件已经被多条演示链路验证过，比赛前更需要稳定性。后续如果要做更深层重构，可以先新增 `src/entrypoints/`，再逐个迁移入口。
