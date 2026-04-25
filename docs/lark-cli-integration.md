# lark-cli 云文档知识源接入设计

## 目标

当前 MVP 使用本地规则库：

```text
knowledge/lark-cli-errors.json
```

下一阶段要支持从飞书云文档读取知识规则，使实际业务中团队可以把 Runbook、错误处理指南、OpenClaw Skill 使用规范沉淀在飞书 Docs 中，再由本项目通过 `lark-cli` 拉取并转换为可匹配的知识单元。

---

## 当前接入结构

```text
src/
├─ adapters/
│  ├─ lark-cli/
│  │  └─ runner.js
│  └─ knowledge-source/
│     ├─ localKnowledgeSource.js
│     └─ larkDocsKnowledgeSource.js
└─ core/
   └─ knowledge/
      ├─ loadKnowledge.js
      └─ cloudKnowledgeNormalizer.js
```

### 模块职责

- `src/adapters/lark-cli/runner.js`
  - 安全执行 `lark-cli` 子进程。
  - 只负责执行和返回 stdout/stderr/code，不做业务判断。

- `src/adapters/knowledge-source/localKnowledgeSource.js`
  - 读取本地 JSON 规则库。

- `src/adapters/knowledge-source/larkDocsKnowledgeSource.js`
  - 通过 `lark-cli docs +fetch` 拉取飞书云文档。
  - 当前只搭建结构，不默认执行真实账号写操作。

- `src/core/knowledge/cloudKnowledgeNormalizer.js`
  - 把云文档文本转换为统一知识规则结构。

- `src/core/knowledge/loadKnowledge.js`
  - 根据 `--knowledge-source` 选择本地知识库或云文档知识源。

---

## 本地知识库运行

```bash
npm run demo
```

等价于：

```bash
node src/main.js \
  --source examples/lark-cli-error-samples.jsonl \
  --knowledge-source local \
  --knowledge knowledge/lark-cli-errors.json
```

---

## 云文档知识源运行方式

当前先通过命令行显式传入文档链接，避免误操作账号：

```bash
node src/main.js \
  --source examples/lark-cli-error-samples.jsonl \
  --knowledge-source lark-docs \
  --lark-doc "https://example.feishu.cn/docx/xxxx"
```

当前环境已安装的 `lark-cli docs +fetch -h` 支持的参数较基础，代码以真实 CLI 为准构造命令：

```bash
lark-cli docs +fetch --doc <doc_url_or_token> --as user --format json
```

该命令返回 JSON，其中 `data.markdown` 是文档正文。当前适配器会优先读取：

- `data.markdown`
- `data.document.markdown`
- `data.content`
- 其他兼容字段

对应命令行参数：

```bash
node src/main.js \
  --source examples/lark-cli-error-samples.jsonl \
  --knowledge-source lark-docs \
  --lark-doc "https://example.feishu.cn/docx/xxxx"
```

注意：`docs/lark-cli-help.md` 中提到的 `--api-version`、`--mode`、`--keyword` 与当前本机 `lark-cli docs +fetch -h` 输出不一致，当前代码暂不使用这些参数，避免运行时报 `unknown flag`。

---

## 云文档推荐格式

为了让云文档能稳定转换为知识规则，建议每条规则在文档中按如下文本格式维护：

```text
category: permission_scope
severity: warning
priority: 100
when: permission denied, missing scope, permission_violations
diagnosis: 当前身份缺少调用该接口或命令所需的 scope。
route_to_skills: lark-shared
suggested_actions: 提取缺失 scope, user 身份执行增量授权, bot 身份去开发者后台开通权限
next_command_template: lark-cli auth login --scope "<missing_scope>"
---
category: token_type
severity: error
priority: 95
when: base_token invalid, /wiki/, wiki_token
diagnosis: 可能把 wiki_token 当成了 base_token。
route_to_skills: lark-wiki, lark-base
suggested_actions: 先解析 Wiki 节点, 获取 obj_token, 再进入 Base 操作
next_command_template: lark-cli wiki get-node --token <wiki_token> --as user
```

解析规则：

- `---` 分隔多条知识单元。
- `when` 用逗号分隔多个触发词。
- `route_to_skills` 用逗号分隔多个 Skill。
- `suggested_actions` 用逗号分隔多个步骤。

---

## 安全边界

当前接入只做读取：

- 不创建文档。
- 不修改文档。
- 不发送消息。
- 不创建任务。
- 不默认调用任何写操作。

后续如果要接入飞书消息卡片、任务创建等写操作，需要增加显式确认参数，例如：

```bash
--allow-write
```

---

## 下一步开发建议

1. 准备一篇飞书云文档，按“云文档推荐格式”写 2~3 条规则。
2. 用 `--knowledge-source lark-docs --lark-doc <url>` 跑通读取链路。
3. 增加缓存层，避免每次 Demo 都请求云文档。
4. 接入飞书消息卡片输出。
5. 后续在 Docker 环境中再次确认 `lark-cli docs +fetch -h`，如果新版 CLI 支持更多局部读取参数，再扩展适配器。
