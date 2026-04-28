# lark-cli 云文档知识源接入设计

## 目标

当前 MVP 使用本地规则库：

```text
knowledge/lark-cli-errors.json
```

下一阶段要支持从飞书云文档读取知识规则，使实际业务中团队可以把 Runbook、错误处理指南、OpenClaw Skill 使用规范沉淀在飞书 Docs 中，再由本项目通过 `lark-cli` 拉取并转换为可匹配、可规划工具调用的知识单元。

本设计服务于更大的 Agent 目标：

```text
云文档 / 本地规则 / Skill 文档
        ↓
统一知识规则
        ↓
错误匹配与 Skill 路由
        ↓
Tool Plan
        ↓
Knowledge Card
```

---

## Skill 与 lark-cli 的关系

本项目不把 Skill 当作运行时 API。Skill Markdown 是给 Agent 使用的操作手册，`lark-cli` 才是真正执行飞书接口调用的工具。

例如：

```text
lark-doc/SKILL.md 告诉 Agent 读取文档应使用 docs +fetch
lark-shared/SKILL.md 告诉 Agent 遇到权限问题如何区分 user/bot
lark-base/SKILL.md 告诉 Agent Base 链接、字段和记录操作的约束
```

因此项目中的云文档知识源需要把自然语言操作手册和团队 runbook 转成结构化规则，而不是“直接调用 Skill”。

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
  - Windows 下通过 `cmd.exe` 调用，Linux/Docker 下直接调用 `lark-cli`。

- `src/adapters/knowledge-source/localKnowledgeSource.js`
  - 读取本地 JSON 规则库。

- `src/adapters/knowledge-source/larkDocsKnowledgeSource.js`
  - 通过 `lark-cli docs +fetch` 拉取飞书云文档。
  - 当前只做读取，不执行任何写入操作。

- `src/core/knowledge/cloudKnowledgeNormalizer.js`
  - 把云文档文本转换为统一知识规则结构。
  - 下一步应能区分“普通文档读取成功但不是规则格式”和“读取失败”。

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

注意：`docs/lark-cli-help.md` 中提到的 `--api-version`、`--mode`、`--keyword` 与当前本机 `lark-cli docs +fetch -h` 输出不一致，当前代码暂不使用这些参数，避免运行时报 `unknown flag`。

---

## Docker 环境注意事项

Docker/Linux 环境可以运行 Node demo，但容器内的 `lark-cli` 配置状态与 Windows 宿主机不同。

如果容器内执行：

```bash
lark-cli docs +fetch --doc <doc_url_or_token> --as user --format json
```

返回：

```json
{"type":"config","message":"not configured"}
```

说明容器内需要单独执行：

```bash
lark-cli config init --new
```

完成配置后再执行文档读取或项目 demo。

---

## 云文档推荐规则格式

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
source: lark-shared/SKILL.md#权限不足处理
---
category: token_type
severity: error
priority: 95
when: base_token invalid, /wiki/, wiki_token
diagnosis: 可能把 wiki_token 当成了 base_token。
route_to_skills: lark-wiki, lark-base
suggested_actions: 先解析 Wiki 节点, 获取 obj_token, 再进入 Base 操作
next_command_template: lark-cli wiki spaces get_node --params '{"token":"<wiki_token>"}' --as user
source: lark-base/SKILL.md#Token 与链接
```

解析规则：

- `---` 分隔多条知识单元。
- `when` 用逗号分隔多个触发词。
- `route_to_skills` 用逗号分隔多个 Skill。
- `suggested_actions` 用逗号分隔多个步骤。

---

## 下一阶段规则格式：Tool Plan

为了支持半自动 Agent，每条规则后续应支持 `tool_plan`。

推荐 JSON 形态如下：

```json
{
  "tool_plan": {
    "tool": "lark-cli",
    "readonly": true,
    "requires_confirmation": false,
    "command_template": "lark-cli wiki spaces get_node --params '{\"token\":\"<wiki_token>\"}' --as user"
  }
}
```

纯文本云文档可以先用扁平字段表达：

```text
tool: lark-cli
tool_readonly: true
tool_requires_confirmation: false
tool_command_template: lark-cli wiki spaces get_node --params '{"token":"<wiki_token>"}' --as user
```

后续 normalizer 可把这些字段转换为统一的 `tool_plan` 对象。

---

## 普通文档与规则文档的区别

当运行云文档知识源时出现：

```text
Loaded 8 events, 0 knowledge rules.
```

如果没有 fetch error，通常表示：

```text
云文档读取成功，但该文档不是结构化规则格式，normalizer 没有解析出知识规则。
```

下一步需要增强 normalizer：

- 输出规则解析诊断。
- 标记文档是普通说明文档还是规则文档。
- 提示推荐规则格式。
- 可选支持从自然语言段落中半自动抽取规则草案。

---

## 安全边界

当前接入只做读取：

- 不创建文档。
- 不修改文档。
- 不发送消息。
- 不创建任务。
- 不默认调用任何写操作。

后续 Agent 执行策略：

- `--auto-readonly`：只允许自动执行只读命令。
- `--allow-write`：写操作仍需用户显式确认。
- 删除、owner 转移、批量写入等危险操作必须二次确认或 dry-run。

---

## 下一步开发建议

1. 为 `knowledge/lark-cli-errors.json` 增加 `tool_plan` 字段。
2. 更新 `terminalCard`，展示工具调用计划、安全级别和确认要求。
3. 新增 `--auto-readonly` 参数，允许自动执行只读 `lark-cli` 检查。
4. 增强 `cloudKnowledgeNormalizer`，区分普通文档与规则文档。
5. 准备一篇飞书云文档，按“云文档推荐规则格式”写 2~3 条规则。
6. 用 `--knowledge-source lark-docs --lark-doc <url>` 跑通读取链路。
7. 增加缓存层，避免每次 Demo 都请求云文档。
8. 接入飞书消息卡片输出。
