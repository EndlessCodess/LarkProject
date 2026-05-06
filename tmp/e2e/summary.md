# Real E2E Test Matrix

- Generated at: 2026-05-05T12:20:08.141Z
- Cases: 1
- Passed: 1
- Failed: 0
- Push enabled: yes

| Case | Result | Duration | Log | Checks |
|---|---:|---:|---|---|
| cli-command-llm-card | PASS | 46268 ms | tmp\e2e\cli-command-llm-card.log | OK [demo:cli-watch-llm] running end-to-end demo<br>OK [cli-watch] candidate<br>OK [CLI Knowledge Card |

## Manual Evidence Tips

- `cli-command-llm-card` proves terminal command -> LLM/template composer -> terminal card -> optional Feishu push.
- `cli-shell-manual-stdin` proves the Agent Shell accepts user-entered commands and triggers the same knowledge card path.
- `cloud-calendar-rag` proves cloud knowledge manifest contributes retriever evidence.
- `chat-sdk-listener-live` is optional; run it with `--include-chat-listener` and send a test message in the Feishu group during the listening window.
