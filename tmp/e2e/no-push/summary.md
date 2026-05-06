# Real E2E Test Matrix

- Generated at: 2026-05-05T12:28:30.335Z
- Cases: 3
- Passed: 3
- Failed: 0
- Push enabled: no

| Case | Result | Duration | Log | Checks |
|---|---:|---:|---|---|
| cli-command-llm-card | PASS | 45877 ms | tmp/e2e/no-push/cli-command-llm-card.log | OK [demo:cli-watch-llm] running end-to-end demo<br>OK [cli-watch] candidate<br>OK [CLI Knowledge Card |
| cli-shell-manual-stdin | PASS | 37645 ms | tmp/e2e/no-push/cli-shell-manual-stdin.log | OK [cli-watch] Agent shell started<br>OK [cli-watch] run: lark-cli wiki --unknown-flag<br>OK [CLI Knowledge Card |
| cloud-calendar-rag | PASS | 30822 ms | tmp/e2e/no-push/cloud-calendar-rag.log | OK lark-calendar<br>OK 召回证据<br>OK feishu.cn/file |

## Manual Evidence Tips

- `cli-command-llm-card` proves terminal command -> LLM/template composer -> terminal card -> optional Feishu push.
- `cli-shell-manual-stdin` proves the Agent Shell accepts user-entered commands and triggers the same knowledge card path.
- `cloud-calendar-rag` proves cloud knowledge manifest contributes retriever evidence.
- `chat-sdk-listener-live` is optional; run it with `--include-chat-listener` and send a test message in the Feishu group during the listening window.
