# 当前项目最需要的内容：面向 `lark-cli` 自动化 Agent 的能力模型与下一步任务

## 背景

当前项目是在做一个 **基于规则 + 安全门控 + 只读自动执行** 的 Lark CLI 上下文 Agent。  
现阶段真正缺的不是某个局部功能，而是：

> **对 `lark-cli` 本体能力体系的稳定建模，以及一套可直接服务自动化的命令认知框架。**

已经明确的前提：

- `lark-cli` 本体存在 **两套并行命令系统**
  1. **原生命令系统**：`service resource method`
  2. **shortcut 系统**：`service +verb`
- `schema` 主要描述的是 **原生命令系统**
- shortcut 往往是高阶封装，不与某个单一 `schema key` 一一对应

---

# 1. 当前项目最需要的核心目标

不是继续“理解 lark-cli”，而是把理解结果**收敛成可实现的 Agent 能力层**。

换句话说，当前最需要的是：

1. **统一能力模型**
2. **统一命令分类器**
3. **统一 schema key 解析器**
4. **统一只读/写入安全判定**
5. **统一 native vs shortcut 选路策略**

---

# 2. 对 `lark-cli` 的最低可用心智模型

---

## 2.1 命令体系分为四类

### A. 系统固定命令
例如：

- `config`
- `auth`
- `profile`
- `doctor`
- `update`
- `completion`

这些是 CLI 自身管理命令。

---

### B. 原生命令
形式：

```text
lark-cli <service> <resource> <method>
```

例如：

```text
lark-cli calendar events get
lark-cli drive file.comments list
lark-cli task tasks get
```

特点：

- 来自 registry / meta
- 与 OpenAPI method 基本一一对应
- 可由 `schema` 直接描述
- 参数主要是 `--params` / `--data` / `--file`
- 更接近“endpoint 级 primitive”

---

### C. shortcut
形式：

```text
lark-cli <service> +<verb>
```

例如：

```text
lark-cli calendar +agenda
lark-cli docs +fetch
lark-cli task +create
```

特点：

- 由 Go 代码显式实现
- 不是 schema method 的简单别名
- 往往是意图级工作流封装
- 参数是业务化自定义 flag
- 常常内部调用多个 API

---

### D. 通用 introspection / raw api 命令

#### schema
```text
lark-cli schema ...
```

#### api
```text
lark-cli api <METHOD> <PATH>
```

---

## 2.2 一个最实用的总图

```text
lark-cli
├─ 系统命令
│  ├─ auth / config / profile / doctor / update / completion
│  ├─ schema
│  └─ api
│
├─ 原生命令系统（registry 驱动）
│  └─ service
│     └─ resource
│        └─ method
│
└─ shortcut 系统（Go 代码驱动）
   └─ service
      └─ +verb
```

---

# 3. 当前项目最需要建立的统一能力模型

这一部分是最重要的。

---

## 3.1 NativeMethodCapability

用于表示原生命令能力。

### 建议字段

```ts
type NativeMethodCapability = {
  id: string;                       // native:<schema_key>
  kind: "native_method";

  schemaKey: string;                // e.g. calendar.events.get
  service: string;                  // calendar
  resource: string;                 // events / event.attendees / ...
  method: string;                   // get

  httpMethod: string;               // GET / POST / PATCH / ...
  apiPath: string;                  // /open-apis/...
  rawCliShape: string;              // lark-cli calendar events get

  paramsSchema?: object;            // from schema.parameters
  bodySchema?: object;              // from schema.requestBody
  responseSchema?: object;          // from schema.responseBody

  supportedIdentities: ("user" | "bot")[];
  scopes: string[];
  docUrl?: string;
  tips?: string[];

  supportsFileUpload: boolean;
  supportsPagination: boolean;
  isReadOnly: boolean;
};
```

---

## 3.2 ShortcutCapability

用于表示 shortcut。

### 建议字段

```ts
type ShortcutCapability = {
  id: string;                       // shortcut:<service>.<verb>
  kind: "shortcut";

  service: string;                  // calendar
  verb: string;                     // +agenda
  command: string;                  // +agenda
  rawCliShape: string;              // lark-cli calendar +agenda

  description: string;
  risk: "read" | "write" | "high-risk-write" | "unknown";

  authTypes: ("user" | "bot")[];
  scopesByIdentity: {
    user?: string[];
    bot?: string[];
    fallback?: string[];
  };

  flags: ShortcutFlagCapability[];
  hasFormat: boolean;
  supportsDryRun: boolean;
  supportsJq: boolean;

  isReadOnly: boolean;
};
```

### ShortcutFlagCapability

```ts
type ShortcutFlagCapability = {
  name: string;
  type: "string" | "bool" | "int" | "string_array" | "string_slice";
  required: boolean;
  hidden: boolean;
  defaultValue?: string;
  enumValues?: string[];
  supportsFileInput: boolean;       // @file
  supportsStdinInput: boolean;      // -
  description: string;
};
```

---

## 3.3 GenericApiCapability

```ts
type GenericApiCapability = {
  id: "generic:api";
  kind: "generic_raw_api";
  rawCliShape: "lark-cli api <METHOD> <PATH>";
};
```

---

## 3.4 SchemaCapability

```ts
type SchemaCapability = {
  id: "system:schema";
  kind: "schema_introspection";
  rawCliShape: "lark-cli schema <path>";
};
```

---

# 4. 当前项目最需要的命令分类器

必须先把命令分到正确体系，否则后面所有自动化都会混乱。

---

## 4.1 分类目标

输出以下类别之一：

- `schema_introspection`
- `generic_raw_api`
- `shortcut`
- `native_method`
- `unknown`

---

## 4.2 推荐分类规则

### 规则表

| 输入形态 | 分类 |
|---|---|
| `lark-cli schema ...` | `schema_introspection` |
| `lark-cli api METHOD PATH` | `generic_raw_api` |
| 第二层命令以 `+` 开头 | `shortcut` |
| `lark-cli <service> <resource> <method>` | `native_method` |
| 无法匹配 | `unknown` |

---

## 4.3 推荐执行流程

```text
1. 先标准化输入
   - 去掉可选前缀 `lark-cli`
   - tokenize

2. 如果第一个 token == schema
   -> schema_introspection

3. 如果第一个 token == api
   -> generic_raw_api

4. 如果 token[1] 以 "+" 开头
   -> shortcut

5. 如果 token 数 >= 3
   -> 尝试按 native method 解析
      - token[0] 作为 service
      - 中间部分走 resource longest-match
      - 最后一段作为 method
      - 成功则 native_method
      - 失败则 unknown

6. 否则 unknown
```

---

# 5. 当前项目最需要的 `schema key` 解析器

这是实现层最值得优先单独做的模块之一。

---

## 5.1 已知事实

`schema key` 形式是：

```text
service.resource.method
```

但关键难点在于：

> `resource` 可以带点，不是固定一段。

例如：

- `calendar.events.get`
- `calendar.event.attendees.create`
- `sheets.spreadsheet.sheet.filters.create`

---

## 5.2 正确解析规则

### 输入
一个 schema key，例如：

```text
calendar.event.attendees.create
```

### 输出
```text
service = calendar
resource = event.attendees
method = create
```

---

## 5.3 推荐算法

### Step 1
按 `.` 切分为数组：

```text
parts = key.split(".")
```

### Step 2
第一段固定为 `service`

```text
service = parts[0]
tail = parts.slice(1)
```

### Step 3
加载该 service 下所有 resource 名集合

```text
resourceNames = all resources of service
```

### Step 4
对 `tail` 做 longest-match

即从最长前缀开始尝试：

```text
for i from tail.length - 1 down to 1:
    candidateResource = tail[0:i].join(".")
    candidateMethod = tail[i]

    if candidateResource in resourceNames
       and candidateMethod in methods(candidateResource):
          success
```

### Step 5
若成功，返回：
- `service`
- `resource`
- `method`

### Step 6
若失败：
- 返回结构化错误
- 不做脑补修正
- 交由 fallback 逻辑处理

---

## 5.4 示例

### 示例 1
```text
calendar.events.get
```

解析为：

- service = `calendar`
- resource = `events`
- method = `get`

---

### 示例 2
```text
calendar.event.attendees.create
```

解析为：

- service = `calendar`
- resource = `event.attendees`
- method = `create`

---

### 示例 3
```text
sheets.spreadsheet.sheet.filters.create
```

解析为：

- service = `sheets`
- resource = `spreadsheet.sheet.filters`
- method = `create`

---

## 5.5 重要约束

### 不要使用这种错误模型：

```text
service = parts[0]
resource = parts[1]
method = parts[2]
```

这在 dotted resource 场景会系统性失败。

---

# 6. 当前项目最需要的安全判定模型

你现在做的是“只读自动执行”，所以要有一套**稳定且保守**的 read/write 分类策略。

---

## 6.1 原生命令的安全判定

### 推荐规则

| 条件 | 判定 |
|---|---|
| `httpMethod == GET` | `read` |
| `httpMethod in {POST, PUT, PATCH, DELETE}` | `write` |
| 无法确定 | `unknown -> 保守按 write` |

### 推荐解释

原生命令是 endpoint 级调用，HTTP method 基本就是最稳的安全语义来源。

---

## 6.2 shortcut 的安全判定

### 推荐规则

| 条件 | 判定 |
|---|---|
| `risk == read` | `read` |
| `risk == write` | `write` |
| `risk == high-risk-write` | `high_risk_write` |
| `risk` 缺失 | `unknown -> 保守按 write` |

### 说明

shortcut 是工作流封装，不适合靠内部 API method 来倒推只读性。  
应该优先信任 shortcut 自身声明的 `risk`。

---

## 6.3 推荐的统一安全标签

```ts
type SafetyClass =
  | "read"
  | "write"
  | "high_risk_write"
  | "unknown";
```

---

## 6.4 自动执行建议

| 安全级别 | 默认策略 |
|---|---|
| `read` | 可进入自动执行候选 |
| `write` | 默认不自动执行 |
| `high_risk_write` | 必须人工确认 |
| `unknown` | 默认不自动执行 |

---

# 7. 当前项目最需要的 native vs shortcut 选路策略

你的 Agent 需要一个默认策略，不然能力使用会很飘。

---

## 7.1 优先用 shortcut 的场景

优先 shortcut，当满足以下任一条件：

1. 用户意图是业务级任务，不是明确某个 endpoint
2. 该 shortcut 已封装分页、聚合、格式转换、多步操作
3. 用户表达是人类语义目标，例如：
   - “看今天日程”
   - “搜索用户”
   - “拉取任务列表”
4. shortcut 明显比 native 更稳定易用

### 例子

- `calendar +agenda`
- `contact +search-user`
- `docs +fetch`

---

## 7.2 优先用 native method 的场景

优先 native method，当满足以下任一条件：

1. 目标是一个明确的 API method
2. 你需要精确控制 `--params` / `--data`
3. 你要围绕 schema 自动补参或校验
4. shortcut 不存在
5. shortcut 过于高阶，不利于稳定自动化

---

## 7.3 必须回退 `api` 的场景

只有在下面情况才回退到：

```text
lark-cli api METHOD /open-apis/...
```

### 条件

1. CLI 已注册 service/resource/method 中找不到目标能力
2. shortcut 也没有覆盖
3. 但已知 OpenAPI path 存在，且要做裸调
4. 或者要做底层探索

### 注意

`api` 是兜底能力，不应该成为默认主通道。

---

## 7.4 必须先查 `schema` 的场景

1. native method 的参数结构不明
2. 要自动构造 `--params` / `--data`
3. 要判断支持的 identity/scopes
4. 要建立能力缓存
5. 需要确认 resource/method 是否存在

---

## 7.5 一个推荐优先级

```text
如果是业务意图级任务：
    优先 shortcut
    shortcut 不满足时再看 native

如果是明确 API method / 参数构造任务：
    优先 native
    native 不存在时再考虑 api

如果是能力探索或参数探索：
    先 schema
```

---

# 8. 当前项目最需要的信息源优先级

你已经有 `--help` 轻量解析，也在做 `schema` 解析。  
现在需要明确：**谁是真源，谁只是辅助层。**

---

## 8.1 推荐优先级

### A. 原生命令相关

| 信息源 | 角色 | 优先级 |
|---|---|---|
| `schema` 输出 / registry 元数据 | 结构化真源 | 最高 |
| 原生命令 `--help` | 辅助展示层 | 次高 |
| service descriptions | service 文案补充 | 低 |
| skills 文档 | AI 使用说明，不是命令真源 | 低 |

---

### B. shortcut 相关

| 信息源 | 角色 | 优先级 |
|---|---|---|
| shortcut 源码结构 | 结构化真源 | 最高 |
| shortcut `--help` | 文案补充、展示层 | 次高 |
| skills 文档 | 业务语义和使用约束补充 | 中 |
| schema | 不适用 | 无 |

---

## 8.2 一句话原则

### 对 native
> **schema 比 help 更可信**

### 对 shortcut
> **源码定义比 help 更可信**

---

# 9. 当前项目下一步最值得做的模块（优先级建议）

下面是结合当前进度后的建议优先级。

你已经有：

1. 错误规则命中
2. tool plan 生成
3. 安全门控下自动执行只读命令
4. `--help` 轻量结构化解析
5. `schema` 输出开始做结构化解析

---

## P0：Schema Key Resolver

### 为什么最优先
因为这是 native 能力识别的基础设施。  
如果 resource longest-match 解析不稳，后面：

- schema 解析
- native capability 建模
- 参数补全
- 命令匹配

都会不稳。

### 目标
实现一个独立的：

```text
resolveSchemaKey(key, serviceSpec) -> {service, resource, method}
```

---

## P1：Native Capability Registry Builder

### 为什么优先
因为原生命令体系是最稳定、最结构化的一套能力源。

### 目标
从 schema / registry 元数据构建：

```text
schema_key -> NativeMethodCapability
```

### 它将直接支持
- 自动补参
- 安全判定
- identity/scopes 推断
- tool plan 精准化

---

## P2：Command Classifier

### 为什么优先
因为 Agent 首先要知道自己面对的是：

- schema
- api
- shortcut
- native method

否则整个执行链会走偏。

### 目标
实现统一分类器：

```text
classifyCommand(input) -> command_kind
```

---

## P3：Read/Write Policy Engine

### 为什么优先
你已经有安全门控，但现在应该把它从“经验规则”升级为“能力驱动规则”。

### 目标
基于：

- native: `httpMethod`
- shortcut: `risk`

建立统一的安全判定层。

---

## P4：Shortcut Capability Extractor

### 为什么值得做
shortcut 是第二套核心能力系统。  
如果不单独建模，Agent 对业务命令的理解永远不稳定。

### 目标
抽取并缓存：

- service
- verb
- flags
- authTypes
- risk
- dry-run 支持
- scopes

---

## P5：Native vs Shortcut Planner Normalizer

### 为什么是后一步
在前面的能力模型稳定后，才值得做“选路器”。

### 目标
把用户意图 / rule 命中目标标准化为：

- 优先 shortcut
- 或优先 native
- 或先 schema
- 或最终兜底 api

---

# 10. 一个最建议的落地顺序

如果只能按顺序做，我建议：

```text
1. Schema Key Resolver
2. Native Capability Registry Builder
3. Command Classifier
4. Read/Write Policy Engine
5. Shortcut Capability Extractor
6. Native vs Shortcut Planner Normalizer
```

---

# 11. 当前阶段最重要的一句话总结

> 你现在最需要的不是继续堆规则，  
> 而是先把 `lark-cli` 的两套能力系统拆开建模：
>
> - **native 用 `schema key` 驱动**
> - **shortcut 用 `service.+verb` 驱动**
>
> 然后在此基础上统一做：
>
> - 命令分类
> - 能力缓存
> - 安全判定
> - 选路决策

---

# 12. 最终建议

如果下一步只做一件事，优先做：

## **“Native Capability Registry Builder + Schema Key Resolver”**

原因：

- 这是最稳定的数据源
- 能最快把当前 `schema` 结构化解析变成真正可用的能力层
- 能直接提升自动执行、补参、只读判定和 tool plan 的质量

如果下一步只做两件事，就再加上：

## **Command Classifier**

这样你整个 Agent 就会开始从“规则拼接”走向“能力驱动”。
