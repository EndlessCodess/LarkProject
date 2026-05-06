# Evaluation / Prove It

本项目把评测分成两层，避免把“能跑通”误当成“Agent 能力强”。

## 0. 一条主测试路径

推荐优先使用统一入口：

```bash
npm run eval:all
```

它会依次运行：

```text
npm run eval
npm run eval:quality
npm run eval:llm
```

汇总输出：

```text
tmp/evaluation-suite-report.md
tmp/evaluation-suite-results.json
```

终端会默认输出每套评测的样本汇总表，每条样本一行，表头包含：

```text
Result | Case | Group | Match | Expected | Rule / Top1 Evidence | Hit Skill | Source | Compose | Time
```

当前完整路径验证结果：

```text
suites: 3
passed suites: 3
failed suites: 0
regression: 12/12
quality: see tmp/evaluation-quality-report.md
llm: 10/10
```

调试 Top3 召回：

```bash
npm run eval:all -- --show-top3
```

如果只想保留简短日志，不输出样本表格：

```bash
npm run eval:all -- --no-summary-table
```

如果只想快速跑非 LLM 部分：

```bash
npm run eval:all -- --skip-llm
```

## 1. 小回归集

用于快速确认规则匹配、RAG 召回和触发上下文没有被改坏：

```bash
npm run eval
```

输入：

```text
examples/eval-cli-cases.jsonl
```

输出：

```text
tmp/evaluation-report.md
tmp/evaluation-results.json
```

当前结果：

```text
cases: 12
passed: 12
failed: 0
match kind accuracy: 100.0%
route skill hit rate: 100.0%
source hit rate: 100.0%
```

## 2. Agent 质量评测集

用于证明 Agent 的知识路由和召回能力。它不测试飞书推送是否成功，而是测试：

- 是否命中正确结构化规则。
- 规则未命中时，是否进入 RAG。
- TopK 召回是否包含期望 Skill。
- 云端知识场景是否召回到飞书云文件来源。

运行：

```bash
npm run eval:quality
```

查看每条样本的 Top3 召回：

```bash
npm run eval:quality -- --show-top3
```

输入：

```text
examples/evaluation/agent-quality-cases.jsonl
```

输出：

```text
tmp/evaluation-quality-report.md
tmp/evaluation-quality-results.json
```

当前质量集覆盖 32 条样本：

- 10 条结构化规则直达：scope、token、docs v2、params/data、shortcut、资源权限、Base 写入、Calendar 会议室、Sheets 公式、命令存在性。
- 17 条本地 Skill RAG：shared、im、doc、drive、sheets、base、wiki、mail、slides、task、contact、minutes、vc、approval、event 等。
- 3 条云端知识 RAG：从 `knowledge/lark-cloud-knowledge.json` 配置的飞书云端 calendar Skill 文件夹召回。

当前结果：

```text
cases: 30
passed: 30
failed: 0
match kind accuracy: 100.0%
route skill hit rate: 100.0%
source hit rate: 100.0%
retriever chunks: 2985
```

## 3. 评测边界

## 3. LLM Composer 复杂评测集

LLM 评测集用于验证完整知识卡压缩链路：

```text
输入问题
-> 规则 / RAG
-> Composer 输入构建
-> 真实 LLM 调用
-> JSON 知识卡摘要
-> 决策对象
```

运行：

```bash
npm run eval:llm
```

查看 LLM 复杂样本的 Top3 召回：

```bash
npm run eval:llm -- --show-top3
```

输入：

```text
examples/evaluation/llm-composer-cases.jsonl
```

输出：

```text
tmp/evaluation-llm-report.md
tmp/evaluation-llm-results.json
```

当前 LLM 集覆盖 10 条复杂样本：

- scope / 身份 / docs 权限压缩
- wiki token 到 base token 的跨域诊断
- IM 发送参数互斥
- 云端 calendar workflow 召回后压缩
- drive import 与 docs/sheets/base 的路由判断
- Base 写入字段类型与只读字段
- doc 与 sheets 跨资源判断
- SDK WebSocket 与 lark-cli event 监听边界
- mail 与 contact 的前置检索顺序
- vc 与 minutes 的会议纪要边界

当前结果：

```text
cases: 10
passed: 10
failed: 0
match kind accuracy: 100.0%
route skill hit rate: 100.0%
source hit rate: 100.0%
compose mode accuracy: 100.0%
```

其中 `compose mode accuracy: 100.0%` 表示 10 条样本都真实得到 `compose=llm`，没有落到 `template_fallback`。

## 4. 评测边界

质量评测集和 LLM 评测集验证的是“知识选择是否对、LLM 是否参与压缩”，不是完整线上效果。完整效果还需要配合真实入口演示：

```bash
npm run demo:competition:cli
npm run demo:competition:chat
```

简单说：

- `npm run eval`：防回归。
- `npm run eval:quality`：证明 Agent 知识路由与召回能力。
- `npm run eval:llm`：证明真实 LLM Composer 能完成复杂知识卡压缩。
- `npm run eval:all`：一条主测试路径，整合回归、质量和 LLM 三套评测。
- `npm run demo:competition:*`：展示真实入口、终端卡片和飞书推送效果。
