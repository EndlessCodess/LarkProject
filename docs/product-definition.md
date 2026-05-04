# 产品定义：Lark CLI Context Agent

## 1. 项目定位

**Lark CLI Context Agent** 是一个基于 OpenClaw Skill 知识与 `lark-cli` 工具调用的飞书 CLI 上下文 Agent，面向使用飞书 OpenAPI、`lark-cli` 和 OpenClaw Skills 的开发者、运营和自动化构建者。

它不只是一个“错误文本规则匹配器”，也不是简单的 CLI 包装器。目标形态是一个**半自动上下文 Agent**：自动识别用户当前终端状态、错误上下文、飞书资源链接、运行环境和相关 Skill 知识，生成下一步工具调用计划，并以结构化知识卡片形式返回诊断、修复步骤、可执行命令与来源依据。

一句话：

> 让 Agent 在用户使用 `lark-cli` 出错或卡住时，自动理解当前状态、查找相关 Skill 知识、规划安全工具调用，并把最需要的修复知识以卡片形式送到用户面前。

---

## 2. 核心理念：Skill 不是运行时代码，而是 Agent 操作手册

本项目对 OpenClaw / Cursor / Codex Skill 的理解是：

```text
Skill Markdown 文件 = 给 Agent 使用的领域操作手册
lark-cli = 实际执行飞书接口调用的工具
Agent = 读取 Skill 规则、判断意图、规划命令、解释结果的中间层
```

例如飞书云文档场景中，`lark-doc/SKILL.md` 会告诉 Agent：

- 读取文档应使用 `lark-cli docs +fetch`。
- 默认优先使用 `--as user`。
- 写操作前必须确认用户意图。
- 遇到权限问题时按 `lark-shared` 的 scope 处理流程恢复。

Agent 实际执行的仍然是 `lark-cli` 命令，而不是“直接调用 Skill”。本项目要做的事情，是把这种人工 Agent 工作流产品化：

```text
用户状态 / 终端错误 / 飞书链接
        ↓
上下文识别
        ↓
Skill 知识路由
        ↓
工具调用计划
        ↓
lark-cli 只读验证 / 安全执行
        ↓
结果解释
        ↓
Knowledge Card 输出
```

---

## 3. 目标用户

- 飞书 OpenAPI / `lark-cli` 使用者
- OpenClaw Skill 开发者
- 企业内部自动化脚本维护者
- 需要频繁操作 Docs、Base、Sheets、IM、Calendar、Task 等飞书能力的效率型用户
- 需要把团队内部 runbook、踩坑记录、Skill 使用规范沉淀为可执行知识卡片的团队

这些用户的共同痛点是：

- 知道自己“出错了”，但不知道应该看哪份文档或哪个 Skill。
- 知道要用 `lark-cli`，但不知道应该先查 schema、读哪个 Skill、用 user 还是 bot 身份。
- 错误信息里有缺失 scope、token 类型、参数结构等线索，但需要人工理解和转化。
- 文档、会议纪要、群聊讨论和 Skill 说明分散，不能在终端出错时即时送达。
- Windows / Linux / Docker 环境差异导致命令表现不同，排查成本高。

---

## 4. Agent 能力边界

### 当前 MVP：规则匹配助手

当前已实现的最小闭环是：

```text
错误事件输入 -> 知识规则召回 -> 错误类型匹配 -> 终端知识卡片输出
```

当前能力重点：

- 从本地 JSONL 读取终端错误事件。
- 从本地 JSON 或飞书云文档读取知识规则。
- 根据错误文本中的信号词匹配规则。
- 输出包含诊断、建议步骤、关联 Skill 和下一步命令的知识卡片。
- 将知识卡转成飞书交互卡片并主动推送到测试群。
- 通过测试群轮询最近消息，识别 `lark-cli` 相关错误文本和自然语言求助。
- 使用本地 state 文件记录最近消费位置，避免重复处理历史消息。
- 通过 `cliWatchMain.js` 提供驻留式 Agent Shell，监听开发者在终端中执行的 `lark-cli` 命令，并在失败或命中特定只读命令时主动触发知识卡。
- 提供 `larkCliProxyMain.js` 代理入口，让用户以更接近原生 `lark-cli` 的方式执行命令，同时自动接入知识监听和推送链路。

### 下一阶段：半自动上下文 Agent

下一阶段要新增 Tool Plan 和只读工具执行能力：

```text
错误事件输入
  -> 匹配 Skill / 知识规则
  -> 生成工具调用计划
  -> 可选自动执行只读 lark-cli 命令
  -> 解释工具返回结果
  -> 输出增强知识卡片
```

例如遇到：

```text
param baseToken is invalid; original link is https://example.feishu.cn/wiki/wikcnABC
```

Agent 不只提示“wiki token 不能当 base token”，还应生成只读工具计划：

```bash
lark-cli wiki spaces get_node --params '{"token":"wikcnABC"}' --as user
```

在用户启用 `--auto-readonly` 后，Agent 可以自动执行该只读命令，并把 `obj_type`、`obj_token` 和下一步 Base 路由写入卡片。

### 长期目标：可控自动化 Agent

长期目标是支持多步工具规划：

```text
用户目标
  -> Agent 自动判断领域 Skill
  -> 执行只读检查
  -> 遇到写操作时请求确认
  -> 执行或生成 dry-run
  -> 输出结果与知识沉淀
```

所有写入、删除、发送消息、修改云文档、创建任务等操作必须经过显式确认。

---

## 5. Agent 模块设计

### 5.1 Context Collector：上下文采集器

负责收集当前状态：

- 用户输入
- 终端最近输出
- 当前命令和参数
- 当前错误 JSON / stderr
- 飞书资源链接
- 当前运行环境：Windows / Linux / Docker
- 当前身份：user / bot
- 已安装 `lark-cli` 与 Skill 版本信息

MVP 阶段先从 JSONL 事件文件读取，后续可接入终端日志、Shell hook、IDE terminal 文件和实时事件流。

当前已补齐方向 C 的终端侧主动触发入口：
- `cliWatchMain.js` 提供 Agent Shell，用户在该会话内执行命令。
- 监听 `lark-cli` 命令文本、退出码、stdout/stderr 摘要和当前工作目录。
- 命令失败或命中特定只读命令时，生成 `cli_command` 事件并进入规则匹配 / RAG 召回 / 知识卡分发链路。
- 该方案优先服务比赛 Demo 和安全可控性，不做系统级全局终端监听。

当前测试链路已经额外验证了一个轻量方案：
- 通过 `chatPollMain.js` 轮询测试群最近消息
- 识别 `lark-cli` 相关报错与自然语言求助
- 命中本地知识规则后主动推送飞书知识卡

下一步重点不再只是补单点功能，而是把这条轮询链路继续稳定化，包括游标持久化、重复消费控制、规则覆盖率扩展，以及从轮询演进到正式事件订阅。

### 5.2 Intent Router：意图路由器

负责判断当前问题属于哪个飞书能力域：

| 用户上下文 | 路由 Skill |
|---|---|
| 读取/创建/更新飞书文档 | `lark-doc` |
| Base token / 字段 / 记录 / 视图问题 | `lark-base` |
| Wiki 链接解析 / 知识库节点 | `lark-wiki` |
| 权限、配置、user/bot 身份 | `lark-shared` |
| 日程、会议室、忙闲查询 | `lark-calendar` |
| Sheets 公式、单元格、导出 | `lark-sheets` |
| 消息发送、群聊、聊天记录 | `lark-im` |

### 5.3 Skill Knowledge Index：Skill 知识索引

负责把 Skill Markdown、reference 文档、本地规则和飞书云文档转成可匹配的知识单元。

知识单元应包含：

```text
category
severity
priority
signals / when
diagnosis
route_to_skills
suggested_actions
next_command_template
tool_plan
source
```

当前 MVP 使用 `knowledge/lark-cli-errors.json`，后续可增加：

- Skill Markdown 抽取器
- 飞书云文档规则解析器
- 缓存层
- 规则版本和来源追踪

### 5.4 Tool Planner：工具调用规划器

负责把知识规则转成可执行或可展示的下一步计划。

示例：

```json
{
  "tool": "lark-cli",
  "readonly": true,
  "requires_confirmation": false,
  "command_template": "lark-cli docs +fetch --doc \"<doc_url_or_token>\" --as user --format json"
}
```

规划器必须区分：

- 只读检查：可在 `--auto-readonly` 下自动执行。
- 写入操作：必须用户确认。
- 删除 / 转移 owner / 批量写入：必须二次确认或 dry-run。
- 认证配置：需要提示用户完成浏览器授权。

### 5.5 Tool Executor：工具执行器

负责实际执行命令。

当前已有：

```text
src/adapters/lark-cli/runner.js
```

后续需要扩展为统一接口：

```js
runTool({
  tool: "lark-cli",
  args: ["docs", "+fetch", "--doc", url, "--as", "user", "--format", "json"],
  mode: "readonly"
})
```

安全策略：

- 默认只展示命令，不自动执行。
- 用户显式开启 `--auto-readonly` 后，才执行只读命令。
- 写操作必须要求确认。
- 危险操作优先 dry-run。

### 5.6 Result Interpreter：结果解释器

负责把工具返回结果转成 Agent 状态。

例如：

```json
{
  "ok": false,
  "error": {
    "type": "config",
    "message": "not configured"
  }
}
```

解释为：

```text
容器内 lark-cli 未配置，需要执行 lark-cli config init --new。
```

再如：

```json
{
  "ok": true,
  "data": {
    "markdown": "..."
  }
}
```

解释为：

```text
文档读取成功，可以继续解析为知识规则；若 rules=0，说明文档不是规则格式或解析器需要增强。
```

### 5.7 Card Renderer：知识卡片输出器

当前已有终端输出：

```text
src/adapters/output/terminalCard.js
```

未来可扩展为：

- Terminal Card
- Feishu IM Card
- Markdown Report
- JSON API Response

卡片字段建议：

```text
错误类型
当前状态
判断依据
诊断
建议步骤
工具调用计划
执行结果摘要
是否需要用户确认
关联 Skill
来源文档
```

---

## 6. 核心场景

### 场景 A：lark-cli 报错即时诊断

用户执行命令后出现错误：

```text
permission denied: missing scope docs:document.comment:read
```

Agent 输出：

- 当前问题是权限 scope 缺失。
- 如果当前是 user 身份，执行增量授权。
- 如果当前是 bot 身份，到开发者后台开通 scope。
- 关联 Skill：`lark-shared`。
- 下一步命令：

```bash
lark-cli auth login --scope "docs:document.comment:read"
```

### 场景 B：Token 类型混淆修复

用户把 `/wiki/xxx` 链接中的 wiki token 当作 Base token 使用，导致 `baseToken invalid`。

Agent 输出：

- wiki token 不能直接作为 base token。
- 需要先解析 Wiki 节点。
- 如果 `obj_type=bitable`，再使用 `obj_token` 调 Base 命令。
- 可选只读工具计划：

```bash
lark-cli wiki spaces get_node --params '{"token":"<wiki_token>"}' --as user
```

### 场景 C：参数结构错误引导

用户调用原生 API 失败，错误包含 `invalid params` / `missing requestBody`。

Agent 输出：

- 原生 API 调用前必须先查 schema。
- `parameters` 字段进入 `--params`。
- `requestBody` 字段进入 `--data`。
- 下一步命令：

```bash
lark-cli schema <service.resource.method>
```

### 场景 D：环境/配置状态诊断

用户在 Docker 容器中调用 `lark-cli docs +fetch`，返回：

```json
{"type":"config","message":"not configured"}
```

Agent 输出：

- Docker 容器中的 `lark-cli` 未配置。
- 宿主机配置不会自动进入容器。
- 需要在容器内执行：

```bash
lark-cli config init --new
```

### 场景 E：普通文档 vs 规则文档识别

用户把普通项目总结文档作为知识源读取，程序显示：

```text
Loaded 8 events, 0 knowledge rules.
```

Agent 输出：

- 云文档读取成功。
- 但该文档不是知识规则格式。
- 需要改用规则文档，或增强 natural-language normalizer。

---

## 7. 为什么普通搜索/问答不够

| 对比项 | 普通搜索/问答 | Lark CLI Context Agent |
|---|---|---|
| 触发方式 | 用户主动提问 | 终端报错/上下文自动触发 |
| 用户负担 | 需要知道搜什么关键词 | 直接利用错误文本、命令和资源链接 |
| 信息来源 | 通常是文档片段或模型回答 | 结构化规则 + Skill 知识 + 飞书知识源 + CLI 实测 |
| 输出形态 | 长文本回答 | 可执行修复卡片 / 工具计划 / 飞书卡片 |
| 可追溯性 | 可能缺失来源 | 每条建议附带关联 Skill 或文档来源 |
| 工作流嵌入 | 需要切换上下文 | 直接嵌入 CLI / IDE / 飞书消息场景 |
| 安全控制 | 依赖人工判断 | 只读自动、写入确认、危险 dry-run |

本项目的目标不是让用户“问得更好”，而是让系统在用户出错时“主动知道该调用什么工具、该送达哪条知识”。

---

## 8. 与赛题三大挑战的对应关系

### 8.1 重新定义“知识获取”

在本项目中，知识不是原始文档全文，而是能驱动 Agent 行为的结构化单元：

- 错误类型
- 触发条件
- 诊断结论
- 推荐操作
- 工具调用计划
- 安全等级
- 关联 Skill
- 来源链接

例如，`permission_violations` 不是普通错误文本，而是可以转化为：

```text
缺失 scope -> 判断 user/bot 身份 -> 选择 auth login 或开发者后台开权限 -> 授权后重试
```

### 8.2 构建场景化知识应用

本项目选择方向 C：沉浸式碎片知识推送助手。

具体体现为：

- 以 CLI 报错、命令输出、终端上下文为触发点。
- 基于 OpenClaw Skill 知识进行路由。
- 根据错误类型生成工具调用计划。
- 通过终端卡片或飞书消息卡片主动分发知识。

### 8.3 证明应用效果与价值

计划使用以下验证指标：

| 指标 | 验证方式 |
|---|---|
| 错误分类准确率 | 准备典型 lark-cli 错误样本，人工标注类别后对比识别结果 |
| 修复建议可执行率 | 检查卡片中的命令/步骤是否能按当前 CLI 规则执行 |
| 工具计划安全率 | 检查只读/写入/危险操作是否正确分级 |
| 定位耗时降低 | 对比“人工查文档”与“Agent 输出卡片”的平均耗时 |
| 来源可追溯率 | 检查每张卡片是否包含关联 Skill 或文档来源 |
| 用户接受度 | 记录用户是否采纳卡片建议、是否继续追问 |

---

## 9. MVP 范围

当前最小 Demo 聚焦以下闭环：

```text
错误事件输入 -> 错误类型匹配 -> 知识规则召回 -> 终端知识卡片输出
```

MVP 已验证：

- 本地 JSONL 事件输入可运行。
- 本地规则库可匹配典型错误。
- 飞书云文档可通过 `lark-cli docs +fetch` 读取。
- Docker/Linux 环境可运行 demo。
- 普通文档读取成功但无法解析规则时，应输出“文档格式不匹配”的诊断。

MVP 暂不默认执行真实写操作。

---

## 10. 迭代路线

### 阶段 1：规则匹配助手（当前）

- 本地规则库。
- 示例错误事件流。
- 终端知识卡片。
- 云文档知识源读取。

### 阶段 2：半自动上下文 Agent（下一步重点）

- 为知识规则增加 `tool_plan` 字段。
- 在卡片中展示建议工具调用。
- 新增 `--auto-readonly` 参数。
- 自动执行只读工具调用并解释结果。
- 对普通文档 / 规则文档进行区分诊断。

### 阶段 3：Skill 知识索引增强

- 解析本地安装的 `lark-*` Skill Markdown。
- 抽取 description、权限、API Resources、典型流程。
- 与本地规则库和云文档规则合并。
- 增加缓存和来源追踪。

### 阶段 4：飞书消息卡片输出

- 将 Terminal Card 扩展为 Feishu IM Card。
- 支持错误卡片推送到指定群或私聊。
- 支持用户点击卡片确认执行下一步。
- 当前已完成第一步：本地生成 `lark_card` 推送产物 JSON（artifact），用于后续接飞书发送链路。
- 当前已完成第二步：通过显式开关将 interactive card 推送到指定飞书群聊（默认关闭，避免误发）。

### 阶段 5：可控自动化 Agent

- 多步工具规划。
- 只读自动执行。
- 写操作确认。
- 危险操作 dry-run。
- 将执行结果反向沉淀为知识规则或 history。

---

## 11. 2026-05-02 下一阶段方向同步：Hybrid Knowledge Agent

根据当前 Demo 完成情况，项目下一阶段从“规则匹配 + 主动推送”升级为：

> Hybrid Knowledge Agent：规则优先、RAG 补全、API/CLI 只读验证的主动 CLI 知识助手。

当前已完成能力包括：

- 本地规则库匹配与终端知识卡片输出。
- 飞书交互式知识卡片生成与推送。
- 测试群轮询式主动触发。
- 事件监听式主动触发。
- 事件监听漏收时的历史消息轮询补偿。
- 推送策略、去重与基础自消息过滤。
- CLI 终端 Agent Shell 主动触发，支持命令失败和特定 `lark-cli` 命令触发知识卡。

下一阶段重点不再继续扩展触发入口，而是增强 Agent 的知识获取与决策能力：

1. 高置信结构化规则命中时，直接生成知识卡片。
2. 规则低置信或未命中时，启动轻量 RAG，从本地规则库、OpenClaw Skill、reference 文档、项目内部知识库和历史案例中召回相关知识。
3. RAG 结果只作为证据来源，不直接等同于最终答案。
4. 当召回内容涉及真实 API 行为或 CLI 参数时，通过 `lark-cli` 只读命令进行验证。
5. 最终卡片需要展示结论、证据、来源、只读验证结果、安全等级和下一步动作。

近期实施计划记录在：

```text
docs/next_plan.md
```

本方向继续严格约束在参赛方向 C「沉浸式碎片知识推送助手」内，不做通用聊天机器人，不扩展无关办公场景。

### 2026-05-02 P1 实施进展

已完成轻量 Knowledge Retriever 第一版：

- 新增本地知识 chunk 构建能力，覆盖 `knowledge/lark-cli-errors.json`、项目内 `lark-cli-knowledge-assistant` Skill，以及关键 `lark-*` Skill 的 `SKILL.md`。
- 新增本地轻量检索器，不依赖外部向量库，使用关键词、短语、来源类型和 Skill 路由加权进行召回。
- 改造本地 Demo、轮询主动触发和事件监听主动触发链路：结构化规则未命中时，自动调用 retriever 进行知识召回。
- 检索召回结果会合成为低风险知识卡片，并在终端卡片和飞书卡片中展示召回证据。

当前策略仍然坚持“规则优先”：

```text
规则高置信命中 -> 沿用原规则卡片
规则未命中 -> 本地轻量检索 -> 召回证据卡片
```

后续 P2 需要继续完善规则低置信分流、检索质量评测样本和更明确的 RAG 召回阈值。

### 2026-05-03 终端监听入口补齐

为更贴合参赛方向 C 中“驻留在 CLI 终端的实时知识点推送小助手”的描述，项目新增 `demo:cli-watch` 入口：

```bash
npm run demo:cli-watch
```

该入口启动一个受控 Agent Shell。开发者在 Shell 内执行 `lark-cli` 命令后，系统会收集命令、退出码、stdout/stderr 摘要，并在失败或命中特定命令模式时触发知识判断。后续链路复用现有能力：

```text
CLI 命令事件
  -> 结构化规则匹配
  -> 规则未命中时本地轻量 RAG 召回
  -> 决策与知识卡构造
  -> 终端 Debug View / 飞书卡片推送
```

这样当前项目已经同时具备三类主动触发来源：本地样本回放、飞书群消息事件、CLI 终端命令监听。比赛展示时，CLI 监听作为方向 C 的主入口，飞书群卡片作为外部分发形态。

进一步地，项目也支持“代理式命令执行”：

```text
lark-cli 代理命令
  -> 实际执行 lark-cli <args>
  -> 自动采集退出码 / stderr / stdout 摘要
  -> 命中规则或 RAG 时主动推送知识卡
```

这使项目不必强依赖先进入 Agent Shell，也更贴近“默认 lark-cli 多了一层知识感知能力”的产品体验。

### 2026-05-04 Composer 层补齐

为让项目从“规则/RAG 命中后直接拼接卡片”继续向“知识整合 Agent”推进，当前链路新增了一层轻量 Composer：

```text
上下文标准化
  -> 检索查询整理
  -> 规则 / RAG 召回
  -> Composer 压缩诊断与建议
  -> 终端卡片 / 飞书卡片
```

当前实现先使用本地 template composer，不依赖外部模型密钥，目的是先把 Agent 的推理接口稳定下来：

- 从命令、退出码、stderr/stdout 摘要中整理检索查询。
- 将规则命中和 RAG 召回结果压缩为更贴近当前上下文的诊断。
- 在终端 Debug View 中显示“整理模式”和“检索查询”，便于继续调试。

后续如果接入真实 LLM，只需要替换 Composer 实现，而无需推翻现有规则、RAG、CLI 验证和卡片分发链路。
### 2026-05-04 真实 LLM Composer 接入

在现有 `template composer` 稳定链路之上，项目已经补齐真实 LLM Composer 的可插拔实现：

```text
上下文标准化
  -> 检索查询整理
  -> 规则 / RAG 召回
  -> 动态 lark-cli --help 证据
  -> LLM Composer 压缩
  -> 终端卡片 / 飞书卡片
```

当前实现策略如下：

- 新增 `src/core/agent/llmComposer.js`，通过 OpenAI-compatible `chat/completions` 接口调用真实模型。
- 入口参数新增：
  - `--compose-mode llm`
  - `--llm-api-key`
  - `--llm-base-url`
  - `--llm-model`
  - `--llm-timeout-ms`
  - `--llm-temperature`
- 默认仍保持 `template`，避免在没有 API key 时影响本地演示。
- 当 LLM 缺少密钥、超时、HTTP 错误或返回 JSON 结构异常时，会自动回退到 `template composer`，并在终端 Debug Card 中显示回退原因。
- 当前实现同时兼容 OpenAI 和火山引擎 Ark / Doubao 这类 OpenAI-compatible 网关；若环境变量中配置 `ARK_API_KEY`、`ARK_MODEL`、`ARK_BASE_URL`，会优先按 Ark 路径解析。

这意味着当前项目已经不只是“规则命中后拼装卡片”，而是具备了：

1. 规则与 RAG 召回阶段负责找证据。
2. 动态 `lark-cli --help` 负责补当前环境的真实命令形态。
3. LLM Composer 负责把证据压缩成更像 Agent 的诊断、建议和下一步命令。

这一步让项目更贴近赛道“企业办公知识整合与分发 Agent”的表述：知识不是直接原样返回，而是经过 Agent 化整理后再分发到终端或飞书。
### 2026-05-04 鐭ヨ瘑婧愭墿鍏咃細鏈湴 skill 闀滃儚 + 浜戦涔︽枃妗ｅ叆鍙?

涓轰簡鏇村ソ鍦拌创鍚堚€滀紒涓氬姙鍏煡璇嗘暣鍚堜笌鍒嗗彂 Agent鈥濓紝褰撳墠 RAG 妫€绱㈢殑鐭ヨ瘑婧愯鏄庣‘鎷嗘垚涓ゆ潯绾匡細

1. `knowledge/skills/` 涓嬬殑 `lark-*` skill 闀滃儚锛屼綔涓洪」鐩唴鍙鐜扮殑鏈湴鐭ヨ瘑搴曞骇銆?
2. `knowledge/lark-cloud-knowledge.json` 涓殑椋炰功 Docx 娓呭崟锛屼綔涓轰簯绔煡璇嗘帴鍏ュ彛銆?

妫€绱㈡椂浼氫紭鍏堣鍙栦粨搴撳唴鐨?skill 闀滃儚锛屽彧鍦ㄤ粨搴撶己灏戞煇涓?skill 鏃舵墠鍥為€€鍒版湰鏈?`~/.agents/skills`銆傚悓鏃讹紝濡傛灉鍦?`knowledge/lark-cloud-knowledge.json` 涓～鍏ラ涔︽枃妗?URL锛岀郴缁熶細閫氳繃 `lark-cli docs +fetch --api-version v2` 鎷夊彇鏂囨。鍐呭锛屽苟鍚屾牱鍒囨垚 chunks 杩涘叆 RAG 绱㈠紩銆?

杩欒椤圭洰涓嶅啀鍙槸鈥滄湰鍦?skill 妫€绱⑩€濓紝鑰屾槸鍙互缁х画婕旇繘涓衡€滄湰鍦?CLI 鐭ヨ瘑 + 浜戦涔︽枃妗?FAQ/瑙勭害/鍥㈤槦绾鈥濈殑娣峰悎鐭ヨ瘑妫€绱㈡灦鏋勩€?

### 2026-05-05 浜戦涔︽枃浠跺す绾х煡璇嗗叆鍙?

涓轰簡鏇村ソ灞曠ず鈥滈涔︿簯鏂囨。 / 浜戠┖闂撮泦鎴愯兘鍔涒€濓紝褰撳墠椤圭洰涓嶄粎鏀寔鍗曠瘒 Docx 浣滀负浜戦涔︾煡璇嗘簮锛屼篃鏀寔浠?Drive folder 浣滀负涓€涓?cloud knowledge entrypoint銆?

??`knowledge/lark-cloud-knowledge.json` ????????? docs[] ??folders[] ???????????????????????????????????????

- `docs[]`锛氬崟绡囨枃妗?URL / token
- `folders[]`锛氭枃浠跺す URL / token

褰撲娇鐢?`folders[]` 鏃讹紝绯荤粺浼氬厛璋冪敤 `lark-cli drive files list` 鍒楀嚭鏂囦欢澶瑰唴瀹癸紝鍐嶈嚜鍔ㄦ妸鍏朵腑鐨?`doc/docx/wiki` 灞曞紑涓轰竴缁勫彲鍙洖鐨勪簯绔煡璇嗘潯鐩€傝繖涓洪珮棰戝皢涓€缁勪笓棰樻枃妗ｏ紙渚嬪 calendar skill銆両M FAQ銆佹潈闄愯鑼冿級缁熶竴鏀惧湪椋炰功鏂囦欢澶逛腑鎻愪緵浜嗘洿鑷劧鐨勬帴鍏ユ柟寮忋€?
