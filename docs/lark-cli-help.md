# lark-cli 常用接口与使用说明文档
本文档整理了lark-cli最常用的接口、参数规范和使用示例，用于帮助大模型正确生成lark-cli调用代码。
> 重点：前半部分为**当前lark-cli知识助手项目专属命令**，是本项目实际会用到的核心调用；后半部分为通用命令参考。

---

## 一、当前项目专属核心命令（重点掌握）
本项目是lark-cli知识助手，核心会用到以下几类能力，所有命令均为实际可运行的真实命令：

### 1. 项目核心场景与命令映射表
| 项目场景 | 用到的技能 | 调用命令 |
|----------|------------|----------|
| 监听飞书群用户提问/报错，主动触发知识推送 | lark-event + lark-im | `lark-event listen --event-type im.message.receive_v1` |
| 从飞书文档拉取最新知识库内容 | lark-doc | `lark-cli docs +fetch --doc <知识库文档链接> --api-version v2` |
| 匹配到错误后，发送知识卡片到飞书群@用户 | lark-im | `lark-cli im +send-card --chat-id <群ID> --card <卡片JSON> --mention-user-ids <用户open_id>` |
| 用户贴出wiki链接，解析token类型 | lark-wiki | `lark-cli wiki get-node --token <wiki_token> --as user` |
| 用户遇到权限错误，给出修复命令 | lark-shared | `lark-cli auth login --scope "<缺失的scope>"` |
| 从飞书会议妙记中提取历史故障解决方案 | lark-minutes | `lark-cli minutes get --minute-token <妙记token>` |

---

### 2. 各场景详细调用示例
#### 场景A：监听飞书群消息（主动触发用）
```bash
# 实时监听飞书群接收消息事件，输出JSON格式事件
lark-event listen --event-type im.message.receive_v1 --output json
# 输出示例：{"event":{"message":{"content":"{\"text\":\"lark-cli报错：permission denied\"}","sender":{"sender_id":{"open_id":"ou_xxx"}}}}}
```

#### 场景B：从飞书文档拉取知识库
```bash
# 读取知识库文档全部内容，用于更新本地知识规则
lark-cli docs +fetch --doc https://example.feishu.cn/docx/doxcnxxx --api-version v2 --mode full --as user

# 按关键词搜索文档中特定章节的内容（比如只拉取权限相关的部分）
lark-cli docs +fetch --doc https://example.feishu.cn/docx/doxcnxxx --api-version v2 --mode keyword --keyword "scope 权限" --as user
```

#### 场景C：发送知识卡片到飞书群
```bash
# 发送交互式卡片到群里，@出错的用户
lark-cli im +send --receive-id oc_xxx --receive-id-type chat_id --content "{
  \"msg_type\": \"interactive\",
  \"card\": {
    \"header\": {\"title\": {\"content\": \"💡 lark-cli错误修复提示\", \"tag\": \"plain_text\"}},
    \"elements\": [
      {\"tag\": \"div\", \"text\": {\"content\": \"**错误类型**：权限不足\\n**问题诊断**：缺少scope: docx:document:readonly\\n**修复步骤**：\\n1. 执行 `lark-cli auth login --scope \\\"docx:document:readonly\\\"`\\n2. 重试原命令\", \"tag\": \"lark_md\"}},
      {\"tag\": \"action\", \"actions\": [{\"tag\": \"button\", \"text\": {\"content\": \"查看完整文档\", \"tag\": \"plain_text\"}, \"url\": \"https://example.feishu.cn/docx/xxx\"}]}
    ]
  }
}" --as user
```

#### 场景D：解析Wiki链接获取真实资源
```bash
# 解析用户提供的wiki链接，判断是Base还是Doc还是其他资源
lark-cli wiki get-node --token wikcnxxx --as user
# 输出示例：{"node":{"obj_token":"bascnxxx","obj_type":"bitable","title":"故障排查知识库","parent_node_token":"wikcnxxx"}}
```

---

## 二、概述
lark-cli是飞书官方提供的命令行工具，封装了所有飞书OpenAPI的调用能力，是OpenClaw技能体系的底层依赖。所有`lark-*`技能最终都是通过lark-cli执行真实的飞书API请求。

## 二、通用命令格式
```bash
# 格式1：调用shortcut（快捷命令，推荐）
lark-cli <技能名> +<shortcut名> [参数]

# 格式2：调用原生API
lark-cli <服务名> <版本> <资源> <操作> [参数]
```

### 全局通用参数（所有命令都支持）
| 参数 | 说明 | 示例 |
|------|------|------|
| `--as <身份>` | 指定调用身份，可选值：`user`（当前登录用户）、`bot`（应用机器人） | `--as user` |
| `--api-version <版本号>` | 指定API版本，常用于lark-doc等需要指定v2版本的场景 | `--api-version v2` |
| `--params <JSON>` | 传递URL参数/Query参数，对应OpenAPI的parameters字段 | `--params '{"page_size":10}'` |
| `--data <JSON>` | 传递请求体参数，对应OpenAPI的requestBody字段 | `--data '{"name":"测试"}'` |
| `-h/--help` | 查看命令帮助文档 | `lark-cli doc --help` |

## 三、常用技能核心命令清单
### 1. lark-shared（通用能力）
```bash
# 查看当前登录身份和权限
lark-cli auth show

# 用户身份登录授权，支持增量添加scope
lark-cli auth login --scope "docx:document:readonly,bitable:app:readonly"

# 查看API结构定义（原生API调用前必查）
lark-cli schema <service.resource.method>
# 示例：查发送消息API结构
lark-cli schema im.v1.message.create
```

### 2. lark-doc（云文档）
```bash
# 读取文档内容（v2版本必须加--api-version v2）
lark-cli docs +fetch --doc <文档链接/token> --api-version v2 --as user

# 创建新文档
lark-cli docs +create --title "文档标题" --content "<title>测试</title><p>内容</p>" --api-version v2 --as user

# 搜索云空间文档
lark-cli docs +search --keyword "关键词" --as user
```

### 3. lark-base（多维表格）
```bash
# 列出Base下所有数据表
lark-cli base +table-list --base-token <base_token> --as user

# 列出数据表的所有字段结构
lark-cli base +field-list --base-token <base_token> --table-id <table_id> --as user

# 查询数据表记录
lark-cli base +record-list --base-token <base_token> --table-id <table_id> --page-size 20 --as user

# 新增/更新记录
lark-cli base +record-upsert --base-token <base_token> --table-id <table_id> --fields '{"字段名":"字段值"}' --as user
```

### 4. lark-wiki（知识库）
```bash
# 解析wiki节点，获取真实资源token和类型
lark-cli wiki get-node --token <wiki_token> --as user
# 返回示例：{"node":{"obj_token":"bascnxxx","obj_type":"bitable","title":"测试多维表格"}}
```

### 5. lark-im（即时通讯）
```bash
# 发送文本消息
lark-cli im +send --receive-id <open_id/chat_id> --receive-id-type open_id --content "消息内容" --as user

# 发送富文本/卡片消息
lark-cli im v1 message create --params '{"receive_id_type":"open_id"}' --data '{"receive_id":"ou_xxx","content":"{\"text\":\"测试\"}","msg_type":"text"}' --as user
```

### 6. lark-calendar（日历）
```bash
# 查询用户忙闲状态
lark-cli calendar +freebusy --user-ids "ou_xxx,ou_yyy" --start-time "2026-05-01 09:00" --end-time "2026-05-01 18:00" --as user

# 查询可用会议室
lark-cli calendar +room-find --start-time "2026-05-01 10:00" --end-time "2026-05-01 11:00" --capacity 10 --as user
```

### 7. lark-drive（云空间）
```bash
# 获取文件/文件夹元信息
lark-cli drive get --file-token <file_token> --as user

# 上传本地文件到云空间
lark-cli drive upload --local-path "./test.docx" --parent-type "explorer" --parent-node "root" --as user
```

### 8. lark-sheets（电子表格）
```bash
# 读取表格数据
lark-cli sheets +read --sheet-token <sheet_token> --range "Sheet1!A1:C10" --as user

# 写入表格数据
lark-cli sheets +write --sheet-token <sheet_token> --range "Sheet1!A1" --values '[["标题1","标题2"],["值1","值2"]]' --as user
```

## 四、参数规范
### 1. --params 和 --data 的区别
- `--params`：对应OpenAPI的`parameters`字段，用来传递URL参数、Query参数、路径参数
- `--data`：对应OpenAPI的`requestBody`字段，用来传递POST/PUT请求的请求体内容
- 查不到参数应该放哪里时，先执行`lark-cli schema <API路径>`查看结构定义

### 2. token 类型区分
| token类型 | 来源链接示例 | 适用场景 |
|-----------|--------------|----------|
| `wiki_token` | `https://xxx.feishu.cn/wiki/wikcnxxx` | wiki节点解析，不能直接作为base/doc的token |
| `base_token` | `https://xxx.feishu.cn/base/bascnxxx` | lark-base所有操作 |
| `docx_token` | `https://xxx.feishu.cn/docx/doxcnxxx` | lark-doc操作docx类型文档 |
| `sheet_token` | `https://xxx.feishu.cn/sheets/shtcnxxx` | lark-sheets操作电子表格 |
| `file_token` | `https://xxx.feishu.cn/file/filecnxxx` | lark-drive操作普通文件 |

## 五、常见错误码对照表
| 错误码 | 含义 | 解决方案 |
|--------|------|----------|
| 91403 | 权限不足/scope缺失 | 按lark-shared权限流程处理，user身份加scope，bot身份去后台开权限 |
| 91000 | token无效/过期 | 重新登录或检查token配置 |
| 90001 | 参数错误 | 检查参数结构，执行schema命令查看正确格式 |
| 1254015 | Base字段不可写 | 移除公式字段、系统字段、只读字段，只写可编辑字段 |

## 六、调用示例
### 示例1：从wiki链接解析出base并读取记录
```bash
# 1. 解析wiki节点
lark-cli wiki get-node --token wikcnxxx --as user
# 得到obj_token: bascnxxx, obj_type: bitable

# 2. 列出base下的表
lark-cli base +table-list --base-token bascnxxx --as user
# 得到table_id: tblxxx

# 3. 读取表记录
lark-cli base +record-list --base-token bascnxxx --table-id tblxxx --as user
```

### 示例2：发送飞书消息
```bash
# 使用shortcut快捷发送
lark-cli im +send --receive-id ou_xxx --receive-id-type open_id --content "测试消息" --as user

# 使用原生API发送卡片
lark-cli im v1 message create --params '{"receive_id_type":"open_id"}' --data '{"receive_id":"ou_xxx","content":"{\"msg_type\":\"interactive\",\"card\":{\"elements\":[{\"tag\":\"div\",\"text\":{\"content\":\"测试卡片\",\"tag\":\"lark_md\"}}]}}"}' --as user
```
