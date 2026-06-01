import fs from 'node:fs';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function readWorkflow(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function codeOf(workflow, name) {
  return workflow.nodes.find((node) => node.name === name).parameters.jsCode;
}

async function run(
  code,
  { input = [], nodes = {}, helpers = {}, strictNodeExecution = false } = {},
) {
  const fn = new AsyncFunction('$input', '$', '$helpers', code);
  const $input = { all: () => input, first: () => input[0] };
  const $ = (name) => {
    const isExecuted = Object.prototype.hasOwnProperty.call(nodes, name);
    return {
      isExecuted,
      all: () => {
        if (strictNodeExecution && !isExecuted) {
          throw new Error('Referenced node is unexecuted: ' + name);
        }
        return nodes[name] || [];
      },
    };
  };
  return fn($input, $, helpers);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function larkTextEvent(text, messageId = 'om_1') {
  return {
    json: {
      event: {
        sender: { sender_type: 'user', sender_id: { open_id: 'ou_1' } },
        message: {
          message_type: 'text',
          chat_type: 'p2p',
          chat_id: 'oc_current',
          message_id: messageId,
          content: JSON.stringify({ text }),
        },
      },
    },
  };
}

const okr = readWorkflow('OAR_okr_tools.json');
const bot = readWorkflow('OAR_bot_task_tools.json');
const oar = readWorkflow('OAR.json');
const okrWrite = readWorkflow('OAR_okr_write_tools.json');
const larkRead = readWorkflow('OAR_lark_read_tools.json');
const conversationContext = readWorkflow('OAR_conversation_context_tools.json');

const readResult = await run(codeOf(okr, 'Format OKR result'), {
  input: [
    {
      json: {
        key_results: [
          {
            id: 'kr_1',
            content: '完成 10 个客户访谈',
            score: 0.4,
            position: 1,
          },
        ],
      },
    },
  ],
  nodes: {
    Normalize: [
      {
        json: {
          targetUserId: 'ou_1',
          targetUserIdType: 'open_id',
          targetDisplayName: '测试用户',
        },
      },
    ],
    'Expand objectives': [
      {
        json: {
          targetDisplayName: '测试用户',
          targetUserId: 'ou_1',
          targetUserIdType: 'open_id',
          cycleId: 'cycle_1',
          cycleLabel: '2026-04-01 - 2026-06-30',
          cycleStartDate: '2026-04-01',
          cycleEndDate: '2026-06-30',
          objective: {
            id: 'obj_1',
            content: '提升产品验证效率',
            score: 0.6,
          },
          objectiveId: 'obj_1',
          noObjectives: false,
        },
      },
    ],
  },
});
const readJson = readResult[0].json;

assert(readJson.ok === true, 'read_okr should succeed');
assert(
  readJson.data.objectives[0].keyResults[0].id === 'kr_1',
  'read_okr should return structured key results',
);
assert(
  readJson.data.counts.keyResults === 1,
  'read_okr should count key results',
);

const analysis = await run(codeOf(okr, 'Format OKR analysis'), {
  input: [
    {
      json: {
        action: 'analyze_okr',
        toolInput: { okrResult: readJson },
      },
    },
  ],
});

assert(analysis[0].json.ok === true, 'analyze_okr should succeed');
assert(
  analysis[0].json.data.risks.some((risk) => risk.type === 'low_kr_score'),
  'analyze_okr should flag low KR scores',
);

const summary = await run(codeOf(okr, 'Format group OKR summary'), {
  input: [
    {
      json: {
        action: 'summarize_group_okrs',
        chatDisplayName: '测试团队',
        toolInput: {
          chatDisplayName: '测试团队',
          hasMore: true,
          okrResults: [
            readJson,
            {
              ok: false,
              error: { code: 'READ_FAILED', message: 'no permission' },
            },
          ],
        },
      },
    },
  ],
});

assert(summary[0].json.ok === true, 'summarize_group_okrs should succeed');
assert(
  summary[0].json.data.partial === true,
  'summarize_group_okrs should mark partial results',
);
assert(
  summary[0].json.data.counts.failedTargets === 1,
  'summarize_group_okrs should count failed targets',
);

const botCode = codeOf(bot, 'Dispatch task');
const unknownBot = await run(botCode, {
  input: [
    {
      json: {
        query: JSON.stringify({
          action: 'dispatch_task',
          botKey: 'research_bot',
          taskType: 'research',
          task: '整理市场背景',
        }),
      },
    },
  ],
});
assert(
  unknownBot[0].json.error.code === 'BOT_NOT_CONFIGURED',
  'unknown bots should be rejected',
);

const directUrl = await run(botCode, {
  input: [
    {
      json: {
        query: JSON.stringify({
          action: 'dispatch_task',
          botKey: 'research_bot',
          taskType: 'research',
          task: '整理市场背景',
          webhookUrl: 'https://example.com',
        }),
      },
    },
  ],
});
assert(
  directUrl[0].json.error.code === 'DIRECT_DESTINATION_FORBIDDEN',
  'direct destinations should be rejected',
);

const directAlias = await run(botCode, {
  input: [
    {
      json: {
        query: JSON.stringify({
          action: 'dispatch_task',
          botKey: 'research_bot',
          taskType: 'research',
          task: '整理市场背景',
          open_id: 'ou_external',
        }),
      },
    },
  ],
});
assert(
  directAlias[0].json.error.code === 'DIRECT_DESTINATION_FORBIDDEN',
  'direct destination aliases should be rejected',
);

const oversizedPrompt = await run(botCode, {
  input: [
    {
      json: {
        query: JSON.stringify({
          action: 'dispatch_task',
          botKey: 'research_bot',
          taskType: 'research',
          task: 'x'.repeat(1200),
        }),
      },
    },
  ],
});
assert(
  oversizedPrompt[0].json.meta.truncated === true,
  'oversized bot task text should be marked as truncated',
);

const larkReadNormalizeCode = codeOf(larkRead, 'Normalize');
const larkReadTrustedInput = {
  trustedSenderOpenId: 'ou_1',
  trustedMessageId: 'om_read',
  trustedMessageText: '查看我的任务',
  trustedChatId: 'oc_current',
  trustedSessionKey: 'oar:chat:oc_current:user:ou_1',
  allowedContactUserIdsJson: JSON.stringify([{ openId: 'ou_2', name: '张三' }]),
};
const listMyTasks = await run(larkReadNormalizeCode, {
  input: [
    {
      json: {
        ...larkReadTrustedInput,
        query: JSON.stringify({
          action: 'list_my_tasks',
          completed: false,
          query: 'OKR',
        }),
      },
    },
  ],
});
assert(
  listMyTasks[0].json.taskListParams.type === 'my_tasks',
  'list_my_tasks should use Feishu tasks.list my_tasks scope',
);
assert(
  listMyTasks[0].json.taskListParams.completed === false,
  'list_my_tasks should support completion filtering',
);
assert(
  listMyTasks[0].json.taskListUrl.includes('/task/v2/tasks?') &&
    !listMyTasks[0].json.taskListUrl.includes('/tasks/search') &&
    !('assignee_ids' in listMyTasks[0].json.taskListParams),
  'list_my_tasks should call the official tasks.list API without unsupported assignee filters',
);

const forgedTaskOwner = await run(larkReadNormalizeCode, {
  input: [
    {
      json: {
        ...larkReadTrustedInput,
        query: JSON.stringify({
          action: 'list_my_tasks',
          targetUserId: 'ou_other',
        }),
      },
    },
  ],
});
assert(
  forgedTaskOwner[0].json.error.code === 'READ_SELF_TASKS_ONLY',
  'list_my_tasks should reject AI-supplied assignee ids',
);

const taskFormatted = await run(codeOf(larkRead, 'Format task result'), {
  input: [
    {
      json: {
        data: {
          items: [
            {
              guid: 'task-guid-1',
              summary: '跟进 OKR 风险',
              status: 'todo',
              due: { timestamp: '1780243200000' },
              url: 'https://applink.feishu.cn/client/todo/detail?guid=task-guid-1',
            },
          ],
          has_more: true,
          page_token: 'pt_next',
        },
      },
    },
  ],
  nodes: { Normalize: listMyTasks },
});
assert(taskFormatted[0].json.ok === true, 'Format task result should succeed');
assert(
  taskFormatted[0].json.data.tasks[0].guid === 'task-guid-1',
  'Format task result should keep task guid',
);

const mentionedContact = await run(larkReadNormalizeCode, {
  input: [
    {
      json: {
        ...larkReadTrustedInput,
        query: JSON.stringify({ action: 'get_mentioned_users' }),
      },
    },
  ],
});
assert(
  mentionedContact[0].json.contactUserIds[0] === 'ou_2',
  'get_mentioned_users should read only injected mentioned users',
);

const forgedContact = await run(larkReadNormalizeCode, {
  input: [
    {
      json: {
        ...larkReadTrustedInput,
        query: JSON.stringify({ action: 'get_user_basic', targetUserId: 'ou_3' }),
      },
    },
  ],
});
assert(
  forgedContact[0].json.error.code === 'CONTACT_TARGET_NOT_ALLOWED',
  'get_user_basic should reject non-sender non-mentioned users',
);

const contactFormatted = await run(codeOf(larkRead, 'Format contact result'), {
  input: [
    {
      json: {
        data: {
          user: {
            open_id: 'ou_2',
            localized_name: '张三',
            department: '产品部',
            is_activated: true,
            email: 'should-not-leak@example.com',
          },
        },
      },
    },
  ],
  nodes: { Normalize: mentionedContact },
});
assert(contactFormatted[0].json.ok === true, 'Format contact result should succeed');
assert(
  contactFormatted[0].json.data.users[0].email === undefined,
  'Format contact result should not expose email by default',
);

const normalizeCode = codeOf(okr, 'Normalize');
const directChatId = await run(normalizeCode, {
  input: [
    {
      json: {
        allowedChatId: 'oc_current',
        query: JSON.stringify({
          action: 'list_chat_members',
          chatId: 'oc_external',
        }),
      },
    },
  ],
});
assert(
  directChatId[0].json.chatAuthorizationError === 'DIRECT_CHAT_ID_FORBIDDEN',
  'list_chat_members should reject bare chatId',
);
assert(
  directChatId[0].json.chatId === '',
  'list_chat_members should not forward bare chatId',
);

const allowedChatId = await run(normalizeCode, {
  input: [
    {
      json: {
        allowedChatId: 'oc_current',
        query: JSON.stringify({
          action: 'list_chat_members',
        }),
      },
    },
  ],
});
assert(
  allowedChatId[0].json.chatId === 'oc_current',
  'list_chat_members should accept allowedChatId',
);

const forgedAllowedChatId = await run(normalizeCode, {
  input: [
    {
      json: {
        allowedChatId: 'oc_current',
        query: JSON.stringify({
          action: 'list_chat_members',
          allowedChatId: 'oc_external',
        }),
      },
    },
  ],
});
assert(
  forgedAllowedChatId[0].json.chatAuthorizationError === 'ALLOWED_CHAT_ID_MISMATCH',
  'list_chat_members should reject forged allowedChatId',
);
assert(
  forgedAllowedChatId[0].json.chatId === '',
  'list_chat_members should not forward forged allowedChatId',
);

const rejectedChatId = await run(codeOf(okr, 'Format result'), {
  input: [{ json: {} }],
  nodes: { Normalize: directChatId },
});
assert(
  rejectedChatId[0].json.error.code === 'DIRECT_CHAT_ID_FORBIDDEN',
  'list_chat_members should return a stable error for bare chatId',
);

const okrTool = oar.nodes.find((node) => node.name === 'okr_tools');
assert(
  okrTool.parameters.workflowInputs.value.query.includes('$fromAI'),
  'okr_tools query should be supplied by the model',
);
assert(
  okrTool.parameters.workflowInputs.value.allowedChatId.includes('$json.entities.chat.allowedChatId'),
  'okr_tools allowedChatId should be bound from semantic entities',
);

const okrWriteTool = oar.nodes.find((node) => node.name === 'okr_write_tools');
assert(okrWriteTool, 'okr_write_tools should be connected to the main agent');
const aiAgent = oar.nodes.find((node) => node.name === 'AI Agent');
const systemMessage = aiAgent?.parameters?.options?.systemMessage || '';
const agentText = aiAgent?.parameters?.text || '';
assert(
  systemMessage.includes('每次回复带 1-3 个贴合语义的 emoji') &&
    systemMessage.includes('少用符号和 Markdown') &&
    systemMessage.includes('默认 2-5 行'),
  'AI Agent should keep replies concise, low-symbol, and emoji-friendly',
);
assert(
  systemMessage.includes('输入 JSON 只包含 message、intentHint、intentConfidence、signals 和 entities') &&
    systemMessage.includes('entities.message.contextHints') &&
    !systemMessage.includes('entities.message.entities.message.contextHints') &&
    !systemMessage.includes('"entities.target.displayName"') &&
    !systemMessage.includes('"entities.message.contextHints"'),
  'AI Agent should describe the latest semantic packet without dotted JSON keys',
);
assert(
  agentText.includes('$json.entities') &&
    !agentText.includes('$json.chatId') &&
    !agentText.includes('$json.sessionKey') &&
    !agentText.includes('$json.text'),
  'AI Agent input should use only the latest semantic packet',
);
const simpleMemory = oar.nodes.find((node) => node.name === 'Simple Memory');
assert(
  simpleMemory?.parameters?.sessionKey?.includes('$json.entities.sessionKey'),
  'Simple Memory should use semantic entities.sessionKey',
);
assert(
  okrWriteTool.parameters.workflowInputs.value.query.includes('$fromAI'),
  'okr_write_tools query should be supplied by the model',
);
for (const field of [
  'trustedSenderOpenId',
  'trustedMessageId',
  'trustedMessageText',
  'trustedChatId',
  'trustedSessionKey',
]) {
  assert(
    okrWriteTool.parameters.workflowInputs.value[field].includes('$json.entities') ||
      okrWriteTool.parameters.workflowInputs.value[field].includes('$json.message'),
    `okr_write_tools ${field} should be bound from semantic entities`,
  );
}

const larkReadTool = oar.nodes.find((node) => node.name === 'lark_read_tools');
assert(larkReadTool, 'lark_read_tools should be connected to the main agent');
const larkReadTaskHttp = larkRead.nodes.find((node) => node.name === 'HTTP list my tasks');
assert(
  larkReadTaskHttp?.parameters?.method === 'GET' &&
    larkReadTaskHttp.parameters.url.includes('$json.taskListUrl') &&
    !larkRead.nodes.some((node) => node.name === 'HTTP search my tasks') &&
    !JSON.stringify(larkRead).includes('/tasks/search'),
  'lark_read_tools should use Feishu tasks.list instead of a nonexistent task search endpoint',
);
assert(
  larkReadTool.parameters.workflowId.value !== 'REPLACE_OAR_LARK_READ_TOOLS_ID',
  'lark_read_tools should reference a real workflow id',
);
assert(
  larkReadTool.parameters.workflowInputs.value.query.includes('$fromAI'),
  'lark_read_tools query should be supplied by the model',
);
for (const field of [
  'trustedSenderOpenId',
  'trustedMessageId',
  'trustedMessageText',
  'trustedChatId',
  'trustedSessionKey',
]) {
  assert(
    larkReadTool.parameters.workflowInputs.value[field].includes('$json.entities') ||
      larkReadTool.parameters.workflowInputs.value[field].includes('$json.message'),
    `lark_read_tools ${field} should be bound from semantic entities`,
  );
}
assert(
  larkReadTool.parameters.workflowInputs.value.allowedContactUserIdsJson.includes('$json.entities.mentions'),
  'lark_read_tools should receive only injected mentioned contact ids from entities',
);
assert(
  systemMessage.includes('飞书任务/通讯录读取工具：lark_read_tools') &&
    systemMessage.includes('不要做姓名/邮箱/手机号模糊搜索') &&
    systemMessage.includes('intentHint=list_my_tasks') &&
    systemMessage.includes('OKR 时间管理大师'),
  'AI Agent should describe read-only task/contact privacy boundaries',
);

const conversationContextTool = oar.nodes.find(
  (node) => node.name === 'conversation_context_tools',
);
assert(conversationContextTool, 'conversation_context_tools should be connected to the main agent');
assert(
  conversationContextTool.parameters.workflowInputs.value.query.includes('$fromAI') &&
    conversationContextTool.parameters.workflowInputs.value.trustedContextHintsJson.includes(
      '$json.entities.message.contextHints',
    ),
  'conversation_context_tools should bind trusted context hints outside the AI query',
);
assert(
  systemMessage.includes('不要传 contextHints、chatId、referencedMessageId、threadId') &&
    systemMessage.includes('reference > thread > chat'),
  'AI Agent should describe the trusted context ID boundary',
);

const contextNodeNames = conversationContext.nodes.map((node) => node.name);
const contextHttpNodes = conversationContext.nodes.filter(
  (node) => node.type === 'n8n-nodes-base.httpRequest',
);
assert(
  contextHttpNodes.length === 1 && contextHttpNodes[0].name === 'HTTP get context',
  'conversation_context_tools should use one unified HTTP get context node',
);
assert(
  !contextNodeNames.some((name) => /^HTTP get /.test(name) && name !== 'HTTP get context'),
  'conversation_context_tools should not keep legacy split HTTP context nodes',
);

const contextNormalizeCode = codeOf(conversationContext, 'Normalize');
const contextAllHints = await run(contextNormalizeCode, {
  input: [
    {
      json: {
        query: JSON.stringify({
          action: 'resolve_context',
          limit: 12,
        }),
        trustedContextHintsJson: JSON.stringify({
          referencedMessageId: 'om_ref',
          threadId: 'omt_thread',
          chatId: 'oc_chat',
        }),
      },
    },
  ],
});
assert(
  contextAllHints[0].json.contextType === 'reference',
  'conversation normalize should prioritize referenced message over thread/chat',
);
assert(
  contextAllHints[0].json.contextQuery.message_ids === 'om_ref' &&
    contextAllHints[0].json.contextUrl.includes('/im/v1/messages/mget?') &&
    contextAllHints[0].json.contextUrl.includes('message_ids=om_ref'),
  'reference context should use mget URL and message_ids query',
);

const contextThread = await run(contextNormalizeCode, {
  input: [
    {
      json: {
        query: JSON.stringify({
          action: 'resolve_context',
          limit: 99,
        }),
        trustedContextHintsJson: JSON.stringify({
          threadId: 'omt_thread_only',
          chatId: 'oc_chat_fallback',
        }),
      },
    },
  ],
});
assert(
  contextThread[0].json.contextType === 'thread',
  'conversation normalize should use thread context when no reference id exists',
);
assert(
  contextThread[0].json.contextQuery.container_id_type === 'thread' &&
    contextThread[0].json.contextQuery.container_id === 'omt_thread_only' &&
    contextThread[0].json.contextQuery.sort_type === 'ByCreateTimeAsc' &&
    contextThread[0].json.contextQuery.page_size === 20 &&
    contextThread[0].json.contextUrl.includes('container_id_type=thread'),
  'thread context should use thread query and clamped page_size',
);

const contextChat = await run(contextNormalizeCode, {
  input: [
    {
      json: {
        query: JSON.stringify({
          action: 'resolve_context',
          limit: 3,
        }),
        trustedContextHintsJson: JSON.stringify({
          chatId: 'oc_recent_chat',
        }),
      },
    },
  ],
});
assert(
  contextChat[0].json.contextType === 'recent_chat',
  'conversation normalize should fallback to recent chat context',
);
assert(
  contextChat[0].json.contextQuery.container_id_type === 'chat' &&
    contextChat[0].json.contextQuery.container_id === 'oc_recent_chat' &&
    contextChat[0].json.contextQuery.sort_type === 'ByCreateTimeDesc' &&
    contextChat[0].json.contextQuery.page_size === 3 &&
    contextChat[0].json.contextUrl.includes('container_id_type=chat'),
  'recent chat context should use chat query and descending sort',
);

const contextNoIdentifiers = await run(contextNormalizeCode, {
  input: [
    {
      json: {
        query: JSON.stringify({
          action: 'resolve_context',
          limit: 5,
        }),
        trustedContextHintsJson: '{}',
      },
    },
  ],
});
const contextMissingIdentifiers = await run(codeOf(conversationContext, 'Format context result'), {
  input: [{ json: {} }],
  nodes: { Normalize: contextNoIdentifiers },
});
const contextMissingOutput = String(contextMissingIdentifiers[0].json.output || '');
assert(
  contextMissingIdentifiers[0].json.error.code === 'MISSING_CONTEXT_IDENTIFIERS' &&
    /referencedMessageId/i.test(contextMissingOutput) &&
    /threadId/i.test(contextMissingOutput) &&
    /chatId/i.test(contextMissingOutput),
  'missing context identifiers should return a clear format error',
);

const forgedContext = await run(contextNormalizeCode, {
  input: [
    {
      json: {
        query: JSON.stringify({
          action: 'resolve_context',
          chatId: 'oc_external',
        }),
        trustedContextHintsJson: JSON.stringify({
          chatId: 'oc_current',
        }),
      },
    },
  ],
});
assert(
  forgedContext[0].json.error.code === 'DIRECT_CONTEXT_ID_FORBIDDEN' &&
    forgedContext[0].json.contextUrl === '',
  'conversation normalize should reject AI-supplied context ids',
);
const formattedForgedContext = await run(
  codeOf(conversationContext, 'Format unsupported action'),
  {
    input: forgedContext,
  },
);
assert(
  formattedForgedContext[0].json.error.code === 'DIRECT_CONTEXT_ID_FORBIDDEN',
  'conversation context should return a stable error for AI-supplied context ids',
);

const okrWriteNodeNames = okrWrite.nodes.map((node) => node.name);
assert(
  okrWriteNodeNames.includes('Get OKR for proposal') &&
    okrWriteNodeNames.includes('Get OKR for drift check') &&
    okrWriteNodeNames.includes('Patch OKR target'),
  'okr_write_tools should keep unified proposal/drift/patch HTTP nodes',
);
assert(
  !okrWrite.nodes.some(
    (node) =>
      node.type === 'n8n-nodes-base.httpRequest' &&
      /(objective|key[_ ]?result)/i.test(node.name),
  ),
  'okr_write_tools should not keep legacy target-split HTTP nodes',
);

const writeNormalizeCode = codeOf(okrWrite, 'Normalize');
const writeTrustedInput = {
  trustedSenderOpenId: 'ou_1',
  trustedMessageId: 'om_update',
  trustedMessageText: '把 KR kr_1 分数改成 80%',
  trustedChatId: 'oc_current',
  trustedSessionKey: 'oar:chat:oc_current:user:ou_1',
};
const writeNormalize = await run(writeNormalizeCode, {
  input: [
    {
      json: {
        ...writeTrustedInput,
        query: JSON.stringify({
          action: 'propose_okr_update',
          targetType: 'key_result',
          targetId: 'kr_1',
          patch: { score: '80%' },
        }),
      },
    },
  ],
});
assert(
  writeNormalize[0].json.action === 'propose_okr_update',
  'okr write normalize should detect proposal action',
);

const validateProposal = await run(codeOf(okrWrite, 'Validate update proposal'), {
  input: [{ json: writeNormalize[0].json }],
  nodes: { Normalize: writeNormalize },
});
assert(validateProposal[0].json.ok === true, 'valid OKR update proposal should pass');
assert(
  validateProposal[0].json.patchBody.score === 0.8,
  'score should normalize 80% to 0.8',
);
assert(
  validateProposal[0].json.okrHttpMethod === 'GET' &&
    validateProposal[0].json.okrHttpUrl ===
      'https://open.feishu.cn/open-apis/okr/v2/key_results/kr_1',
  'KR proposal validation should output key_result GET URL',
);

const objectiveNormalize = await run(writeNormalizeCode, {
  input: [
    {
      json: {
        ...writeTrustedInput,
        query: JSON.stringify({
          action: 'propose_okr_update',
          targetType: 'objective',
          targetId: 'obj_1',
          patch: { contentText: '更新 Objective 文案' },
        }),
      },
    },
  ],
});
const objectiveValidateProposal = await run(codeOf(okrWrite, 'Validate update proposal'), {
  input: [{ json: objectiveNormalize[0].json }],
  nodes: { Normalize: objectiveNormalize },
});
assert(
  objectiveValidateProposal[0].json.okrHttpMethod === 'GET' &&
    objectiveValidateProposal[0].json.okrHttpUrl ===
      'https://open.feishu.cn/open-apis/okr/v2/objectives/obj_1',
  'objective proposal validation should output objective GET URL',
);

const forbiddenProposalNormalize = await run(writeNormalizeCode, {
  input: [
    {
      json: {
        ...writeTrustedInput,
        query: JSON.stringify({
          action: 'propose_okr_update',
          targetType: 'objective',
          targetId: 'obj_1',
          patch: { weight: 0.5 },
        }),
      },
    },
  ],
});
const forbiddenProposal = await run(codeOf(okrWrite, 'Validate update proposal'), {
  input: [{ json: forbiddenProposalNormalize[0].json }],
  nodes: { Normalize: forbiddenProposalNormalize },
});
assert(
  forbiddenProposal[0].json.error.code === 'FORBIDDEN_OKR_FIELD',
  'forbidden OKR fields should be rejected',
);
const formattedForbiddenProposal = await run(codeOf(okrWrite, 'Format proposal result'), {
  input: forbiddenProposal,
  strictNodeExecution: true,
});
assert(
  formattedForbiddenProposal[0].json.error.code === 'FORBIDDEN_OKR_FIELD',
  'proposal validation failures should not read an unexecuted build node',
);

const fuzzyDeadlineNormalize = await run(writeNormalizeCode, {
  input: [
    {
      json: {
        ...writeTrustedInput,
        query: JSON.stringify({
          action: 'propose_okr_update',
          targetType: 'objective',
          targetId: 'obj_1',
          patch: { deadline: '下周五' },
        }),
      },
    },
  ],
});
const fuzzyDeadline = await run(codeOf(okrWrite, 'Validate update proposal'), {
  input: [{ json: fuzzyDeadlineNormalize[0].json }],
  nodes: { Normalize: fuzzyDeadlineNormalize },
});
assert(
  fuzzyDeadline[0].json.error.code === 'DEADLINE_REQUIRES_YYYY_MM_DD',
  'fuzzy deadlines should be rejected',
);

const proposalBuilt = await run(codeOf(okrWrite, 'Build update proposal'), {
  input: [
    {
      json: {
        key_result: {
          id: 'kr_1',
          owner: { user_id: 'ou_1' },
          objective_id: 'obj_1',
          content: {
            blocks: [
              {
                block_element_type: 'paragraph',
                paragraph: {
                  elements: [
                    {
                      paragraph_element_type: 'textRun',
                      text_run: { text: '老 KR' },
                    },
                  ],
                },
              },
            ],
          },
          score: 0.4,
          deadline: '1780243199000',
          update_time: '111',
        },
      },
    },
  ],
  nodes: { 'Validate update proposal': validateProposal },
});
assert(proposalBuilt[0].json.ok === true, 'proposal should build for owned KR');
assert(
  proposalBuilt[0].json.output.includes('确认 ' + proposalBuilt[0].json.proposalId),
  'proposal output should include exact confirmation command',
);

const otherOwnerProposal = await run(codeOf(okrWrite, 'Build update proposal'), {
  input: [
    {
      json: {
        key_result: {
          id: 'kr_1',
          owner: { user_id: 'ou_2' },
          objective_id: 'obj_1',
          content: { blocks: [] },
          score: 0.4,
          update_time: '111',
        },
      },
    },
  ],
  nodes: { 'Validate update proposal': validateProposal },
});
assert(
  otherOwnerProposal[0].json.error.code === 'WRITE_TARGET_NOT_OWNED',
  'write proposal should reject non-owned OKR targets',
);

const proposalId = proposalBuilt[0].json.proposalId;
const executeNormalize = await run(writeNormalizeCode, {
  input: [
    {
      json: {
        ...writeTrustedInput,
        trustedMessageId: 'om_confirm',
        trustedMessageText: '确认 ' + proposalId,
        query: JSON.stringify({
          action: 'execute_okr_update',
          proposalId,
          patch: { score: 1 },
        }),
      },
    },
  ],
});
assert(
  executeNormalize[0].json.action === 'execute_okr_update',
  'okr write normalize should detect execute action',
);

const proposalRow = {
  proposalId,
  requesterOpenId: 'ou_1',
  chatId: 'oc_current',
  sessionKey: 'oar:chat:oc_current:user:ou_1',
  sourceMessageId: 'om_update',
  targetType: 'key_result',
  targetId: 'kr_1',
  patchBodyJson: proposalBuilt[0].json.patchBodyJson,
  beforeSnapshotJson: proposalBuilt[0].json.beforeSnapshotJson,
  summaryText: proposalBuilt[0].json.summaryText,
  proposalStatus: 'pending',
  createdAtMs: Date.now() - 1000,
  expiresAtMs: Date.now() + 600000,
};
const verifiedExecute = await run(codeOf(okrWrite, 'Verify update proposal'), {
  input: [{ json: proposalRow }],
  nodes: { Normalize: executeNormalize },
});
assert(verifiedExecute[0].json.ok === true, 'exact confirmation should verify');
assert(
  verifiedExecute[0].json.patchBody.score === 0.8,
  'execute should use stored patch body, not execute payload',
);
assert(
  verifiedExecute[0].json.okrHttpMethod === 'GET' &&
    verifiedExecute[0].json.okrHttpUrl ===
      'https://open.feishu.cn/open-apis/okr/v2/key_results/kr_1',
  'verify update proposal should output drift-check GET URL',
);

const sameMessageNormalize = await run(writeNormalizeCode, {
  input: [
    {
      json: {
        ...writeTrustedInput,
        trustedMessageText: '确认 ' + proposalId,
        query: JSON.stringify({ action: 'execute_okr_update', proposalId }),
      },
    },
  ],
});
const sameMessage = await run(codeOf(okrWrite, 'Verify update proposal'), {
  input: [{ json: proposalRow }],
  nodes: { Normalize: sameMessageNormalize },
});
assert(
  sameMessage[0].json.error.code === 'SAME_MESSAGE_CONFIRM_FORBIDDEN',
  'same message should not be able to create and confirm a proposal',
);

const driftClear = await run(codeOf(okrWrite, 'Check OKR drift'), {
  input: [
    {
      json: {
        key_result: {
          id: 'kr_1',
          owner: { user_id: 'ou_1' },
          content: {
            blocks: [
              {
                block_element_type: 'paragraph',
                paragraph: {
                  elements: [
                    {
                      paragraph_element_type: 'textRun',
                      text_run: { text: '老 KR' },
                    },
                  ],
                },
              },
            ],
          },
          score: 0.4,
          deadline: '1780243199000',
          update_time: '111',
        },
      },
    },
  ],
  nodes: { 'Verify update proposal': verifiedExecute },
});
assert(driftClear[0].json.ok === true, 'unchanged OKR should pass drift check');
assert(
  driftClear[0].json.okrHttpMethod === 'PATCH' &&
    driftClear[0].json.okrHttpUrl ===
      'https://open.feishu.cn/open-apis/okr/v2/key_results/kr_1',
  'drift check should output patch PATCH URL',
);

const driftDetected = await run(codeOf(okrWrite, 'Check OKR drift'), {
  input: [
    {
      json: {
        key_result: {
          id: 'kr_1',
          owner: { user_id: 'ou_1' },
          content: {
            blocks: [
              {
                block_element_type: 'paragraph',
                paragraph: {
                  elements: [
                    {
                      paragraph_element_type: 'textRun',
                      text_run: { text: '别人已修改' },
                    },
                  ],
                },
              },
            ],
          },
          score: 0.4,
          deadline: '1780243199000',
          update_time: '222',
        },
      },
    },
  ],
  nodes: { 'Verify update proposal': verifiedExecute },
});
assert(
  driftDetected[0].json.error.code === 'OKR_DRIFT_DETECTED',
  'changed OKR should fail drift check',
);
const formattedDriftFailure = await run(codeOf(okrWrite, 'Format execute result'), {
  input: driftDetected,
  strictNodeExecution: true,
});
assert(
  formattedDriftFailure[0].json.error.code === 'OKR_DRIFT_DETECTED',
  'drift failures should not read an unexecuted patch result node',
);

const patchFormatted = await run(codeOf(okrWrite, 'Format patch result'), {
  input: [{ json: { key_result: { id: 'kr_1', score: 0.8 } } }],
  nodes: { 'Check OKR drift': driftClear },
});
assert(patchFormatted[0].json.ok === true, 'successful patch response should format');
assert(
  patchFormatted[0].json.proposalStatus === 'executed',
  'successful patch should mark proposal executed',
);

const prepareCode = codeOf(oar, 'Prepare incoming message');
assert(
  !prepareCode.includes('ask_bot'),
  'Prepare incoming message should not keep legacy ask_bot intent',
);

function prepareOutput(result, label) {
  const output = result[0]?.json;
  assert(output, label + ' should produce a routed message');
  assert(typeof output.message === 'string' && output.message, label + ' should expose message text');
  assert(typeof output.intentHint === 'string' && output.intentHint, label + ' should expose intentHint');
  assert(
    ['high', 'medium', 'low'].includes(output.intentConfidence),
    label + ' should expose intentConfidence as high/medium/low',
  );
  assert(
    output.signals && typeof output.signals === 'object' && !Array.isArray(output.signals),
    label + ' should expose semantic signals',
  );
  assert(
    output.entities && typeof output.entities === 'object' && !Array.isArray(output.entities),
    label + ' should expose semantic entities',
  );
  assert(output.entities.sender?.openId, label + ' should expose sender entity');
  assert(output.entities.chat?.chatId, label + ' should expose chat entity');
  assert(output.entities.message?.messageId, label + ' should expose message entity');
  assert(
    output.entities.message?.contextHints && typeof output.entities.message.contextHints === 'object',
    label + ' should expose context hints inside entities',
  );
  for (const legacyField of [
    'intent',
    'text',
    'contextHints',
    'chatId',
    'chatType',
    'messageId',
    'senderOpenId',
    'sessionKey',
    'targetUserId',
    'targetUserIdType',
    'targetDisplayName',
    'targetSource',
    'mentionedUsers',
    'allowedChatId',
    'chatDisplayName',
  ]) {
    assert(
      output[legacyField] === undefined,
      label + ' should not expose legacy top-level field ' + legacyField,
    );
  }
  return output;
}

function assertSemanticIntent(output, expected, label) {
  assert(output.intentHint === expected, label + ' should hint ' + expected);
}

function hasTruthySignal(output, pattern) {
  return Object.entries(output.signals || {}).some(([key, value]) => pattern.test(key) && value === true);
}

const analyzeIntent = await run(prepareCode, {
  input: [larkTextEvent('分析我的 OKR 风险')],
});
const analyzeSemantic = prepareOutput(analyzeIntent, 'OKR analysis message');
assert(
  analyzeSemantic.signals.okrDomain === true,
  'OKR analysis message should expose okrDomain signal',
);
assert(
  analyzeSemantic.signals.wantsOkrAnalysis === true || analyzeSemantic.intentHint === 'analyze_okr',
  'OKR analysis message should expose analysis semantics',
);

const dispatchIntent = await run(prepareCode, {
  input: [larkTextEvent('请让 research_bot 机器人整理背景', 'om_2')],
});
const dispatchSemantic = prepareOutput(dispatchIntent, 'bot dispatch message');
assert(
  dispatchSemantic.signals.wantsBotDispatch === true || dispatchSemantic.intentHint === 'dispatch_bot_task',
  'bot dispatch message should expose dispatch semantics',
);

const dispatchDialogIntent = await run(prepareCode, {
  input: [larkTextEvent('问 research_bot 机器人', 'om_ask_bot')],
});
const dispatchDialogSemantic = prepareOutput(dispatchDialogIntent, 'bot dialog dispatch message');
assert(
  dispatchDialogSemantic.intentHint === 'dispatch_bot_task' &&
    dispatchDialogSemantic.signals.wantsBotDialog === true,
  'bot dialog message should route to dispatch_bot_task with wantsBotDialog',
);

const taskReadIntent = await run(prepareCode, {
  input: [larkTextEvent('查看我的待办任务', 'om_task')],
});
const taskReadSemantic = prepareOutput(taskReadIntent, 'task read message');
assert(
  taskReadSemantic.intentHint === 'list_my_tasks' || taskReadSemantic.signals.wantsTaskRead === true,
  'task read message should route or signal list_my_tasks',
);

const unfinishedTaskReadIntent = await run(prepareCode, {
  input: [larkTextEvent('看看我有哪些未完成待办', 'om_task_unfinished')],
});
const unfinishedTaskReadSemantic = prepareOutput(unfinishedTaskReadIntent, 'unfinished task read message');
assert(
  unfinishedTaskReadSemantic.intentHint === 'list_my_tasks' ||
    unfinishedTaskReadSemantic.signals.wantsTaskRead === true,
  'unfinished task read message should expose task read semantics',
);

const okrReadWithMyText = await run(prepareCode, {
  input: [larkTextEvent('读取下我的okr看看', 'om_okr_read')],
});
const okrReadWithMyTextSemantic = prepareOutput(okrReadWithMyText, 'explicit OKR read message');
assert(
  okrReadWithMyTextSemantic.signals.okrDomain === true,
  'explicit OKR read message should expose okrDomain signal',
);
assert(
  okrReadWithMyTextSemantic.signals.wantsTaskRead === false,
  'explicit OKR read message should not trigger task read signal',
);
assertSemanticIntent(okrReadWithMyTextSemantic, 'read_okr', 'explicit OKR read message');

const contextualOkrAnalysisIntent = await run(prepareCode, {
  input: [larkTextEvent('刚才那条帮我分析下 OKR 风险', 'om_context_okr')],
});
const contextualOkrAnalysisSemantic = prepareOutput(
  contextualOkrAnalysisIntent,
  'contextual OKR analysis message',
);
assert(
  hasTruthySignal(contextualOkrAnalysisSemantic, /context|reference|recent|previous|引用|上下文/i),
  'contextual OKR analysis message should expose a context-language signal',
);
assert(
  contextualOkrAnalysisSemantic.signals.okrDomain === true,
  'contextual OKR analysis message should expose okrDomain signal',
);
assert(
  contextualOkrAnalysisSemantic.signals.wantsOkrAnalysis === true ||
    contextualOkrAnalysisSemantic.intentHint === 'analyze_okr',
  'contextual OKR analysis message should expose OKR analysis semantics',
);

const contactEvent = larkTextEvent('查看张三的通讯录资料', 'om_contact');
contactEvent.json.event.message.mentions = [
  { id: { open_id: 'ou_2' }, name: '张三' },
];
const contactIntent = await run(prepareCode, {
  input: [contactEvent],
});
const contactSemantic = prepareOutput(contactIntent, 'contact read message');
assert(
  contactSemantic.signals.wantsContactRead === true || contactSemantic.intentHint === 'get_mentioned_users',
  'contact read message should expose contact read semantics',
);
assert(
  contactSemantic.entities.mentions[0].openId === 'ou_2',
  'prepare should expose mentioned users for contact read guards',
);

const proposeWriteIntent = await run(prepareCode, {
  input: [larkTextEvent('把我的 OKR 分数改成 80%', 'om_4')],
});
const proposeWriteSemantic = prepareOutput(proposeWriteIntent, 'OKR write proposal message');
assert(
  proposeWriteSemantic.signals.wantsOkrWrite === true || proposeWriteSemantic.intentHint === 'propose_okr_update',
  'OKR write proposal message should expose write proposal semantics',
);

const executeWriteIntent = await run(prepareCode, {
  input: [larkTextEvent('确认 ' + proposalId, 'om_5')],
});
const executeWriteSemantic = prepareOutput(executeWriteIntent, 'OKR write confirmation message');
assert(
  executeWriteSemantic.intentHint === 'execute_okr_update' ||
    executeWriteSemantic.signals.wantsOkrWriteConfirm === true,
  'OKR write confirmation message should hint execute_okr_update',
);

const directChatGroup = await run(prepareCode, {
  input: [larkTextEvent('查看团队 OKR oc_external', 'om_3')],
});
const directChatGroupSemantic = prepareOutput(directChatGroup, 'private group OKR read message');
assert(
  directChatGroupSemantic.signals.wantsGroupOkrRead === true ||
    directChatGroupSemantic.intentHint === 'read_group_okrs',
  'private group OKR read message should expose group OKR semantics',
);
assert(
  directChatGroupSemantic.entities.chat.allowedChatId === '',
  'private chat should not authorize text-provided chat IDs',
);

console.log(
  JSON.stringify(
    {
      read_okr: {
        version: readJson.version,
        objectives: readJson.data.counts.objectives,
        keyResults: readJson.data.counts.keyResults,
      },
      analyze_okr: {
        riskTypes: analysis[0].json.data.risks.map((risk) => risk.type),
      },
      summarize_group_okrs: {
        partial: summary[0].json.data.partial,
        failedTargets: summary[0].json.data.counts.failedTargets,
      },
      bot_task_tools: {
        unknownBot: unknownBot[0].json.error.code,
        directDestination: directUrl[0].json.error.code,
        directDestinationAlias: directAlias[0].json.error.code,
        oversizedPromptTruncated: oversizedPrompt[0].json.meta.truncated,
      },
      list_chat_members: {
        directChatId: rejectedChatId[0].json.error.code,
        allowedChatId: allowedChatId[0].json.chatId,
        forgedAllowedChatId: forgedAllowedChatId[0].json.chatAuthorizationError,
      },
      okr_write_tools: {
        proposalAction: writeNormalize[0].json.action,
        score: validateProposal[0].json.patchBody.score,
        krProposalUrl: validateProposal[0].json.okrHttpUrl,
        objectiveProposalUrl: objectiveValidateProposal[0].json.okrHttpUrl,
        forbidden: forbiddenProposal[0].json.error.code,
        fuzzyDeadline: fuzzyDeadline[0].json.error.code,
        proposalId,
        exactConfirm: verifiedExecute[0].json.ok,
        driftGetUrl: verifiedExecute[0].json.okrHttpUrl,
        sameMessage: sameMessage[0].json.error.code,
        drift: driftDetected[0].json.error.code,
        patchUrl: driftClear[0].json.okrHttpUrl,
        patchStatus: patchFormatted[0].json.proposalStatus,
      },
      conversation_context_tools: {
        contextHttpNode: contextHttpNodes[0].name,
        referenceType: contextAllHints[0].json.contextType,
        referenceUrl: contextAllHints[0].json.contextUrl,
        threadType: contextThread[0].json.contextType,
        threadUrl: contextThread[0].json.contextUrl,
        chatType: contextChat[0].json.contextType,
        chatUrl: contextChat[0].json.contextUrl,
        missingContextError: contextMissingIdentifiers[0].json.error.code,
        forgedContextError: formattedForgedContext[0].json.error.code,
      },
      lark_read_tools: {
        taskListType: listMyTasks[0].json.taskListParams.type,
        completedFilter: listMyTasks[0].json.taskListParams.completed,
        forgedTaskOwner: forgedTaskOwner[0].json.error.code,
        mentionedContact: mentionedContact[0].json.contactUserIds[0],
        forgedContact: forgedContact[0].json.error.code,
      },
      semantic_routing: {
        analyze: {
          intentHint: analyzeSemantic.intentHint,
          okrDomain: analyzeSemantic.signals.okrDomain,
          wantsOkrAnalysis: analyzeSemantic.signals.wantsOkrAnalysis,
        },
        dispatch: {
          intentHint: dispatchSemantic.intentHint,
          wantsBotDispatch: dispatchSemantic.signals.wantsBotDispatch,
        },
        dispatchDialog: {
          intentHint: dispatchDialogSemantic.intentHint,
          wantsBotDialog: dispatchDialogSemantic.signals.wantsBotDialog,
        },
        taskRead: {
          intentHint: taskReadSemantic.intentHint,
          wantsTaskRead: taskReadSemantic.signals.wantsTaskRead,
        },
        unfinishedTaskRead: {
          intentHint: unfinishedTaskReadSemantic.intentHint,
          wantsTaskRead: unfinishedTaskReadSemantic.signals.wantsTaskRead,
        },
        explicitOkrRead: {
          intentHint: okrReadWithMyTextSemantic.intentHint,
          okrDomain: okrReadWithMyTextSemantic.signals.okrDomain,
          wantsTaskRead: okrReadWithMyTextSemantic.signals.wantsTaskRead,
        },
        contextualOkrAnalysis: {
          intentHint: contextualOkrAnalysisSemantic.intentHint,
          okrDomain: contextualOkrAnalysisSemantic.signals.okrDomain,
        },
        contactRead: {
          intentHint: contactSemantic.intentHint,
          wantsContactRead: contactSemantic.signals.wantsContactRead,
        },
        proposeWrite: {
          intentHint: proposeWriteSemantic.intentHint,
          wantsOkrWrite: proposeWriteSemantic.signals.wantsOkrWrite,
        },
        executeWrite: {
          intentHint: executeWriteSemantic.intentHint,
        },
        privateChatAllowedChatId: directChatGroupSemantic.entities.chat.allowedChatId,
      },
    },
    null,
    2,
  ),
);
