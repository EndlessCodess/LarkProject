# CLI Watch LLM E2E

This is the project-level end-to-end test case for:

`terminal input -> LLM composer -> knowledge card -> Feishu push`

## Required env

```powershell
$env:ARK_API_KEY="ark-..."
$env:ARK_MODEL="ep-20260423223104-568xj"
$env:ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
```

Optional:

```powershell
$env:LARK_DEMO_PUSH_CHAT_ID="oc_xxx"
$env:LARK_DEMO_PUSH_AS="bot"
```

## Run

Terminal card only:

```bash
npm run demo:cli-watch-llm
```

Terminal card + Feishu push:

```bash
npm run demo:cli-watch-llm -- --push-chat-id "oc_xxx"
```

Custom command:

```bash
npm run demo:cli-watch-llm -- --command "lark-cli wiki --unknown-flag" --push-chat-id "oc_xxx"
```

## Expected signals

In terminal:

- `整理模式: llm`
- `LLM 模型: ep-20260423223104-568xj`
- `push -> sent` when Feishu push is enabled

In Feishu group:

- A knowledge card is sent for the terminal command event
- The card contains diagnosis, suggested actions, and next command
