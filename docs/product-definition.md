# 产品定义：Lark CLI Context Agent

## 1. 项目定位

**Lark CLI Context Agent** 是一个基于 OpenClaw Skill 机制的企业知识分发 Agent，面向使用 `lark-cli`、飞书 OpenAPI 和 OpenClaw Skills 的开发者/运营/自动化构建者。

它不是一个通用问答机器人，也不是简单的 CLI 包装器，而是一个“CLI 场景下的上下文感知知识助手”：当用户在终端中遇到报错、权限问题、Token 混淆、参数结构不明或 Skill 调度困惑时，Agent 会根据当前错误上下文主动识别问题类型，调度相关飞书 Skills 或知识规则，输出高密度、可追溯、可执行的修复卡片。

一句话：

> 把分散在飞书文档、会议纪要、群聊讨论和 Skill 说明中的知识，在开发者最需要的时候，通过 CLI/卡片主动送达。

---

## 2. 目标用户

- 飞书 OpenAPI / lark-cli 使用者
- OpenClaw Skill 开发者
- 企业内部自动化脚本维护者
- 需要频繁操作 Docs、Base、Sheets、IM、Calendar、Task 等飞书能力的效率型用户

这些用户的共同痛点是：

- 知道自己“出错了”，但不知道应该看哪份文档。
- 知道要用 lark-cli，但不知道应该先查 schema、读哪个 Skill 文档、用 user 还是 bot 身份。
- 错误信息里有缺失 scope、token 类型、参数结构等线索，但需要人工理解和转化。
- 解决方案可能散落在官方文档、内部 runbook、会议纪要或群聊讨论中。

---

## 3. 核心场景

### 场景 A：lark-cli 报错即时诊断

用户执行命令后出现错误，例如：

```text
permission denied: missing scope docs:document.comment:read
```

Agent 自动识别为权限问题，并输出：

- 当前可能身份：user/bot
- 缺失 scope
- 推荐修复命令
- 注意事项：bot 不能执行 auth login
- 来源：`lark-shared/SKILL.md`

### 场景 B：Token 类型混淆修复

用户把 `/wiki/xxx` 链接里的 wiki token 当作 Base token 使用，导致 `base_token invalid`。

Agent 自动提示：

- wiki token 不能直接作为 base token
- 需要先调用 wiki 节点解析获得 `obj_token`
- 如果 `obj_type=bitable`，再进入 Base 操作
- 来源：`lark-base/SKILL.md` / `lark-wiki/SKILL.md`

### 场景 C：参数结构错误引导

用户调用原生 API 或 shortcut 失败，错误包含 `invalid params` / `missing required parameter`。

Agent 自动提示：

- 原生 API 调用前必须先 `lark-cli schema service.resource.method`
- `parameters` 对应 `--params`
- `requestBody` 对应 `--data`
- 不要猜字段结构

### 场景 D：从本地规则升级到飞书知识源

MVP 阶段使用本地结构化知识规则；后续可接入：

- 飞书 Docs：使用说明、API 注意事项、内部 runbook
- 飞书 Minutes / VC：历史故障复盘、会议决策、行动项
- 飞书 IM：同类 Bug 讨论与 workaround
- 飞书 Task：已知问题的修复进度和负责人

---

## 4. 为什么普通搜索/问答不够

| 对比项 | 普通搜索/问答 | Lark CLI Context Agent |
|---|---|---|
| 触发方式 | 用户主动提问 | 终端报错/上下文自动触发 |
| 用户负担 | 需要知道搜什么关键词 | 直接利用错误文本和命令上下文 |
| 信息来源 | 通常是文档片段或模型回答 | 结构化规则 + 飞书知识源 + Skill 文档 |
| 输出形态 | 长文本回答 | 可执行修复卡片 / CLI 提示 / 飞书卡片 |
| 可追溯性 | 可能缺失来源 | 每条建议附带来源或关联 Skill |
| 工作流嵌入 | 需要切换上下文 | 直接嵌入 CLI 使用场景 |

本项目的目标不是让用户“问得更好”，而是让系统在用户出错时“主动知道该把哪条知识送过来”。

---

## 5. 与赛题三大挑战的对应关系

### 5.1 重新定义“知识获取”

在本项目中，知识不是原始文档全文，而是面向具体 CLI 场景的结构化知识单元：

- 错误类型
- 触发条件
- 诊断结论
- 推荐操作
- 关联 Skill
- 来源链接
- 风险提示

例如，`permission_violations` 不是一段普通错误文本，而是可以被转化为“缺失 scope -> user 身份执行 auth login --scope / bot 身份去开放平台开权限”的可执行知识。

### 5.2 构建场景化知识应用

本项目选择方向 C：沉浸式碎片知识推送助手。

具体体现为：

- 以 CLI 报错、命令输出、终端上下文为触发点。
- 通过 OpenClaw Skill 路由到自定义知识助手。
- 根据错误类型调度现有 `lark-*` Skills。
- 通过终端卡片或飞书消息卡片主动分发知识。

### 5.3 证明应用效果与价值

计划使用以下验证指标：

| 指标 | 验证方式 |
|---|---|
| 错误分类准确率 | 准备典型 lark-cli 错误样本，人工标注类别后对比识别结果 |
| 修复建议可执行率 | 检查卡片中的命令/步骤是否能按当前 CLI 规则执行 |
| 定位耗时降低 | 对比“人工查文档”与“Agent 输出卡片”的平均耗时 |
| 来源可追溯率 | 检查每张卡片是否包含关联 Skill 或文档来源 |
| 用户接受度 | 记录用户是否采纳卡片建议、是否继续追问 |

MVP 阶段先用小规模样本验证，后续可以接入真实团队使用日志。

---

## 6. MVP 范围

当前最小 Demo 聚焦以下闭环：

```text
错误事件输入 -> 错误类型匹配 -> 知识规则召回 -> 终端知识卡片输出
```

MVP 暂不追求完整飞书数据接入，而是先证明：

- 这个方向能主动触发；
- 知识可以被结构化；
- 输出不是泛泛回答，而是可执行卡片；
- 架构上可以继续接入真实 `lark-*` Skills。

---

## 7. 后续迭代方向

1. **OpenClaw Skill 化**：完善 `skills/lark-cli-knowledge-assistant/SKILL.md`，让 OpenClaw 能正确触发该助手。
2. **知识库扩展**：沉淀更多 lark-cli 错误、token 规则、权限处理规则。
3. **真实飞书知识源接入**：接入 Docs、Minutes、IM、Task。
4. **飞书卡片输出**：将终端卡片扩展为飞书消息卡片。
5. **主动触发增强**：支持命令失败阈值、重复错误聚合、定时巡检报告。
