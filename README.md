# OAR Agent for n8n

OAR 是一个运行在飞书群聊/私聊中的 OKR 助手，基于 n8n Workflow + AI Agent 构建。

当前版本支持：
- 读取单人 OKR（`read_okr`）
- 读取群成员列表（`list_chat_members`，用于群 OKR 汇总前置）
- 读取会话引用上下文（被引用消息、话题串、近期聊天）

## 项目结构

- `OAR.json`
  - 主工作流（飞书触发 -> 消息预处理 -> AI Agent -> 回复消息）
- `OAR_okr_tools.json`
  - OKR 工具子工作流（`okr_tools`）
- `OAR_conversation_context_tools.json`
  - 会话上下文工具子工作流（`conversation_context_tools`）

## 前置条件

1. 已部署可用的 n8n 实例
2. 飞书应用已创建并具备对应权限
3. OpenAI API 可用（用于 AI Agent 模型节点）

## 飞书建议权限

根据当前工作流调用接口，建议至少包含：
- 消息接收与发送相关权限（IM）
- 读取群成员权限（`im:chat.members:read`）
- OKR 读取相关权限（OKR OpenAPI）

如果某些接口报 403 或空数据，请先检查飞书应用权限与租户管理员授权状态。

## 在 n8n 中导入

1. 先导入 `OAR_okr_tools.json`
2. 再导入 `OAR_conversation_context_tools.json`
3. 最后导入 `OAR.json`

说明：主工作流里的两个 `Tool Workflow` 节点会引用子工作流。若导入后引用丢失，请在节点中重新选择对应 workflow。

## 凭证配置

导入后请检查并替换以下凭证：

1. `larkApi`（飞书凭证）
2. `openAiApi`（OpenAI 凭证）

并在以下节点确认配置：
- `Lark Trigger`
- `Send message`
- `OpenAI Chat Model`
- 子工作流中的所有 HTTP Request（`nodeCredentialType: larkApi`）

## 运行方式

1. 激活 `OAR` 主工作流
2. 在飞书中给机器人发消息，或在群里 `@` 机器人并提问 OKR 相关问题
3. 机器人将根据消息意图调用 `okr_tools` / `conversation_context_tools` 并返回结果

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

## 后续建议

- 增加结构化 OKR 返回（不仅返回文本）
- 增加 OKR 风险分析 action
- 增加每周自动复盘/周报（Schedule Trigger）
- 增加团队 OKR 汇总与对齐分析
