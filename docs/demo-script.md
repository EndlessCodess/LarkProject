# Demo Script

本文档用于比赛演示和录屏前检查。当前建议主讲两条链路：CLI 主入口和飞书群事件入口。

## 1. 演示前准备

确认 `.env` 至少包含：

```dotenv
ARK_API_KEY=ark-...
ARK_MODEL=ep-...
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
LARK_DEMO_PUSH_CHAT_ID=oc_xxx
LARK_DEMO_PUSH_AS=bot
LARK_EVENT_SOURCE=sdk
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=xxx
LARK_RETRIEVER_SOURCES_FILE=knowledge/lark-cloud-knowledge.json
```

确认知识源：

- 本地规则：`knowledge/lark-cli-errors.json`
- 本地 Skill：`knowledge/skills/`
- 云知识：`knowledge/lark-cloud-knowledge.json`

## 2. 主线一：CLI 终端触发

命令：

```bash
npm run demo:competition:cli
```

默认演示命令：

```bash
lark-cli wiki --unknown-flag
```

观察点：

- 触发模式显示为 `cli_watch`
- `整理模式` 显示为 `llm`，表示真实 LLM Composer 成功参与
- 卡片中有诊断、建议步骤、下一步命令和来源
- 如果 `.env` 配了群 ID，日志应显示 `push -> sent`

讲法：

> 开发者在终端执行 `lark-cli` 命令出错后，系统自动捕获命令、退出码和 stderr，再从规则库、Skill 和云端知识中召回证据，交给 LLM 压缩成知识卡，并推送到终端和飞书群。

## 3. 主线二：飞书群事件触发

命令：

```bash
npm run demo:competition:chat -- \
  --source-chat-id "oc_xxx" \
  --event-source sdk \
  --push-lark-card \
  --push-chat-id "oc_xxx" \
  --push-as bot \
  --push-level all
```

群里发送：

```text
lark-cli 遇到 user 和 bot 身份选择问题，不确定当前命令应该用用户身份还是机器人身份，应该先看哪类认证规则？
```

观察点：

- 事件订阅收到 `im.message.receive_v1`
- 规则未命中时进入 RAG
- 卡片被推回测试群

讲法：

> 除了本地终端，团队成员也可以在飞书群里贴出报错或提问。Agent 会把群消息当作知识事件处理，让团队知识在协作空间里主动分发。

## 4. 云知识验证

命令：

```bash
npm run demo:cloud-calendar
```

如果要验证纯云端召回：

```powershell
$env:LARK_RETRIEVER_DISABLE_INSTALLED_SKILLS="1"
npm run demo:cloud-calendar
```

观察点：

- 召回证据来源出现飞书 `file/...` 或文档 URL
- 不是只命中 `knowledge/skills/...` 或 `~/.agents/skills/...`

## 5. 演示边界

当前版本重点证明“主动触发 + 知识整合 + 卡片分发”。它不是通用聊天机器人，也不会自动执行高风险写操作。LLM 的职责是压缩证据、生成高密度知识卡，不替代检索和来源追踪。
