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
  - The container has its own `lark-cli` configuration state; host configuration is not automatically available inside Docker.

- `skills/lark-cli-knowledge-assistant/SKILL.md`
  - Defines when OpenClaw should route `lark-cli`, OpenAPI and OpenClaw error contexts to this assistant.
  - This is the project-facing Skill entrypoint, not the installed upstream `lark-*` Skill knowledge itself.

- `knowledge/lark-cli-errors.json`
  - Structured local rules for classifying common CLI error scenarios and producing actionable repair cards.
  - Next step: add `tool_plan` metadata so rules can describe safe read-only checks and confirmation-gated write operations.

- `src/adapters/lark-cli/runner.js`
  - Subprocess wrapper for invoking `lark-cli`.
  - On Windows it routes through `cmd.exe`; on Linux/Docker it calls `lark-cli` directly.
  - It should stay execution-focused and avoid business interpretation.

- `src/adapters/knowledge-source/localKnowledgeSource.js`
  - Loads local JSON rules.

- `src/adapters/knowledge-source/larkDocsKnowledgeSource.js`
  - Fetches Feishu/Lark cloud docs through `lark-cli docs +fetch` and converts them into candidate knowledge documents.
  - This is read-only by design.

- `src/core/knowledge/cloudKnowledgeNormalizer.js`
  - Normalizes cloud-document text into the same knowledge rule shape as local JSON.
  - Next step: distinguish normal prose documents from structured rule documents and return diagnostics when no rules are parsed.

- `examples/lark-cli-error-samples.jsonl`
  - Event-driven demo input that simulates terminal error events.
  - This is the current Context Collector substitute.

- `src/core/matcher.js`
  - Rule matching and priority scoring.
  - Future agent stages can feed its matched rule into a Tool Planner.

- `src/adapters/output/terminalCard.js`
  - Terminal knowledge-card renderer.
  - Next step: include `tool_plan`, execution safety level and optional read-only execution results.

## Agent Architecture Mapping

The project is evolving from a static rule matcher into a semi-automatic context agent:

```text
Context Collector       -> examples JSONL today; terminal / hook / IDE stream later
Intent Router           -> matcher + route_to_skills today; Skill index later
Skill Knowledge Index   -> local JSON / cloud docs today; installed lark-* Skill parsing later
Tool Planner            -> planned; based on rule.tool_plan
Tool Executor           -> src/adapters/lark-cli/runner.js
Result Interpreter      -> planned; parse lark-cli JSON/errors into agent states
Card Renderer           -> src/adapters/output/terminalCard.js
```

## MVP Boundary

The current implementation still defaults to local JSONL events and local rules for reproducibility. The cloud-docs adapter can read real Feishu cloud documents when explicitly invoked with:

```bash
node src/main.js \
  --source examples/lark-cli-error-samples.jsonl \
  --knowledge-source lark-docs \
  --lark-doc <url>
```

If this returns `0 knowledge rules` without a fetch error, it means the document was read successfully but did not match the structured rule format expected by the normalizer.

## Near-term Development Boundary

- Read-only `lark-cli` checks may become auto-executable behind an explicit `--auto-readonly` flag.
- Write/delete/send operations must remain confirmation-gated.
- Dangerous operations should prefer dry-run or preview flows before execution.
