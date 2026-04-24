# Repository Structure (Direction 3 MVP)

```text
LarkProject/
├─ .gitignore
├─ package.json
├─ README.md
├─ config/
│  └─ knowledge.example.json
├─ examples/
│  └─ events.jsonl
├─ docs/
│  ├─ repo-structure.md
│  ├─ suggestion.md
│  ├─ todo.md
│  └─ 参赛要求.md
└─ src/
   ├─ main.js
   ├─ app/
   │  └─ runDemo.js
   ├─ core/
   │  ├─ io.js
   │  └─ matcher.js
   └─ adapters/
      ├─ event-source/
      ├─ knowledge-source/
      └─ output/
         └─ terminalCard.js
```

## Module Responsibilities

- `src/main.js`
  - CLI entry and argument parsing (`--source`, `--knowledge`)
- `src/app/runDemo.js`
  - Demo orchestration: load events + load knowledge + match + output card
- `src/core/io.js`
  - Data loading utilities (JSON and JSONL)
- `src/core/matcher.js`
  - Minimal keyword-based matching strategy (MVP)
- `src/adapters/output/terminalCard.js`
  - Terminal card renderer
- `config/knowledge.example.json`
  - Sample local knowledge base
- `examples/events.jsonl`
  - Sample context/event stream for demo playback

## Why this structure works for MVP

1. Can run quickly with zero external dependency.
2. Keeps architecture ready for future adapters (Feishu Docs/Minutes/IM).
3. Easy to replace matcher with retrieval + ranking later.

## Next recommended expansion

1. Add `adapters/knowledge-source/larkDocs.js` and `larkMinutes.js`.
2. Add scoring and ranking pipeline in `core/`.
3. Add Feishu message-card output adapter in `adapters/output/`.
4. Add config profiles for dev/demo/production.
