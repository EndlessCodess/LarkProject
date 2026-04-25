# Lark CLI Context Agent

A Direction-C MVP for the Feishu/Lark OpenClaw AI Challenge.

This project is an OpenClaw Skill-based CLI context knowledge distribution agent. It detects `lark-cli` error/context events, loads knowledge rules from local files or Feishu/Lark cloud documents, and emits actionable CLI knowledge cards.

## Quick start

Local host:

```bash
npm run demo
```

Docker dev environment:

```bash
docker compose build
docker compose run --rm app npm run demo
```

Interactive container:

```bash
docker compose run --rm app bash
```

## Current MVP flow

```text
examples/lark-cli-error-samples.jsonl
        ↓
knowledge/lark-cli-errors.json / Feishu cloud docs
        ↓
rule matching
        ↓
CLI Knowledge Card output
```

## Knowledge sources

- Local rules: `knowledge/lark-cli-errors.json`
- Cloud docs adapter: `src/adapters/knowledge-source/larkDocsKnowledgeSource.js`
- Integration notes: `docs/lark-cli-integration.md`

## What it proves

- Event-driven knowledge distribution for CLI scenarios
- Structured knowledge extraction from common lark-cli/OpenClaw issues
- Actionable and traceable output cards
- A clear path to integrate real `lark-*` Skills and Feishu knowledge sources

## Key files

- `docs/product-definition.md`: product positioning and challenge alignment
- `docs/lark-cli-integration.md`: lark-cli cloud document knowledge-source design
- `skills/lark-cli-knowledge-assistant/SKILL.md`: OpenClaw Skill definition
- `knowledge/lark-cli-errors.json`: structured local error knowledge rules
- `examples/lark-cli-error-samples.jsonl`: demo error event stream
- `src/`: runnable MVP implementation
