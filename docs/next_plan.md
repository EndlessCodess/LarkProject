# 下一步行动计划：Hybrid Knowledge Agent

更新时间：2026-05-02 23:04 CST

## 1. 当前判断

项目当前已经完成了方向 C「沉浸式碎片知识推送助手」的最小可运行闭环：

```text
飞书群消息 / CLI 报错文本
        -> 主动触发（事件监听 + 轮询补偿）
        -> 本地知识规则匹配
        -> 决策与卡片构造
        -> 飞书群知识卡片推送
```

这说明项目已经不是静态 Demo，而是具备了主动触发、知识召回、卡片分发和基础去重能力的半 Agent 原型。

但当前短板也很清晰：

- 知识召回仍以写死规则为主，泛化能力不足。
- 命中规则后主要输出建议，缺少“自动找证据”和“只读验证”。
- 内部知识库、Skill 文档、历史案例和 API 实测结果还没有统一进入 Agent 决策链。
- 效果验证还没有形成可提交的评测集和报告。

因此下一步不应继续单纯扩展触发方式，而应升级知识获取与决策能力。

## 2. 下一阶段目标

下一阶段定义为：

> Hybrid Knowledge Agent：规则优先、RAG 补全、API/CLI 只读验证的主动 CLI 知识助手。

目标不是把系统做成普通聊天机器人，而是在方向 C 的场景里，让助手在开发者遇到 `lark-cli` 报错、API 参数不确定、权限或 token 类型混淆时，主动完成以下判断：

1. 当前问题是否能被高置信结构化规则直接处理。
2. 如果规则不足，应从哪些内部知识源召回相关内容。
3. 召回内容是否需要通过 `lark-cli` 只读命令验证。
4. 最终应该推送哪种高密度知识卡片。
5. 卡片中的结论、证据、来源和下一步动作是否可追溯。

## 3. 推荐架构

```text
输入上下文
  - 飞书群消息
  - CLI 报错文本
  - 命令片段
  - 飞书资源链接
        |
        v
Context Normalizer
        |
        v
Rule Matcher（高置信规则优先）
        |
        |-- 命中且置信高 --> Decision Engine --> Knowledge Card
        |
        |-- 未命中 / 置信低
        v
Knowledge Retriever（轻量 RAG）
  - 本地规则库
  - lark-* Skill Markdown
  - references 文档
  - 项目内部知识库文档
  - 历史踩坑案例
        |
        v
Tool Planner
        |
        v
Readonly Tool Executor
  - lark-cli --help
  - lark-cli schema
  - wiki token 解析
  - auth / permission 只读检查
        |
        v
Result Interpreter
        |
        v
带证据链的飞书知识卡片
```

核心原则：

- 规则高置信命中时，不强行走 RAG，保证响应快。
- 规则低置信或未命中时，再启动 RAG 检索。
- RAG 召回不是最终答案，只是 Agent 的证据来源。
- 涉及真实 API 行为时，优先通过只读 `lark-cli` 命令验证。
- 写操作、删除操作、发送消息类操作仍必须显式确认。

## 4. 实施优先级

### P0：稳定当前主动触发链路

目的：保证 Demo 可持续运行。

已完成基础能力：

- `demo:chat-event` 支持事件监听。
- 增加历史消息轮询补偿，缓解事件流漏收。
- 支持飞书知识卡片推送。
- 支持推送策略和去重。

下一步只做小修：

- 将事件监听 + 轮询补偿的运行方式补充到 README。
- 在日志中区分 `event_stream` 与 `reconcile_poll` 来源，便于 Demo 讲解。
- 为补偿轮询失败提供更明确的权限提示。

### P1：建设轻量 Knowledge Retriever

目的：从固定规则匹配升级为“能主动找知识”。

建议先做本地轻量版，不急着上复杂向量库：

1. 新增 `src/core/knowledge/retriever.js`。
2. 将以下来源切成 chunk：
   - `knowledge/lark-cli-errors.json`
   - 本地 `lark-*` Skill 的 `SKILL.md`
   - 关键 `references/*.md`
   - 项目文档中的 CLI/API 说明
3. 先实现 BM25 / 关键词加权 / 简单相似度检索。
4. 输出统一结构：

```json
{
  "source_type": "skill|rule|doc|case",
  "source": "lark-shared/SKILL.md",
  "title": "权限不足处理",
  "content": "...",
  "score": 0.82,
  "matched_terms": ["permission", "scope", "bot"]
}
```

这样可以先证明“自动找知识”，后续再替换为 embedding RAG。

### P2：建立规则 + RAG 的决策分流

目的：让系统自己决定是否需要 RAG。

建议新增一个 `KnowledgeDecision`：

```text
rule_hit_high_confidence:
  直接生成卡片

rule_hit_low_confidence:
  使用 RAG 补证据，再生成卡片

rule_miss:
  使用 RAG 主召回；如果召回不足，输出“需要补充知识库”的卡片

rag_hit_with_tool_signal:
  进入 Tool Planner，尝试只读验证
```

卡片中应展示：

- 规则是否命中。
- 是否启用 RAG。
- 召回到哪些知识来源。
- 哪些结论来自知识库。
- 哪些结论来自只读命令验证。

### P3：接入只读 API/CLI 验证

目的：把“建议”升级为“验证后的诊断”。

优先实现 4 类只读验证：

1. 命令存在性检查：

```bash
lark-cli <service> --help
lark-cli <service> +<shortcut> --help
```

2. 原生 API 参数结构检查：

```bash
lark-cli schema <service.resource.method>
```

3. Wiki / Base / Doc token 类型识别：

```bash
lark-cli wiki get-node --token <wiki_token> --as user
```

实际命令必须在实现前依据对应 `lark-*` Skill 和本地 `lark-cli --help` 再次核实。

4. 权限和身份诊断：

```bash
lark-cli auth show
```

只读验证结果进入 `Result Interpreter`，再写入卡片。

### P4：增强飞书知识卡片

目的：让卡片体现 Agent 决策链，而不是普通提示。

卡片建议包含：

- 结论：当前最可能的问题。
- 证据：触发信号、规则命中、RAG 来源、只读验证结果。
- 操作：推荐下一步命令。
- 安全等级：只读 / 需确认 / 危险操作。
- 来源：关联 Skill、内部文档、历史案例。
- 状态：已验证 / 未验证 / 需要授权 / 需要补知识。

如果卡片篇幅过长，可以只在卡片中展示摘要，把完整证据写入本地 artifact 或后续飞书文档。

### P5：构建评测集和效果验证报告

目的：满足参赛要求中的 Prove it。

新增评测材料：

- `examples/eval-cli-cases.jsonl`
- `docs/evaluation-report.md`

建议评测指标：

| 指标 | 说明 |
|---|---|
| 规则命中准确率 | 典型问题是否命中正确类别 |
| RAG 召回命中率 | 未命中规则时是否能找对 Skill / 文档 |
| 建议可执行率 | 卡片中的命令是否符合真实 `lark-cli` 规范 |
| 只读验证成功率 | 自动验证是否能返回可解释结果 |
| 来源可追溯率 | 卡片是否给出 Skill / 文档 / 案例来源 |
| 响应完整率 | 事件监听 + 补偿轮询是否覆盖全部测试消息 |
| 人工耗时降低 | 对比人工查文档与 Agent 卡片定位的时间 |

## 5. 建议里程碑

### Milestone 1：Hybrid Retriever MVP

交付内容：

- 本地知识 chunk 构建。
- 轻量检索器。
- 规则未命中时自动 RAG 召回。
- 卡片显示召回来源。

验收标准：

- 至少 10 条非规则精确匹配样本能召回相关 Skill / 文档。
- 卡片中能清楚说明“为什么推荐这条知识”。

### Milestone 2：Readonly Verification Agent

交付内容：

- Tool Planner 与只读执行器打通。
- `--auto-readonly` 可用于事件和本地 Demo。
- 卡片展示只读验证结果。

验收标准：

- unknown flag、schema 参数错误、token 类型混淆、权限问题至少各跑通 1 个验证样例。
- 写操作不会被自动执行。

### Milestone 3：Competition Story Package

交付内容：

- README 演示命令更新。
- 场景定义文档补强。
- 效果验证报告初版。
- Demo 脚本和示例数据固定。

验收标准：

- 能用 3 分钟讲清楚：
  - 为什么普通问答不够。
  - Agent 如何主动触发。
  - Agent 如何找知识。
  - Agent 如何验证结论。
  - 效果如何证明。

## 6. 近期具体任务清单

建议下一轮直接做以下任务：

1. 新增 `src/core/knowledge/retriever.js`，实现本地轻量检索。
2. 新增知识 chunk 构建器，先覆盖 `knowledge/lark-cli-errors.json` 和关键 `lark-*` Skill。
3. 改造现有匹配链路：规则未命中时调用 retriever。
4. 修改飞书卡片 payload，增加“知识来源”和“召回证据”。
5. 准备 10 条规则未命中的自然语言求助样本。
6. 开始建立 `docs/evaluation-report.md` 的指标表。

## 7. 不建议现在做的事情

- 不建议继续增加更多触发入口，当前事件监听 + 补偿轮询已经够支撑 Demo。
- 不建议一开始就接复杂向量数据库，先用轻量检索证明 Agent 决策链。
- 不建议让 Agent 自动执行写操作，方向 C 的价值不依赖危险自动化。
- 不建议做通用聊天问答，否则会偏离 CLI 场景和参赛方向。

## 8. 最终参赛表达

本项目下一阶段的参赛表达建议固定为：

> 一个驻留在 CLI/飞书工作流中的主动知识 Agent。它在开发者遇到 `lark-cli` 报错或 API 使用困惑时，先用结构化规则快速判断高频问题；当规则不足时，自动从 OpenClaw Skill、内部知识库和历史案例中检索相关知识；必要时调用 `lark-cli` 只读 API 验证结论；最后将带有证据链、来源和下一步命令的高密度知识卡片主动推送到飞书群或终端。

这个方向同时覆盖参赛要求：

- Define it：把原始文档、Skill、历史案例转成可执行知识单元。
- Build it：通过事件监听和补偿轮询主动触发知识分发。
- Prove it：用评测集证明召回准确性、建议可执行率和排查效率提升。

## 9. 2026-05-02 执行进展

已完成本计划中近期任务的前三项：

1. 新增 `src/core/knowledge/retriever.js`，实现本地轻量检索。
2. 新增知识 chunk 构建能力，覆盖 `knowledge/lark-cli-errors.json`、项目 Skill 和关键 `lark-*` Skill。
3. 改造现有匹配链路：本地 Demo、轮询主动触发和事件监听主动触发都会在规则未命中时调用 retriever。

同时额外完成：

- 在终端知识卡和飞书知识卡中展示召回证据。
- 在 `docs/product-definition.md` 中同步 P1 实施进展。

下一步应继续推进：

- P2：规则低置信 / 未命中 / RAG 命中的决策分流。
- P4：进一步增强卡片证据链。
- P5：建立评测样本与效果验证报告。

## 10. 2026-05-03 RAG 演示样本补充

已新增：

```text
examples/lark-cli-rag-samples.jsonl
```

该文件专门用于演示“结构化规则未命中后进入本地轻量 RAG / retriever 流程”，样本刻意避开现有规则的强匹配信号，例如 `unknown flag`、`permission denied`、`param baseToken is invalid` 等。

当前样本覆盖：

- IM 消息发送时 `chat_id` / `open_id` 的 Skill 路由。
- Base 写记录前字段类型、lookup、formula 的知识召回。
- 本地 xlsx 导入为多维表格时 `drive +import` 与 `base` 的分流。
- 文档内嵌 sheet token 时是否继续下钻到 Sheets。
- 日历会议室场景缺少明确时间块时的工作流召回。
- user / bot 身份选择时的认证规则召回。

验证命令：

```bash
npm run demo -- --source examples/lark-cli-rag-samples.jsonl --no-quality-report
```

预期现象：

- 输出中出现 `匹配信号: retriever:...`。
- 输出中出现 `召回证据`。
- 事件不会被现有结构化规则直接命中。
