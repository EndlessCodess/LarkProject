# Lark CLI Context Agent

面向飞书 OpenClaw 赛道“企业办公知识整合与分发 Agent”的 CLI 智能知识助手原型，当前主打方向 C：沉浸式碎片知识推送助手。

它的核心目标是：当开发者在本地终端执行 `lark-cli` 命令出错、敲击特定命令，或者在飞书群里讨论 `lark-cli` 问题时，Agent 能主动检索本地 Skill、结构化错误规则和飞书云端知识，并把高密度知识卡片推送到终端或飞书群。

## 当前版本能力

- 知识源：本地官方 `lark-*` Skill 镜像、`knowledge/lark-cli-errors.json` 结构化规则、`knowledge/lark-cloud-knowledge.json` 通用飞书云知识 manifest。
- 主动触发：CLI Watch / Shell、`lark-cli` Proxy、飞书官方 SDK WebSocket 群事件监听、飞书群轮询补偿。
- 知识处理：规则优先，规则未命中时进入本地轻量 RAG，并可补充当前环境的 `lark-cli --help` 动态证据。
- LLM Composer：兼容 OpenAI-compatible 接口，当前可接入 Ark / Doubao，把规则、RAG 和动态 help 证据压缩成知识卡。
- 输出分发：终端 Debug Knowledge Card、飞书交互知识卡片。

主链路：

```text
terminal command / Feishu group message
  -> event normalization
  -> rule matching
  -> local RAG from skills / cloud knowledge
  -> live lark-cli --help evidence
  -> template or LLM composer
  -> terminal card
  -> Feishu interactive card
```

## 目录说明

- `src/app/processKnowledgeEvent.js`：统一知识事件处理主链路。
- `src/chatEventMain.js`：飞书群事件监听入口，支持官方 SDK WebSocket 和 `lark-cli event +subscribe` fallback。
- `src/cliWatchMain.js`：CLI Watch / Agent Shell 入口，支持用户手动输入命令或单命令测试。
- `src/demoCliWatchLlmMain.js`：比赛 CLI LLM 演示包装入口。
- `src/larkCliProxyMain.js`：更接近原生 `lark-cli` 的代理入口。
- `src/core/matcher.js`：结构化规则匹配。
- `src/core/knowledge/retriever.js`：本地轻量 RAG 检索。
- `src/core/agent/composer.js`、`src/core/agent/llmComposer.js`：模板 / LLM 知识卡压缩。
- `src/adapters/output/`：终端卡片、飞书卡片 payload、推送策略和发送适配器。
- `knowledge/skills/`：仓库内镜像的官方 `lark-*` Skill。
- `knowledge/lark-cli-errors.json`：结构化错误规则。
- `knowledge/lark-cloud-knowledge.json`：通用飞书云知识 manifest。
- `docs/architecture.md`：代码结构与执行链路。
- `docs/demo-script.md`：比赛演示脚本。
- `docs/product-definition.md`：产品定位与比赛对齐。

## 环境配置

项目入口会自动读取根目录 `.env`。推荐配置：

```dotenv
ARK_API_KEY=ark-...
ARK_MODEL=ep-...
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3

LARK_DEMO_PUSH_CHAT_ID=oc_xxx
LARK_DEMO_PUSH_AS=bot
LARK_DEMO_LLM_TIMEOUT_MS=45000
LARK_FORCE_LLM_COMPOSE=0

LARK_EVENT_SOURCE=sdk
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=xxx
LARK_SDK_LOG_LEVEL=info

LARK_RETRIEVER_SOURCES_FILE=knowledge/lark-cloud-knowledge.json
LARK_DOCS_CACHE_FILE=tmp/lark-docs-cache.json
LARK_DOCS_CACHE_TTL_MS=3600000
LARK_RETRIEVER_DISABLE_INSTALLED_SKILLS=0
```

说明：

- `.env` 已在 `.gitignore` 中，不应提交真实密钥。
- `ARK_*` 用于真实 LLM Composer。
- `LARK_FORCE_LLM_COMPOSE=1`：可将主链路知识卡整理强制切到 LLM，等价于每次运行都加 `--force-llm-compose`。
- `LARK_EVENT_SOURCE=sdk` 表示群事件默认使用官方 Node SDK WebSocket 长连接。
- `LARK_RETRIEVER_DISABLE_INSTALLED_SKILLS=1` 可用于验证“纯云端知识召回”，避免回退到本机 `~/.agents/skills`。

## 推荐测试顺序

### 1. CLI 单命令 E2E

用于验证“终端命令 -> LLM -> 知识卡 -> 飞书群推送”。

```bash
npm run demo:competition:cli
```

默认命令是：

```bash
lark-cli wiki --unknown-flag
```

常用改法：

```bash
npm run demo:competition:cli -- \
  --command "lark-cli im --help" \
  --push-chat-id "oc_xxx"
```

期望观察：

- 终端卡片中出现 `整理模式: llm`。
- 终端卡片中出现 `LLM 模型: ep-...`。
- 如果配置了 `pushChatId`，日志中出现 `push -> sent`。

### 2. CLI 交互式输入

用于验证“用户手动输入命令 -> 自动触发知识卡”的真实体验。

```bash
npm run demo:cli-shell -- \
  --force-llm-compose \
  --push-lark-card \
  --push-chat-id "oc_xxx" \
  --push-as bot \
  --push-level all \
  --push-bypass-dedupe
```

进入 Agent Shell 后输入：

```bash
lark-cli wiki --unknown-flag
```

也可以输入：

```bash
lark-cli im --help
```

### 3. 飞书群事件监听

用于验证“飞书群消息 -> 官方 SDK WebSocket 长连接 -> 知识卡推回群”。

```bash
npm run demo:competition:chat -- \
  --source-chat-id "oc_xxx" \
  --event-source sdk \
  --push-lark-card \
  --push-chat-id "oc_xxx" \
  --push-as bot \
  --push-level all \
  --push-bypass-dedupe \
  --force-llm-compose
```

启动后应看到：

```text
sdk websocket connected
ws client ready
```

然后在测试群发送：

```text
lark-cli 遇到 user 和 bot 身份选择问题，不确定当前命令应该用用户身份还是机器人身份，应该先看哪类认证规则？
```

注意：飞书长连接是集群模式，不广播。同一个应用如果同时启动多个 SDK client 或旧的 `lark-cli event +subscribe`，消息会随机分给其中一个监听进程。

### 4. 云端知识 RAG

用于验证 `knowledge/lark-cloud-knowledge.json` 中的飞书云文档或云端 Skill 文件夹能参与召回。

```bash
npm run demo:cloud-calendar
```

如果也要推送到飞书群：

```bash
npm run demo:cloud-calendar -- \
  --push-lark-card \
  --push-chat-id "oc_xxx" \
  --push-as bot \
  --push-level all \
  --push-bypass-dedupe
```

期望观察：

```text
来源: https://...feishu.cn/file/...
```

纯云端验证：

```powershell
$env:LARK_RETRIEVER_DISABLE_INSTALLED_SKILLS="1"
npm run demo:cloud-calendar
$env:LARK_RETRIEVER_DISABLE_INSTALLED_SKILLS="0"
```

### 5. 评测集 / Prove it

推荐一条命令跑完整评测路径：

```bash
npm run eval:all
```

它会依次跑小回归、32 条质量评测和 10 条 LLM 复杂评测，并生成：

```text
tmp/evaluation-suite-report.md
tmp/evaluation-suite-results.json
```

终端会输出适合演示的样本表格：

```text
Result | Case | Group | Match | Expected | Rule / Top1 Evidence | Hit Skill | Source | Compose | Time
```

需要看每条样本的 Top3 召回证据：

```bash
npm run eval:all -- --show-top3
```

小回归集用于快速确认规则和 RAG 没有被改坏：

```bash
npm run eval
```

Agent 质量评测集用于证明知识路由和召回效果，当前包含 32 条真实风格样本：

```bash
npm run eval:quality
```

LLM Composer 复杂评测集会真实调用模型，验证复杂问题是否由 LLM 压缩成知识卡：

```bash
npm run eval:llm
```

输出：

```text
tmp/evaluation-quality-report.md
tmp/evaluation-quality-results.json
tmp/evaluation-llm-report.md
tmp/evaluation-llm-results.json
```

当前质量集覆盖：

- 10 条结构化规则直达
- 17 条本地 Skill RAG
- 3 条飞书云端 calendar Skill RAG

当前本地验证结果以 `tmp/evaluation-quality-report.md` 为准。详见 `docs/evaluation.md`。
当前 LLM 评测集验证结果为 10/10 通过，且 `compose mode accuracy` 为 100.0%。

## npm Scripts

- `npm run demo`：本地样例回放，默认读取 `examples/lark-cli-error-samples.jsonl`。
- `npm run demo:competition:cli`：比赛 CLI 主入口，默认启用 LLM Composer。
- `npm run demo:competition:chat`：比赛飞书群事件主入口。
- `npm run eval`：小回归评测集，生成 `tmp/evaluation-report.md`。
- `npm run eval:quality`：32 条 Agent 质量评测集，生成 `tmp/evaluation-quality-report.md`。
- `npm run eval:llm`：10 条 LLM Composer 复杂评测集，真实调用模型并生成 `tmp/evaluation-llm-report.md`。
- `npm run eval:all`：整合三套评测的一条主测试路径，生成 `tmp/evaluation-suite-report.md`。
- `npm run demo:cloud-calendar`：云端 calendar skill folder RAG 验证。
- `npm run demo:cli-watch`：CLI Watch 通用入口，可单命令或交互运行。
- `npm run demo:cli-shell`：CLI Watch 的交互 Shell 入口别名。
- `npm run demo:lark-cli-proxy`：`lark-cli` 代理模式。
- `npm run demo:chat-event`：飞书群事件监听原始入口。
- `npm run demo:chat-poll`：飞书群轮询补偿 / 调试入口。
- `npm run demo:auto`：本地样例 + 只读工具调试。
- `npm run demo:regression`：本地规则回归验证。

## 参数说明

### 通用知识参数

- `--knowledge <path>`：结构化规则文件，默认 `knowledge/lark-cli-errors.json`。
- `--knowledge-source <local|lark-docs>`：知识规则加载模式，当前推荐保持 `local`。
- `--retriever-sources-file <path>`：通用云知识 manifest，推荐 `knowledge/lark-cloud-knowledge.json`。
- `--retriever-docs-file <path>`：旧参数，仅用于兼容历史命令。
- `--lark-cli-timeout-ms <ms>`：调用 `lark-cli` 的超时时间。
- `--debug-lark-cli`：打印底层 `lark-cli` 调用调试信息。

### 本地样例入口参数

适用于 `npm run demo -- ...`。

- `--source <path>`：JSONL 样例文件。
- `--show-regression-summary`：输出规则回归摘要。
- `--regression-failures-file <path>`：回归失败报告输出路径。
- `--quality-report-file <path>`：规则质量报告输出路径。
- `--no-quality-report`：关闭质量报告输出。
- `--lark-doc <url>`：临时加入一篇飞书文档作为知识源。
- `--lark-doc-mode <mode>`：文档读取模式。
- `--lark-doc-keyword <keyword>`：按关键词读取文档。
- `--lark-doc-as <user|bot>`：文档读取身份。

### CLI Watch 参数

适用于 `demo:cli-watch`、`demo:cli-shell`、`demo:competition:cli`。

- `--command <cmd>`：执行单条命令并分析。
- `--cwd <path>`：命令执行目录。
- `--shell <path>`：指定 shell。
- `--command-timeout-ms <ms>`：命令执行超时。
- `--trigger-all`：所有命令都触发分析。
- `--trigger-on-success`：成功命中的特定命令也触发分析，默认开启。
- `--no-trigger-on-success`：只在失败或强信号时分析。
- `--preserve-exit-code`：保留原命令退出码，适合代理模式。
- `--stderr-tail-lines <n>`：采集 stderr 尾部行数。
- `--stdout-tail-lines <n>`：采集 stdout 尾部行数。

### 飞书群事件参数

适用于 `demo:competition:chat`、`demo:chat-event`。

- `--source-chat-id <oc_xxx>`：监听来源群 ID，必填。
- `--event-source <sdk|lark-cli>`：事件源，推荐 `sdk`。
- `--app-id <cli_xxx>`：企业自建应用 App ID，SDK 模式需要。
- `--app-secret <secret>`：企业自建应用 App Secret，SDK 模式需要。
- `--sdk-log-level <debug|info|warn|error>`：SDK 日志级别。
- `--event-type <type>`：事件类型，默认 `im.message.receive_v1`。
- `--subscribe-as <bot|user>`：`lark-cli event +subscribe` 模式下的订阅身份。
- `--compact` / `--no-compact`：`lark-cli` 事件输出是否 compact。
- `--quiet` / `--no-quiet`：`lark-cli` 事件输出是否 quiet。
- `--reconcile-poll` / `--no-reconcile-poll`：是否开启历史消息轮询补偿。
- `--reconcile-as <user|bot>`：轮询补偿读取身份，默认 `user`。
- `--reconcile-interval-ms <ms>`：轮询补偿间隔。
- `--reconcile-limit <n>`：每次补偿读取消息数。

### 飞书群轮询参数

适用于 `demo:chat-poll`。

- `--source-chat-id <oc_xxx>`：轮询来源群 ID。
- `--source-chat-as <user|bot>`：读取消息身份。
- `--source-chat-limit <n>`：每次读取消息数。
- `--source-state-file <path>`：轮询游标状态文件。
- `--source-init-mode <baseline|replay>`：首次运行模式。
- `--watch`：持续轮询。
- `--interval-ms <ms>`：轮询间隔。

### LLM / Composer 参数

- `--compose-mode <template|llm|off>`：知识卡整理模式。
- `--force-llm-compose`：强制本次运行调用 LLM 参与 rules / RAG / help 证据的知识整合，等价于 `--compose-mode llm`。
- `--no-compose`：等价于 `--compose-mode off`。
- `--live-help` / `--no-live-help`：是否补充动态 `lark-cli --help` 证据。
- `--live-help-timeout-ms <ms>`：动态 help 超时。
- `--llm-api-key <key>`：LLM API Key。
- `--llm-base-url <url>`：OpenAI-compatible base URL。
- `--llm-model <model>`：模型名或 Ark endpoint ID。
- `--llm-timeout-ms <ms>`：LLM 超时。
- `--llm-temperature <number>`：LLM temperature。

如果配置了 `ARK_API_KEY`、`ARK_MODEL`、`ARK_BASE_URL`，会优先按 Ark / Doubao 路径调用。

### 推送参数

- `--push-lark-card`：启用飞书卡片推送。
- `--push-chat-id <oc_xxx>`：推送目标群 ID。
- `--push-as <bot|user>`：推送身份，推荐 `bot`。
- `--push-level <none|all|high_only|warning_and_above>`：推送门控级别。
- `--push-dedupe-ttl-ms <ms>`：去重窗口，默认 10 分钟。
- `--push-dedupe-file <path>`：去重状态文件。
- `--push-bypass-policy`：跳过推送级别门控。
- `--push-bypass-dedupe`：跳过去重，适合连续调试。

## 云知识 manifest

默认文件为 `knowledge/lark-cloud-knowledge.json`：

```json
{
  "docs": [
    {
      "id": "team-auth-rules",
      "url": "https://your-domain.feishu.cn/docx/xxx",
      "as": "user",
      "apiVersion": "v2"
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

`folders[]` 支持普通云文档文件夹，也支持上传后的 Skill 文件夹。系统会递归读取 `SKILL.md` 和 `references/*.md`，并把 Markdown 内容切成 RAG chunk。

## 比赛定位

当前版本已经能作为最小可运行的 CLI 智能知识助手演示：

```text
本地终端 / 飞书群消息
  -> 主动触发
  -> 本地规则 + Skill + 云知识 RAG
  -> LLM 证据压缩
  -> 终端卡片 / 飞书群卡片
```

下一步重点不是继续堆功能，而是进入 `Prove it`：构建评测集、记录触发成功率、Top3 召回命中率、卡片建议可执行率和人工查资料对比耗时。

## 参考文档

- `docs/architecture.md`
- `docs/demo-script.md`
- `docs/product-definition.md`
- `docs/参赛要求.md`
- `docs/对话必读.md`
