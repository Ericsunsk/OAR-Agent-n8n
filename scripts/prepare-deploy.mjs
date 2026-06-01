import fs from 'node:fs';
import path from 'node:path';

const workflowFiles = [
  'OAR.json',
  'OAR_okr_tools.json',
  'OAR_conversation_context_tools.json',
  'OAR_bot_task_tools.json',
  'OAR_okr_write_tools.json',
];
const writableWorkflowFields = [
  'name',
  'nodes',
  'connections',
  'settings',
  'pinData',
  'description',
];
const deployDir = '.deploy';

fs.mkdirSync(deployDir, { recursive: true });

for (const file of workflowFiles) {
  if (!fs.existsSync(file)) continue;

  const workflow = JSON.parse(fs.readFileSync(file, 'utf8'));
  const deployWorkflow = {};

  for (const field of writableWorkflowFields) {
    if (workflow[field] !== undefined && workflow[field] !== null) {
      deployWorkflow[field] = workflow[field];
    }
  }

  deployWorkflow.settings ||= { executionOrder: 'v1' };
  delete deployWorkflow.settings.binaryMode;

  for (const node of deployWorkflow.nodes || []) {
    delete node.rewireOutputLogTo;
    delete node.webhookId;
  }

  fs.writeFileSync(
    path.join(deployDir, file),
    `${JSON.stringify(deployWorkflow, null, 2)}\n`,
  );
}

console.log(`Prepared ${workflowFiles.length} workflow payloads in ${deployDir}/`);
