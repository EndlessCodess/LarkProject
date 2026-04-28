# Lark CLI Context Agent

A Direction-C MVP for the Feishu/Lark OpenClaw AI Challenge.

This project is a Skill-aware CLI context agent for Feishu/Lark workflows. It observes `lark-cli` error/context events, loads structured knowledge from local rules or Feishu/Lark cloud documents, routes issues to relevant `lark-*` Skill knowledge, and emits actionable CLI knowledge cards.

The product direction is not just “match error text with rules”. The intended agent loop is:

```text
terminal state / lark-cli error / Feishu resource link
        ↓
context recognition
        ↓
Skill knowledge routing
        ↓
tool-call planning
        ↓
safe lark-cli read-only checks / confirmed writes
        ↓
interpreted result
        ↓
Knowledge Card output
```

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

## Next agent flow

```text
matched knowledge rule
        ↓
tool_plan generation
        ↓
optional --auto-readonly execution
        ↓
result interpretation
        ↓
enhanced Knowledge Card
```

The next implementation step is to add `tool_plan` metadata to knowledge rules and support safe automatic execution for read-only `lark-cli` checks. Write/delete/send operations must remain confirmation-gated.

## Knowledge sources

- Local rules: `knowledge/lark-cli-errors.json`
- Cloud docs adapter: `src/adapters/knowledge-source/larkDocsKnowledgeSource.js`
- Integration notes: `docs/lark-cli-integration.md`
- Product definition: `docs/product-definition.md`

## What it proves

- Event-driven knowledge distribution for CLI scenarios
- Skill-aware routing for common Feishu/Lark OpenAPI issues
- Actionable and traceable output cards
- A practical path from static rule matching to a semi-automatic CLI context agent
- A safe execution model: read-only automation first, confirmation for writes

## Key files

- `docs/product-definition.md`: product positioning, agent architecture, and challenge alignment
- `docs/lark-cli-integration.md`: lark-cli cloud document knowledge-source design
- `skills/lark-cli-knowledge-assistant/SKILL.md`: OpenClaw Skill definition
- `knowledge/lark-cli-errors.json`: structured local error knowledge rules
- `examples/lark-cli-error-samples.jsonl`: demo error event stream
- `src/`: runnable MVP implementation
