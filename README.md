# Lark CLI Context Agent

一个面向飞书 / Lark `lark-cli` 工作流的上下文知识助手原型。

它不是单纯的“错误文本匹配器”，而是一个围绕 **终端上下文识别 → Skill 知识路由 → 工具调用计划 → 结构化知识卡片输出** 构建的 Direction-C 方向原型。

当前项目已经支持把 CLI 诊断结果以 **飞书知识卡片** 的形式推送到群聊中，并具备基础的 **推送策略分级**、**去重节流** 与 **小样本调试能力**。

---

## 当前能力概览

当前版本已经具备以下能力：

- 读取 `lark-cli` 错误/上下文事件流
- 基于本地知识规则进行匹配
- 生成结构化 CLI 知识卡片
- 在终端中输出知识卡摘要
- 生成本地卡片产物 `tmp/lark-card-artifact.json`
- 将知识卡推送到飞书群聊
- 根据规则类别渲染不同卡片模板
- 为高优先级卡片提供更强视觉提示
- 支持推送策略分级与去重节流
- 支持小样本快速调试与推送门控绕过
- 支持从测试群轮询最近消息并主动触发知识卡

---

## 当前工作流

```text
terminal state / lark-cli error / Feishu resource link
        ↓
context recognition
        ↓
local knowledge matching
        ↓
tool-call planning
        ↓
terminal knowledge card
        ↓
Lark interactive knowledge card
        ↓
Feishu group delivery
```

---

## 核心目录

- `docs/product-definition.md`：产品定位、阶段规划、比赛对齐说明
- `knowledge/lark-cli-errors.json`：本地知识规则库
- `examples/lark-cli-error-samples.jsonl`：完整样本集
- `examples/lark-cli-error-samples-small.jsonl`：轻量调试样本集
- `src/app/runDemo.js`：本地样本 Demo 主流程入口
- `src/chatPollMain.js`：测试群轮询触发知识卡的独立入口
- `src/adapters/output/larkCardPayload.js`：飞书知识卡 payload 构造
- `src/adapters/output/sendLarkInteractiveCard.js`：飞书卡片发送适配器
- `src/adapters/output/pushPolicy.js`：推送策略分级与去重节流
- `tmp/lark-card-artifact.json`：最近一次生成的飞书卡片产物

---

## 快速开始

### 本地运行

```bash
npm run demo
```

### Docker 开发环境

```bash
docker compose build
docker compose run --rm app npm run demo
```

### 进入交互式容器

```bash
docker compose run --rm app bash
```

---

## 常用运行方式

### 1. 跑完整样本集

```bash
node "./src/main.js" --show-regression-summary
```

适合：
- 查看完整匹配效果
- 观察规则命中覆盖率
- 输出回归摘要和规则质量报告

---

### 2. 跑小样本集做快速调试

```bash
node "./src/main.js" --source "examples/lark-cli-error-samples-small.jsonl" --show-regression-summary
```

适合：
- 调整知识卡片样式
- 验证少量代表性规则
- 避免一次推送过多卡片

---

### 3. 推送飞书知识卡到群聊

```bash
node "./src/main.js" \
  --source "examples/lark-cli-error-samples-small.jsonl" \
  --show-regression-summary \
  --push-lark-card \
  --push-chat-id "oc_xxx" \
  --push-as bot
```

说明：
- `--push-chat-id` 指定目标群聊
- `--push-as` 默认可用 `bot`
- 卡片推送前会经过策略分级与去重判断

---

### 4. 从测试群轮询错误并主动推送知识卡

```bash
node "./src/chatPollMain.js" \
  --source-chat-id "oc_d32c2e3e2eb66b2efca3ef677620233e" \
  --source-chat-as user \
  --source-chat-limit 20 \
  --push-lark-card \
  --push-chat-id "oc_d32c2e3e2eb66b2efca3ef677620233e" \
  --push-as bot \
  --push-bypass-policy \
  --push-bypass-dedupe
```

适合：
- 从测试群最近消息中抓取 `lark-cli` 错误文本
- 验证“群消息 -> 主动知识卡”最小闭环
- 演示基于轮询的主动触发效果

说明：
- 当前是最小测试版，只做最近消息轮询
- 仅筛选包含 `lark-cli` 且带明显错误特征的文本消息
- 适合先验证触发效果，不替代后续正式事件订阅链路

---

## 推送策略与调试参数

### 推送级别

支持以下级别：

- `--push-level none`
- `--push-level all`
- `--push-level high_only`
- `--push-level warning_and_above`

默认值：

```bash
--push-level high_only
```

含义：
- 只推送高优先级事件
- 通常要求 `severity=error` 或 `risk=high`

---

### 去重节流

默认会对推送事件做去重：

- 默认 TTL：`600000ms`（10 分钟）
- 状态文件：`tmp/push-dedupe-state.json`

可自定义：

```bash
--push-dedupe-ttl-ms 600000
--push-dedupe-file "tmp/push-dedupe-state.json"
```

---

### 为了调试方便，跳过门控机制

#### 跳过推送策略分级

```bash
--push-bypass-policy
```

作用：
- 不再检查 `pushLevel`
- 适合调试某张原本不会被推送的卡片

#### 跳过去重节流

```bash
--push-bypass-dedupe
```

作用：
- 即使连续两次是同一事件，也会再次推送
- 适合连续调试卡片 UI

---

### 推荐调试命令

如果你只是想调试卡片效果，推荐直接使用：

```bash
node "./src/main.js" \
  --source "examples/lark-cli-error-samples-small.jsonl" \
  --show-regression-summary \
  --push-lark-card \
  --push-chat-id "oc_d32c2e3e2eb66b2efca3ef677620233e" \
  --push-as bot \
  --push-bypass-policy \
  --push-bypass-dedupe
```

这样可以保证：
- 样本量小
- 群里不会一次刷很多卡
- 每次修改后都能立刻看到新卡片
- 不会被策略分级或去重机制挡住

---

## 当前知识卡片特性

当前飞书知识卡片已经具备：

- 按规则类别分模板
- 高优先级卡片强化提醒
- 结论先行的内容结构
- 关键信息压缩展示
- 建议动作精简展示
- 单独突出建议命令
- 上下文信息弱化到底部

这使它更适合在群聊中被快速浏览，而不是像日志一样堆叠大段文字。

---

## 当前项目证明了什么

这个原型已经证明：

- CLI 场景下的事件驱动知识分发是可行的
- `lark-cli` 错误上下文可以被结构化解释
- Skill-aware 路由能提升问题诊断质量
- 飞书知识卡片可以成为终端知识的外部化载体
- 从“规则匹配”走向“半自动上下文 Agent”有清晰路径
- 从测试群轮询消息并主动触发知识卡的路径可行

---

## 下一步方向

后续可以继续推进：

- 更细粒度的分类卡片模板
- 真正可用的按钮交互动作
- 推送对象分级（终端 / 群聊 / 私聊）
- 更稳定的只读自动执行链路
- 从轮询演进到正式事件订阅
- 更强的上下文聚合与来源追踪

---

## 参考文档

- `docs/product-definition.md`
- `docs/lark-cli-integration.md`
- `docs/对话必读.md`

如果你准备继续调知识卡片体验，优先从 `examples/lark-cli-error-samples-small.jsonl` + `--push-bypass-policy --push-bypass-dedupe` 这一套调试链路开始。
