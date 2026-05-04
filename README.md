# Lark CLI Context Agent

一个面向飞书 / Lark `lark-cli` 工作流的上下文知识助手原型。

它不是单纯的“错误文本匹配器”，而是一个围绕 **终端上下文识别 → Skill 知识路由 → 工具调用计划 → 结构化知识卡片输出** 构建的 Direction-C 方向原型。

当前项目已经支持把 CLI 诊断结果以 **飞书知识卡片** 的形式推送到群聊中，并具备基础的 **推送策略分级**、**去重节流** 与 **小样本调试能力**。

---

## 当前能力概览

当前版本已经具备以下能力：

- 读取 `lark-cli` 错误/上下文事件流
- 支持驻留式 CLI 监听，开发者在 Agent Shell 中执行命令后可自动触发知识卡
- 基于本地知识规则进行匹配
- 生成结构化 CLI 知识卡片
- 在终端中输出知识卡摘要
- 生成本地卡片产物 `tmp/lark-card-artifact.json`
- 将知识卡推送到飞书群聊
- 根据规则类别渲染不同卡片模板
- 为高优先级卡片提供更强视觉提示
- 支持推送策略分级与去重节流
- 支持小样本快速调试与推送门控绕过
- 支持从测试群轮询最近消息并主动触发知识卡
- 支持从真实终端命令失败或特定 `lark-cli` 命令中主动触发知识卡

---

## 当前工作流

```text
terminal command / terminal state / lark-cli error / Feishu resource link
        ↓
context recognition
        ↓
local knowledge matching
        ↓
tool-call planning
        ↓
terminal knowledge card
        ↓
Lark interactive knowledge card
        ↓
Feishu group delivery
```

---

## 核心目录

- `docs/product-definition.md`：产品定位、阶段规划、比赛对齐说明
- `knowledge/lark-cli-errors.json`：本地知识规则库
- `examples/lark-cli-error-samples.jsonl`：完整样本集
- `examples/lark-cli-error-samples-small.jsonl`：轻量调试样本集
- `src/app/runDemo.js`：本地样本 Demo 主流程入口
- `src/cliWatchMain.js`：驻留式 CLI Shell 入口，支持交互命令终端与单命令测试
- `src/chatPollMain.js`：测试群轮询触发知识卡的独立入口
- `src/adapters/output/larkCardPayload.js`：飞书知识卡 payload 构造
- `src/adapters/output/sendLarkInteractiveCard.js`：飞书卡片发送适配器
- `src/adapters/output/pushPolicy.js`：推送策略分级与去重节流
- `tmp/lark-card-artifact.json`：最近一次生成的飞书卡片产物

---

## 快速开始

### 本地运行

```bash
npm run demo
```

### Docker 开发环境

```bash
docker compose build
docker compose run --rm app npm run demo
```

### 进入交互式容器

```bash
docker compose run --rm app bash
```

---

## 常用运行方式

### 1. 跑完整样本集

```bash
node "./src/main.js" --show-regression-summary
```

适合：
- 查看完整匹配效果
- 观察规则命中覆盖率
- 输出回归摘要和规则质量报告

---

### 2. 跑小样本集做快速调试

```bash
node "./src/main.js" --source "examples/lark-cli-error-samples-small.jsonl" --show-regression-summary
```

适合：
- 调整知识卡片样式
- 验证少量代表性规则
- 避免一次推送过多卡片

---

### 3. 推送飞书知识卡到群聊

```bash
node "./src/main.js" \
  --source "examples/lark-cli-error-samples-small.jsonl" \
  --show-regression-summary \
  --push-lark-card \
  --push-chat-id "oc_xxx" \
  --push-as bot
```

说明：
- `--push-chat-id` 指定目标群聊
- `--push-as` 默认可用 `bot`
- 卡片推送前会经过策略分级与去重判断

---

### 4. 从测试群轮询错误并主动推送知识卡

```bash
node "./src/chatPollMain.js" \
  --source-chat-id "oc_d32c2e3e2eb66b2efca3ef677620233e" \
  --source-chat-as user \
  --source-chat-limit 20 \
  --source-state-file "tmp/chat-poll-state.json" \
  --source-init-mode baseline \
  --push-lark-card \
  --push-chat-id "oc_d32c2e3e2eb66b2efca3ef677620233e" \
  --push-as bot \
  --push-bypass-policy \
  --push-bypass-dedupe
```

适合：
- 从测试群最近消息中抓取 `lark-cli` 错误文本或自然语言求助
- 验证“群消息 -> 主动知识卡”最小闭环
- 演示基于轮询的主动触发效果

说明：
- 当前最稳的测试组合是：`--source-chat-as user` 读取消息，`--push-as bot` 发送知识卡
- 默认会使用本地 state 文件记录最近消费过的消息，只处理新的聊天消息
- `--source-init-mode baseline` 首次运行时只建立游标，不回放历史消息；如果要回放最近消息可改成 `replay`
- 当前是最小测试版，只做最近消息轮询
- 既支持标准错误文本，也支持带 `lark-cli` 上下文的自然语言求助消息
- 目前已经验证：测试群消息可被读取并触发主动知识卡发送
- 适合先验证触发效果，不替代后续正式事件订阅链路

### 5. 持续轮询命令

```bash
node "./src/chatPollMain.js" \
  --source-chat-id "oc_d32c2e3e2eb66b2efca3ef677620233e" \
  --source-chat-as user \
  --source-chat-limit 20 \
  --source-state-file "tmp/chat-poll-state.json" \
  --source-init-mode baseline \
  --watch \
  --interval-ms 5000 \
  --push-lark-card \
  --push-chat-id "oc_d32c2e3e2eb66b2efca3ef677620233e" \
  --push-as bot
```

说明：
- `--watch` 会持续轮询，不再是执行一次就退出
- `--interval-ms 5000` 表示每 5 秒轮询一次
- 当前已经会过滤 bot 自己发出的知识卡，避免持续轮询时自我触发
- 如果只是做调试验证，可以临时加 `--push-bypass-policy --push-bypass-dedupe`

---

### 6. CLI Shell

```bash
npm run demo:cli-shell -- \
  --push-lark-card \
  --push-chat-id "oc_d32c2e3e2eb66b2efca3ef677620233e" \
  --push-as bot \
  --push-level warning_and_above
```

适合：
- 演示方向 C 要求的“驻留在 CLI 终端的实时知识点推送小助手”
- 在 CLI Shell 中执行 `lark-cli` 命令，失败时自动触发知识卡
- 对 `lark-cli auth`、`lark-cli schema`、`lark-cli <service> --help` 等特定命令做成功态知识提示

示例：

```bash
agent-shell:/workspace/LarkProject$ lark-cli wiki --unknown-flag
```

说明：
- 默认只分析带 `lark-cli` 上下文的命令，避免监听无关终端操作
- 命令失败、stderr 出现 `unknown flag` / `permission denied` / `invalid` 等信号时会触发规则或 RAG
- 成功执行的特定只读命令也会触发知识召回，用于“敲击特定命令时主动推知识”的演示
- 交互模式支持基础会话态：`cd`、`pwd`、`clear`、`exit`
- 如需单命令自动化测试，可使用 `--command`

```bash
npm run demo:cli-shell -- --command "lark-cli im --help" --push-level all
```

本地也可以直接启动脚本：

```powershell
.\scripts\agent-shell.ps1 --push-level all
```

```bash
./scripts/agent-shell.sh --push-level all
```

---

### 7. lark-cli 代理模式

```bash
npm run demo:lark-cli-proxy -- im --help --agent --push-level all
```

适合：
- 让使用方式更接近原生 `lark-cli`
- 用户不需要先进 Shell，会更像“默认 lark-cli 多了一层知识感知”
- 保留真正的命令退出码，方便脚本或 CI 场景继续判断成功失败

说明：
- `--agent` 之前的参数会被视为真正传给 `lark-cli` 的参数
- `--agent` 之后的参数会传给知识监听层，例如 `--push-lark-card`、`--push-chat-id`、`--push-level`
- 代理模式会实际执行 `lark-cli`，同时在失败或命中特定命令模式时触发知识卡

示例：

```bash
npm run demo:lark-cli-proxy -- \
  wiki --unknown-flag \
  --agent \
  --push-lark-card \
  --push-chat-id "oc_d32c2e3e2eb66b2efca3ef677620233e" \
  --push-as bot \
  --push-level all \
  --push-bypass-dedupe
```

本地脚本：

```powershell
.\scripts\lark-cli-agent.ps1 im --help --agent --push-level all
```

```bash
./scripts/lark-cli-agent.sh im --help --agent --push-level all
```

---

## 推送策略与调试参数

### 推送级别

支持以下级别：

- `--push-level none`
- `--push-level all`
- `--push-level high_only`
- `--push-level warning_and_above`

默认值：

```bash
--push-level high_only
```

含义：
- 只推送高优先级事件
- 通常要求 `severity=error` 或 `risk=high`

---

### 去重节流

默认会对推送事件做去重：

- 默认 TTL：`600000ms`（10 分钟）
- 状态文件：`tmp/push-dedupe-state.json`

可自定义：

```bash
--push-dedupe-ttl-ms 600000
--push-dedupe-file "tmp/push-dedupe-state.json"
```

---

### 为了调试方便，跳过门控机制

#### 跳过推送策略分级

```bash
--push-bypass-policy
```

作用：
- 不再检查 `pushLevel`
- 适合调试某张原本不会被推送的卡片

#### 跳过去重节流

```bash
--push-bypass-dedupe
```

作用：
- 即使连续两次是同一事件，也会再次推送
- 适合连续调试卡片 UI

---

### 推荐调试命令

如果你只是想调试卡片效果，推荐直接使用：

```bash
node "./src/main.js" \
  --source "examples/lark-cli-error-samples-small.jsonl" \
  --show-regression-summary \
  --push-lark-card \
  --push-chat-id "oc_d32c2e3e2eb66b2efca3ef677620233e" \
  --push-as bot \
  --push-bypass-policy \
  --push-bypass-dedupe
```

这样可以保证：
- 样本量小
- 群里不会一次刷很多卡
- 每次修改后都能立刻看到新卡片
- 不会被策略分级或去重机制挡住

---

## 当前知识卡片特性

当前飞书知识卡片已经具备：

- 按规则类别分模板
- 高优先级卡片强化提醒
- 结论先行的内容结构
- 关键信息压缩展示
- 建议动作精简展示
- 单独突出建议命令
- 上下文信息弱化到底部

这使它更适合在群聊中被快速浏览，而不是像日志一样堆叠大段文字。

---

## 当前项目证明了什么

这个原型已经证明：

- CLI 场景下的事件驱动知识分发是可行的
- `lark-cli` 错误上下文可以被结构化解释
- Skill-aware 路由能提升问题诊断质量
- 飞书知识卡片可以成为终端知识的外部化载体
- 从“规则匹配”走向“半自动上下文 Agent”有清晰路径
- 从测试群轮询消息并主动触发知识卡的路径可行
- 从 CLI 终端命令执行结果主动触发知识卡的路径可行

---

## 下一步方向

后续可以继续推进：

- 更细粒度的分类卡片模板
- 真正可用的按钮交互动作
- 推送对象分级（终端 / 群聊 / 私聊）
- 更稳定的只读自动执行链路
- 从轮询演进到正式事件订阅和终端监听的统一评测
- 更强的上下文聚合与来源追踪

---

## 参考文档

- `docs/product-definition.md`
- `docs/lark-cli-integration.md`
- `docs/对话必读.md`

如果你准备继续调知识卡片体验，优先从 `examples/lark-cli-error-samples-small.jsonl` + `--push-bypass-policy --push-bypass-dedupe` 这一套调试链路开始。
---

## LLM Composer

项目入口现在会自动读取根目录 `.env`，所以常用模型和演示配置不需要每次手动 export / set。

当前项目已经支持真实 LLM Composer，但默认仍保持本地 `template` 模式，避免没有模型密钥时影响演示。

### 启用方式

推荐先通过环境变量提供模型配置：

```powershell
$env:OPENAI_API_KEY="your_api_key"
$env:OPENAI_MODEL="gpt-4.1-mini"
```

如果你用的是火山引擎 Ark / Doubao，可以直接这样配：

```powershell
$env:ARK_API_KEY="ark-..."
$env:ARK_MODEL="ep-20260423223104-568xj"
$env:ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
```

然后在任意入口加上：

```bash
--compose-mode llm
```

例如：

```bash
npm run demo:lark-cli-proxy -- wiki --unknown-flag --agent --compose-mode llm --push-level all
```

### 可选参数

```bash
--llm-api-key <key>
--llm-base-url <url>
--llm-model <model>
--llm-timeout-ms 20000
--llm-temperature 0.2
```

### 当前行为

- `compose-mode=llm`：优先调用真实 LLM，对规则、RAG 召回和动态 `lark-cli --help` 证据做压缩。
- 如果缺少 `OPENAI_API_KEY`、接口超时或返回格式异常，会自动回退到 `template`，并在终端 Debug Card 里显示回退原因。
- 当前接入的是 OpenAI-compatible `chat/completions` 接口，兼容 OpenAI 和火山引擎 Ark / Doubao 这类兼容网关。
- 火山引擎路径优先读取 `ARK_API_KEY`、`ARK_MODEL` 和 `ARK_BASE_URL`。

### CLI Watch LLM E2E

项目内置了一个正式的端到端测试入口，用来演示：

`terminal input -> LLM composer -> knowledge card -> Feishu push`

先配置豆包 / Ark 环境变量：

```powershell
$env:ARK_API_KEY="ark-..."
$env:ARK_MODEL="ep-20260423223104-568xj"
$env:ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
```

或者直接把这些配置写到项目根目录 `.env`，脚本会自动加载。

然后直接运行：

```bash
npm run demo:cli-watch-llm
```

如果要完整推送到飞书群：

```bash
npm run demo:cli-watch-llm -- --push-chat-id "oc_xxx"
```

默认测试命令是：

```bash
lark-cli wiki --unknown-flag
```

你也可以改成自己的终端命令：

```bash
npm run demo:cli-watch-llm -- --command "lark-cli im --help" --push-chat-id "oc_xxx"
```

完整说明见：

- `examples/cli-watch-llm-e2e.md`

## Knowledge Sources

当前 RAG 检索默认会优先使用仓库内镜像的 `lark-*` skill 文档：

- `knowledge/skills/lark-shared/`
- `knowledge/skills/lark-doc/`
- `knowledge/skills/lark-im/`
- `knowledge/skills/lark-wiki/`
- 以及其余同步进仓库的 `lark-*` skills

这些目录来自本机已安装的 `lark-cli` skills 镜像，检索时会优先读取仓库副本；如果某个 skill 没有镜像进仓库，才会回退读取本机 `~/.agents/skills`。

### Cloud Knowledge Interface

为了体现飞书云文档整合能力，项目还预留了一个云端知识入口：

- 默认清单：`knowledge/lark-cloud-knowledge.json`

把你的飞书文档 URL 填进 `docs` 数组后，这些文档会在构建 retriever 时通过 `lark-cli docs +fetch --api-version v2` 拉取内容，再按 chunk 进入本地 RAG 索引。

如果你维护的是一个飞书文件夹，也可以直接写到 `folders` 数组里。系统会先调用 `lark-cli drive files list` 列出文件夹内容，再自动把其中的 `doc/docx/wiki` 文档展开成知识源。
云文档和文件夹展开结果默认会缓存到 `tmp/lark-docs-cache.json`，默认 TTL 为 1 小时，避免每次启动都重新拉取。

示例：

```json
{
  "docs": [
    {
      "id": "skill-doc-auth-routing",
      "url": "https://your-feishu-domain/docx/replace-with-real-doc-url",
      "as": "user",
      "apiVersion": "v2"
    }
  ],
  "folders": [
    {
      "id": "calendar-skill-folder",
      "folderUrl": "https://your-feishu-domain/drive/folder/replace-with-real-folder-token",
      "as": "user",
      "pageSize": 200
    }
  ]
}
```

可选命令参数：

```bash
--retriever-sources-file knowledge/lark-cloud-knowledge.json
```

或者使用环境变量：

```powershell
$env:LARK_RETRIEVER_SOURCES_FILE="knowledge/lark-cloud-knowledge.json"
```

兼容旧参数：

```bash
--retriever-sources-file knowledge/lark-cloud-knowledge.json
```

可选缓存环境变量：

```powershell
$env:LARK_DOCS_CACHE_FILE="tmp/lark-docs-cache.json"
$env:LARK_DOCS_CACHE_TTL_MS="3600000"
```

???????????????? `~/.agents/skills`?????

```powershell
$env:LARK_RETRIEVER_DISABLE_INSTALLED_SKILLS="1"
```

Calendar 云文档样例：

```bash
npm run demo -- --source examples/lark-cloud-calendar-samples.jsonl --retriever-sources-file knowledge/lark-cloud-knowledge.json --no-quality-report
```
