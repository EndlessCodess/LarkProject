# Lark CLI Context Agent

面向飞书 OpenClaw 赛道“企业办公知识整合与分发 Agent（公开版）”的 CLI 主动知识助手。当前项目更贴近方向 C：沉浸式碎片知识推送助手。

它的目标是：当开发者在本地终端使用 `lark-cli`，或在飞书群里讨论 `lark-cli` / 飞书 OpenAPI 问题时，系统能够主动捕获上下文，从本地 Skill、结构化规则、命令帮助和飞书云文档知识中召回相关内容，再由 LLM 压缩成知识卡，分发到终端或飞书群。

## 核心能力

- 主动触发：支持飞书群 SDK WebSocket 事件监听，也支持 CLI Shell / CLI Watch 终端监听。
- 多知识源：整合 `knowledge/skills/` 本地官方 Skill、`knowledge/lark-cli-errors.json` 结构化规则、`knowledge/lark-cloud-knowledge.json` 飞书云知识入口。
- 分层链路：规则优先，规则未命中时进入 RAG / hybrid-vector 混合检索，再由 LLM Composer 整理输出。
- 知识分发：支持终端 release/debug 卡片，也支持飞书群交互式知识卡片。
- 效果验证：提供 `eval:quality` / `eval:all` 评测入口，可展示 Top3 召回证据和 hybrid-vector 分项得分。

主链路：

```text
Feishu group message / terminal command
  -> event normalization
  -> rule matching
  -> hybrid retrieval from skills / cloud docs / help evidence
  -> LLM composer
  -> terminal card / Feishu card
```

## 目录结构

- `src/chatEventMain.js`：飞书群事件监听入口，支持官方 SDK WebSocket 和 `lark-cli event +subscribe` fallback。
- `src/cliWatchMain.js`：CLI Watch / Agent Shell 入口，支持开发者手动输入命令并后台触发知识卡。
- `src/app/processKnowledgeEvent.js`：统一知识事件处理主链路。
- `src/core/matcher.js`：结构化规则匹配。
- `src/core/knowledge/retriever.js`：RAG、hybrid、hybrid-vector 检索与向量缓存。
- `src/core/agent/llmComposer.js`：基于规则、召回证据和上下文的 LLM 知识卡压缩。
- `src/adapters/output/`：终端卡片、飞书卡片 payload、推送策略和发送适配器。
- `knowledge/skills/`：本地镜像的官方 `lark-*` Skill。
- `knowledge/lark-cli-errors.json`：结构化错误规则。
- `knowledge/lark-cloud-knowledge.json`：通用飞书云知识 manifest。
- `docs/演示文件.md`：复赛演示脚本。
- `docs/core-code-showcase.md`：复赛“核心部分代码展示”材料。

## 环境配置

### 前置条件

- Node.js 18+，并执行 `npm install` 安装依赖。
- 本机或容器中可用 `lark-cli`，且已经完成 `lark-cli config init`、`lark-cli auth login` 等基础授权。
- 如果要演示飞书群事件监听，需要企业自建应用的 `APP_ID` / `APP_SECRET`，并在飞书开发者后台将事件订阅方式配置为“使用长连接接收事件”，订阅 `im.message.receive_v1`。
- 如果要演示飞书卡片推送，需要机器人已加入目标群，并具备向群发送消息的权限。
- 如果要演示 LLM / hybrid-vector，需要配置 Ark LLM Key 和 Embedding Key；没有 Key 时仍可运行规则与普通检索，但不会展示完整 LLM 压缩效果。

复制环境变量模板：

```bash
cp .env.example .env
```

Windows PowerShell 可使用：

```powershell
Copy-Item .env.example .env
```

推荐配置：

```dotenv
# LLM Composer, OpenAI-compatible / Volc Ark
ARK_API_KEY=ark-...
ARK_MODEL=ep-...
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3

# Embedding for hybrid-vector retrieval
ARK_EMBEDDING_API_KEY=ark-...
ARK_EMBEDDING_MODEL=doubao-embedding-vision-250615
ARK_EMBEDDING_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
LARK_RETRIEVER_MODE=hybrid-vector
LARK_RETRIEVER_VECTOR_STORE_FILE=tmp/retriever-vector-store.json

# Feishu SDK websocket event source
LARK_EVENT_SOURCE=sdk
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=xxx
LARK_SDK_LOG_LEVEL=info
LARK_CLI_AGENT_NAMES=飞书 CLI,飞书CLI,CLI 智能体,cli智能体

# Feishu card push
LARK_DEMO_PUSH_CHAT_ID=oc_xxx
LARK_DEMO_PUSH_AS=bot

# Runtime behavior
LARK_CARD_VIEW=release
LARK_COMPOSE_MODE=template
LARK_FORCE_LLM_COMPOSE=0
LARK_DEMO_LLM_TIMEOUT_MS=90000
LARK_RETRIEVER_SOURCES_FILE=knowledge/lark-cloud-knowledge.json
LARK_DOCS_CACHE_FILE=tmp/lark-docs-cache.json
LARK_DOCS_CACHE_TTL_MS=3600000
```

说明：

- `LARK_CARD_VIEW=release|debug`：`release` 只展示核心结论，`debug` 展示完整检索证据和链路细节。
- `LARK_RETRIEVER_MODE=keyword|hybrid|hybrid-vector`：比赛演示推荐 `hybrid-vector`。
- `hybrid-vector` 首次运行会为知识 chunk 生成 embedding，之后复用 `tmp/retriever-vector-store.json`。
- `LARK_FORCE_LLM_COMPOSE=1` 等价于默认强制走 LLM Composer，也可在命令中使用 `--force-llm-compose`。

## 快速开始

安装依赖：

```bash
npm install
```

建议按下面顺序复现：

1. 先跑不依赖飞书事件的本地样例，确认 Node、规则库和基础链路正常。

```bash
npm run demo
```

2. 再跑质量评测，确认 RAG / hybrid-vector 检索可用。

```bash
npm run eval:quality -- --retriever-mode hybrid-vector --show-top3
```

3. 最后再启动飞书群监听或 CLI Shell，验证真实主动触发和飞书卡片推送。

完整评测可使用：

```bash
npm run eval:all -- --retriever-mode hybrid-vector --show-top3
```

## 复赛 Demo 推荐路径

### 1. 飞书群事件触发

用于展示“飞书群消息 -> SDK WebSocket -> 知识卡推回群”的主链路。

```bash
npm run demo:competition:chat -- \
  --source-chat-id "oc_xxx" \
  --event-source sdk \
  --push-lark-card \
  --push-chat-id "oc_xxx" \
  --push-as bot \
  --push-level all \
  --push-bypass-dedupe \
  --force-llm-compose \
  --llm-timeout-ms 90000 \
  --retriever-mode hybrid-vector \
  --no-reconcile-poll
```

启动后应看到：

```text
sdk websocket connected
ws client ready
```

推荐在飞书群发送：

```text
@飞书 CLI 我想通过 lark-cli 给飞书群发一条消息，怎么做？
```

### 2. CLI 终端主动触发

用于展示“开发者在终端输入命令 -> 后台分析 -> 输出知识卡 / 推送飞书群”。

```bash
npm run demo:cli-shell -- \
  --compose-mode llm \
  --push-lark-card \
  --push-chat-id "oc_xxx" \
  --push-as bot \
  --push-level all \
  --push-bypass-dedupe \
  --retriever-mode hybrid-vector \
  --force-llm-compose \
  --llm-timeout-ms 90000
```

进入 Agent Shell 后输入：

```bash
lark-cli contact search-user
```

该场景会展示：即使命令返回的是帮助信息而不是硬错误，系统也能识别出“命令写法不规范”并给出修正建议。

### 3. 云知识 RAG 链路

用于展示飞书云文档 / 云文件夹知识可以参与检索。

```bash
npm run demo:cloud-calendar -- \
  --retriever-mode hybrid-vector \
  --push-lark-card \
  --push-chat-id "oc_xxx" \
  --push-as bot \
  --push-level all \
  --push-bypass-dedupe
```

推荐问题：

```text
@飞书 CLI 我只知道上午开会，想找可用会议室补一个会议，应该怎么查？
```

观察点：

```text
source=https://...feishu.cn/file/...
```

### 4. Prove it / 评测证明

质量评测：

```bash
npm run eval:quality -- --retriever-mode hybrid-vector --show-top3
```

完整评测：

```bash
npm run eval:all -- --retriever-mode hybrid-vector --show-top3
```

重点观察：

```text
retriever vector: enabled=true
PASS ... all checks passed
hybrid-vector k=... s=... r=...
```

## 常用脚本

- `npm run demo`：本地样例回放。
- `npm run demo:competition:chat`：复赛飞书群事件主入口。
- `npm run demo:competition:cli`：复赛 CLI 单命令主入口。
- `npm run demo:cli-shell`：交互式 Agent Shell。
- `npm run demo:cloud-calendar`：云端 calendar Skill RAG 验证。
- `npm run eval`：小回归评测。
- `npm run eval:quality`：Agent 质量评测。
- `npm run eval:llm`：LLM Composer 复杂样例评测。
- `npm run eval:all`：整合三套评测的一条主路径。

## 常用参数

### 通用

- `--retriever-mode <keyword|hybrid|hybrid-vector>`：检索模式。
- `--card-view <release|debug>`：卡片展示密度。
- `--force-llm-compose`：强制调用 LLM Composer。
- `--llm-timeout-ms <ms>`：LLM 超时时间。
- `--live-help` / `--no-live-help`：是否补充动态 `lark-cli --help` 证据。

### CLI Watch

- `--command <cmd>`：执行单条命令并分析。
- `--analysis-mode <background|blocking>`：知识分析模式。默认 `background`，适合开发；`blocking` 适合逐步演示。
- `--trigger-all`：所有命令都触发分析。
- `--no-trigger-on-success`：只在失败或强信号时分析。
- `--stdout-tail-lines <n>` / `--stderr-tail-lines <n>`：采集命令输出尾部行数。

### 飞书群事件

- `--source-chat-id <oc_xxx>`：监听来源群 ID。
- `--event-source <sdk|lark-cli>`：事件源，推荐 `sdk`。
- `--app-id <cli_xxx>` / `--app-secret <secret>`：SDK WebSocket 所需应用凭证。
- `--no-reconcile-poll`：只使用 SDK 事件，不启用历史消息轮询补偿。
- `--reconcile-poll`：启用历史消息补偿。

### 飞书卡片推送

- `--push-lark-card`：启用飞书卡片推送。
- `--push-chat-id <oc_xxx>`：推送目标群。
- `--push-as <bot|user>`：推送身份，推荐 `bot`。
- `--push-level <none|all|high_only|warning_and_above>`：推送门控级别。
- `--push-bypass-dedupe`：跳过去重，适合连续演示。
- `--push-bypass-policy`：跳过推送策略门控。

## 云知识 Manifest

默认文件：`knowledge/lark-cloud-knowledge.json`。

```json
{
  "docs": [
    {
      "id": "team-auth-rules",
      "url": "https://your-domain.feishu.cn/docx/xxx",
      "as": "user"
    }
  ],
  "folders": [
    {
      "id": "calendar-skill-folder",
      "folderUrl": "https://your-domain.feishu.cn/drive/folder/xxx",
      "as": "user",
      "pageSize": 200
    }
  ]
}
```

`folders[]` 支持普通飞书云文件夹，也支持上传后的 Skill 文件夹。系统会读取 `SKILL.md` 和 `references/*.md`，并切成可检索的 RAG chunk。

## 复赛定位

当前版本已经形成最小可运行闭环：

```text
CLI terminal / Feishu group
  -> active trigger
  -> rules + skills + cloud knowledge + hybrid-vector retrieval
  -> LLM evidence compression
  -> terminal card / Feishu card
  -> evaluation proof
```

它不是单纯的聊天 Bot，而是一个面向开发者场景的主动知识分发 Agent：把散落在 Skill、命令帮助、错误规则和飞书云文档中的知识，在用户需要时主动送到上下文里。

## 相关文档

- `docs/演示文件.md`：复赛现场演示脚本。
- `docs/core-code-showcase.md`：核心代码展示材料。
- `docs/architecture.md`：系统架构与执行链路。
- `docs/product-definition.md`：产品定位与比赛对齐。
- `docs/evaluation.md`：评测说明。
