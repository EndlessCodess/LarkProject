# Repository Structure

```text
LarkProject/
├─ .devcontainer/
│  └─ devcontainer.json
├─ .dockerignore
├─ .gitignore
├─ compose.yaml
├─ Dockerfile
├─ package.json
├─ README.md
├─ config/
│  └─ knowledge-sources.example.json
├─ docs/
│  ├─ lark-cli-help.md
│  ├─ lark-cli-integration.md
│  ├─ product-definition.md
│  ├─ repo-structure.md
│  └─ 参赛要求.md
├─ examples/
│  └─ lark-cli-error-samples.jsonl
├─ history/
│  └─ 2026-04-25.md
├─ knowledge/
│  └─ lark-cli-errors.json
├─ skills/
│  └─ lark-cli-knowledge-assistant/
│     └─ SKILL.md
└─ src/
   ├─ main.js
   ├─ app/
   │  └─ runDemo.js
   ├─ core/
   │  ├─ io.js
   │  ├─ matcher.js
   │  └─ knowledge/
   │     ├─ cloudKnowledgeNormalizer.js
   │     └─ loadKnowledge.js
   └─ adapters/
      ├─ event-source/
      ├─ knowledge-source/
      │  ├─ larkDocsKnowledgeSource.js
      │  └─ localKnowledgeSource.js
      ├─ lark-cli/
      │  └─ runner.js
      └─ output/
         └─ terminalCard.js
```

## Module Responsibilities

- `Dockerfile`, `compose.yaml`, `.devcontainer/devcontainer.json`
  - Define the Ubuntu 24.04 development container with Node.js, npm, git, jq and `lark-cli`.
  - Keep the default workflow Linux/bash-compatible while mounting the current project directory.
- `skills/lark-cli-knowledge-assistant/SKILL.md`
  - Defines when OpenClaw should route lark-cli/OpenAPI/OpenClaw error contexts to this assistant.
- `knowledge/lark-cli-errors.json`
  - Structured local rules for classifying common CLI error scenarios and producing actionable repair cards.
- `src/adapters/lark-cli/runner.js`
  - Safe subprocess wrapper for read-only `lark-cli` integrations.
- `src/adapters/knowledge-source/localKnowledgeSource.js`
  - Loads local JSON rules.
- `src/adapters/knowledge-source/larkDocsKnowledgeSource.js`
  - Fetches Feishu/Lark cloud docs through `lark-cli docs +fetch` and converts them into knowledge rules.
- `src/core/knowledge/cloudKnowledgeNormalizer.js`
  - Normalizes cloud-document text into the same knowledge rule shape as local JSON.
- `examples/lark-cli-error-samples.jsonl`
  - Event-driven demo input that simulates terminal error events.
- `src/core/matcher.js`
  - Rule matching and priority scoring.
- `src/adapters/output/terminalCard.js`
  - Terminal knowledge-card renderer.

## MVP Boundary

The current implementation still defaults to local JSONL events and local rules for reproducibility. The cloud-docs adapter is scaffolded according to `docs/lark-cli-help.md`, and real cloud-document usage should be triggered explicitly with `--knowledge-source lark-docs --lark-doc <url>`.
