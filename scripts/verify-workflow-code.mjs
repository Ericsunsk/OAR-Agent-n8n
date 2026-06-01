import fs from 'node:fs';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function readWorkflow(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function codeOf(workflow, name) {
  return workflow.nodes.find((node) => node.name === name).parameters.jsCode;
}

async function run(code, { input = [], nodes = {}, helpers = {} } = {}) {
  const fn = new AsyncFunction('$input', '$', '$helpers', code);
  const $input = { all: () => input, first: () => input[0] };
  const $ = (name) => ({ all: () => nodes[name] || [] });
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
  okrTool.parameters.workflowInputs.value.allowedChatId.includes('Prepare incoming message'),
  'okr_tools allowedChatId should be bound from the current event',
);

const prepareCode = codeOf(oar, 'Prepare incoming message');
const analyzeIntent = await run(prepareCode, {
  input: [larkTextEvent('分析我的 OKR 风险')],
});
assert(
  analyzeIntent[0].json.intent === 'analyze_okr',
  'prepare should detect analyze_okr intent',
);

const dispatchIntent = await run(prepareCode, {
  input: [larkTextEvent('请让 research_bot 机器人整理背景', 'om_2')],
});
assert(
  dispatchIntent[0].json.intent === 'dispatch_bot_task',
  'prepare should detect dispatch_bot_task intent',
);

const directChatGroup = await run(prepareCode, {
  input: [larkTextEvent('查看团队 OKR oc_external', 'om_3')],
});
assert(
  directChatGroup[0].json.intent === 'read_group_okrs',
  'prepare should detect group summary intent',
);
assert(
  directChatGroup[0].json.allowedChatId === '',
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
      intents: {
        analyze: analyzeIntent[0].json.intent,
        dispatch: dispatchIntent[0].json.intent,
        privateChatAllowedChatId: directChatGroup[0].json.allowedChatId,
      },
    },
    null,
    2,
  ),
);
