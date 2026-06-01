# OAR Agent for n8n

OAR 是一个运行在飞书群聊/私聊中的 OKR 助手，基于 n8n Workflow + AI Agent 构建。

当前版本支持：
- 读取单人 OKR（`read_okr`）
- 读取群成员列表（`list_chat_members`，用于群 OKR 汇总前置）
- 结构化 OKR 返回（`data.objectives[].keyResults[]`）
- 个人 OKR 风险分析（`analyze_okr`）
- 团队 OKR 汇总（`summarize_group_okrs`）
- 两段式修改自己的 Objective / KR（`propose_okr_update` -> `execute_okr_update`）
- 读取自己负责的飞书任务（`list_my_tasks`）
- 读取自己或当前消息里被 @ 用户的通讯录基础信息（`get_user_basic` / `get_mentioned_users`）
- 读取会话引用上下文（被引用消息、话题串、近期聊天）
- 通过白名单 registry 给其他机器人派发最小化任务（`dispatch_task`）

## 项目结构

- `OAR.json`
  - 主工作流（飞书触发 -> 消息预处理 -> AI Agent -> 回复消息）
- `OAR_okr_tools.json`
  - OKR 工具子工作流（`okr_tools`）
- `OAR_conversation_context_tools.json`
  - 会话上下文工具子工作流（`conversation_context_tools`）
- `OAR_bot_task_tools.json`
  - 跨机器人任务派发工具子工作流（`bot_task_tools`）
- `OAR_okr_write_tools.json`
  - 受控 OKR 写入工具子工作流（`okr_write_tools`）
- `OAR_lark_read_tools.json`
  - 飞书任务/通讯录只读工具子工作流（`lark_read_tools`）

## 前置条件

1. 已部署可用的 n8n 实例
2. 飞书应用已创建并具备对应权限
3. OpenAI API 可用（用于 AI Agent 模型节点）

## 飞书建议权限

根据当前工作流调用接口，建议至少包含：
- 消息接收与发送相关权限（IM）
- 读取群成员权限（`im:chat.members:read`）
- OKR 读取相关权限（OKR OpenAPI）
- 若启用 OKR 修改能力，需要 OKR 写入权限（`okr:okr.content:writeonly`）
- 若启用任务读取能力，需要任务读取权限（`task:task:read`）
- 若启用通讯录读取能力，需要通讯录基础读取权限（如 `contact:user.base:readonly`、`contact:user.basic_profile:readonly`）

如果某些接口报 403 或空数据，请先检查飞书应用权限与租户管理员授权状态。
注意：线上 n8n 使用的是 n8n 凭证里的飞书应用配置；本地 `lark-cli` 的授权只用于本地调试，不能证明线上 n8n 凭证已有相同权限。

## 在 n8n 中导入

1. 先导入 `OAR_okr_tools.json`
2. 再导入 `OAR_conversation_context_tools.json`
3. 再导入 `OAR_bot_task_tools.json`
4. 再导入 `OAR_okr_write_tools.json`
5. 再导入 `OAR_lark_read_tools.json`
6. 最后导入 `OAR.json`

说明：主工作流里的 `Tool Workflow` 节点会引用子工作流。若导入后引用丢失，请在节点中重新选择对应 workflow。

## 凭证配置

导入后请检查并替换以下凭证：

1. `larkApi`（飞书凭证）
2. `openAiApi`（OpenAI 凭证）

并在以下节点确认配置：
- `Lark Trigger`
- `Send message`
- `OpenAI Chat Model`
- 子工作流中的所有 HTTP Request（`nodeCredentialType: larkApi`）

OKR 修改能力还依赖 n8n Data Table：

- 表名：`oar_okr_write_proposals`
- 当前线上表 ID：`wMbt7FsvuNdigR5b`
- 用途：保存待确认的 OKR 修改草案与执行状态

## 运行方式

1. 激活 `OAR` 主工作流
2. 在飞书中给机器人发消息，或在群里 `@` 机器人并提问 OKR 相关问题
3. 机器人将根据消息意图调用 `okr_tools` / `okr_write_tools` / `lark_read_tools` / `conversation_context_tools` / `bot_task_tools` 并返回结果

## 使用 n8n-cli 更新

本仓库使用 `n8n-cli` 更新线上工作流。更新前先导出备份：

```bash
mkdir -p backups/$(date +%Y%m%d_%H%M%S)
n8n-cli workflow get NPmg6IV5BCjsBrDh --format=json > backups/<timestamp>/OAR.online.json
n8n-cli workflow get YzwZbpxLpOren7HI --format=json > backups/<timestamp>/OAR_okr_tools.online.json
n8n-cli workflow get Ucyq29dR28usv42j --format=json > backups/<timestamp>/OAR_conversation_context_tools.online.json
n8n-cli workflow get JdeFwwuDd1tUseOl --format=json > backups/<timestamp>/OAR_bot_task_tools.online.json
n8n-cli workflow get Qiai5nF0ENxuWOgO --format=json > backups/<timestamp>/OAR_okr_write_tools.online.json
n8n-cli workflow get NKiGjIo6ehm6QFVz --format=json > backups/<timestamp>/OAR_lark_read_tools.online.json
```

线上 API 不接受导出 JSON 中的只读字段。部署前先生成精简 payload：

```bash
node scripts/verify-workflow-code.mjs
node scripts/prepare-deploy.mjs
n8n-cli workflow update YzwZbpxLpOren7HI --file .deploy/OAR_okr_tools.json
n8n-cli workflow update Qiai5nF0ENxuWOgO --file .deploy/OAR_okr_write_tools.json
n8n-cli workflow update NKiGjIo6ehm6QFVz --file .deploy/OAR_lark_read_tools.json
n8n-cli workflow update NPmg6IV5BCjsBrDh --file .deploy/OAR.json
```

`backups/` 和 `.deploy/` 已加入 `.gitignore`，避免把完整线上导出误提交到仓库。

## 工具能力

`okr_tools` 支持以下 action：

- `read_okr`
  - 读取单人 OKR。
  - 返回兼容旧逻辑的 `output`，同时返回结构化 `data.objectives[].keyResults[]`。
- `list_chat_members`
  - 读取当前群成员，作为团队 OKR 汇总前置步骤。
  - `allowedChatId` 由父工作流从当前群事件固定注入；AI 参数中的 `chatId` 或伪造 `allowedChatId` 会被拒绝。
- `analyze_okr`
  - 输入 `read_okr` 的结构化结果，输出风险、缺口和建议。
- `summarize_group_okrs`
  - 输入多个 `read_okr` 结果，输出团队概览、主要风险、缺口和部分结果标记。

`conversation_context_tools` 支持：

- `resolve_context`
  - 读取当前消息可用的引用消息、话题串或近期聊天上下文。

`okr_write_tools` 支持：

- `propose_okr_update`
  - 生成 OKR 修改草案，不直接写入。
  - 第一版只允许修改发消息人自己的 Objective / KR 的 `contentText`、`score`、`deadline`。
  - 禁止修改他人 OKR、删除、权重、排序、对齐、指标、备注、分类和进展记录。
- `execute_okr_update`
  - 只有用户在同一会话精确回复 `确认 <proposalId>` 后才执行 PATCH。
  - 执行前会重新读取目标 OKR，若草案生成后内容、分数、截止日期或更新时间发生变化，会拒绝并要求重新生成草案。
  - proposal 状态存储在 n8n Data Table `oar_okr_write_proposals`。

`lark_read_tools` 支持：

- `list_my_tasks`
  - 读取发消息人自己负责的飞书任务。
  - 使用飞书 `task/v2/tasks` 的 `type=my_tasks` 标准列表接口；AI 或用户文本里传入的其他 `open_id/user_id/assignee` 会被拒绝。
  - 支持可选的 `completed` 过滤；`query` 会在返回列表后按任务标题本地过滤。
- `get_mentioned_users`
  - 批量读取当前消息里被 @ 用户的通讯录基础信息。
  - 允许读取的用户列表来自父工作流解析到的真实 mentions，不接受 AI 伪造。
- `get_user_basic`
  - 读取发消息人自己，或当前消息里被 @ 用户的基础信息。
  - 默认不输出邮箱、手机号、工号、职级等敏感字段。

`bot_task_tools` 支持：

- `dispatch_task`
  - 输入 `botKey`、`taskType`、`prompt`、`minimalContext`、`expectedOutput`。
  - `botKey` 必须存在于工具工作流内的 registry。
  - 禁止在调用参数里直接传 `chatId`、`webhookUrl`、URL、`destination`、`endpoint`、`receive_id` 或 `open_id`。
  - 派单文本和上下文摘要有长度限制，超长内容会截断。
  - 默认 registry 为空，因此未配置机器人时会返回 `BOT_NOT_CONFIGURED`，不会假装派发成功。

## 机器人 Registry

`OAR_bot_task_tools.json` 中的 `Dispatch task` Code 节点包含静态 registry：

```javascript
const registry = {
  // research_bot: {
  //   displayName: 'Research Bot',
  //   enabled: true,
  //   transport: 'webhook',
  //   webhookUrl: 'https://example.com/webhook',
  //   allowedActions: ['research', 'check'],
  //   privacyLevel: 'minimal'
  // }
};
```

建议只配置明确可信的机器人，并按 `allowedActions` 限制它能执行的任务类型。OAR 派任务时默认只传最小上下文摘要，不传完整 OKR 或完整聊天记录。

## 常见问题

1. `Problem in node 'AI Agent': Cannot read properties of undefined (reading 'map')`
   - 常见原因是 AI Agent 关联的模型/工具/内存节点配置异常或版本兼容问题。
   - 建议逐项检查：
     - `OpenAI Chat Model` 是否正确连到 `AI Agent`
     - `okr_tools`、`conversation_context_tools` 是否正确连到 `AI Agent` 的 `ai_tool`
     - `Simple Memory` 是否正确连到 `AI Agent` 的 `ai_memory`
     - 各节点版本与当前 n8n 版本是否兼容

2. 群里不触发
   - 当前逻辑要求：群消息需要 `@` 机器人或命令前缀（如 `/oar`、`/okr`）。

3. 读取不到群成员
   - 检查机器人是否在群内，及飞书权限 `im:chat.members:read` 是否已开通并授权。

4. 派任务提示机器人未配置
   - 这是安全默认行为。请先在 `OAR Bot Task Tools` 的 registry 中加入目标机器人，再让 OAR 派发。

## 后续建议

- 增加每周自动复盘/周报（Schedule Trigger）
- 增加团队 OKR 对齐图
- 增加可审计的派发日志
- 增加受控写入类能力（创建飞书任务、生成复盘文档）
