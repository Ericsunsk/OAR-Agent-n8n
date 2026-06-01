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
const okrWrite = readWorkflow('OAR_okr_write_tools.json');

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

const okrWriteTool = oar.nodes.find((node) => node.name === 'okr_write_tools');
assert(okrWriteTool, 'okr_write_tools should be connected to the main agent');
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
    okrWriteTool.parameters.workflowInputs.value[field].includes('Prepare incoming message'),
    `okr_write_tools ${field} should be bound from the current event`,
  );
}

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

const proposeWriteIntent = await run(prepareCode, {
  input: [larkTextEvent('把我的 OKR 分数改成 80%', 'om_4')],
});
assert(
  proposeWriteIntent[0].json.intent === 'propose_okr_update',
  'prepare should detect propose_okr_update intent',
);

const executeWriteIntent = await run(prepareCode, {
  input: [larkTextEvent('确认 ' + proposalId, 'om_5')],
});
assert(
  executeWriteIntent[0].json.intent === 'execute_okr_update',
  'prepare should detect execute_okr_update intent',
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
      okr_write_tools: {
        proposalAction: writeNormalize[0].json.action,
        score: validateProposal[0].json.patchBody.score,
        forbidden: forbiddenProposal[0].json.error.code,
        fuzzyDeadline: fuzzyDeadline[0].json.error.code,
        proposalId,
        exactConfirm: verifiedExecute[0].json.ok,
        sameMessage: sameMessage[0].json.error.code,
        drift: driftDetected[0].json.error.code,
        patchStatus: patchFormatted[0].json.proposalStatus,
      },
      intents: {
        analyze: analyzeIntent[0].json.intent,
        dispatch: dispatchIntent[0].json.intent,
        proposeWrite: proposeWriteIntent[0].json.intent,
        executeWrite: executeWriteIntent[0].json.intent,
        privateChatAllowedChatId: directChatGroup[0].json.allowedChatId,
      },
    },
    null,
    2,
  ),
);
