# Lark Context Agent (Direction 3 MVP)

Lark AI Challenge - track 3 minimal demo.

## Quick start

```bash
npm run demo
```

## Current MVP flow

1. Read CLI/context events from `examples/events.jsonl`
2. Match event text against local knowledge snippets (`config/knowledge.example.json`)
3. Emit a "knowledge card" to terminal

## Next iterations

- Replace local knowledge with Feishu/Lark sources (Docs, Minutes, IM)
- Add ranking/scoring and structured action-items extraction
- Add message card output to Feishu chat
