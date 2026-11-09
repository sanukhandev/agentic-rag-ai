import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ALLOWED_WORKFLOW_IDS = Object.freeze([
  'ancfzV2LeadCreateR1',
  'ancfzV2PackageQuoteR1',
  'ANCDocumentOCRWF1',
]);

export async function activateDevWorkflows({ executor, workflowIds = ALLOWED_WORKFLOW_IDS }) {
  const invalid = workflowIds.filter((id) => !ALLOWED_WORKFLOW_IDS.includes(id));
  if (invalid.length) throw new Error(`N8N_DEV_ACTIVATION_WORKFLOW_NOT_ALLOWED: ${invalid.join(',')}`);
  for (const id of workflowIds) await executor(id);
  return { activated: [...workflowIds] };
}

export function publishCommand(id) {
  return ['exec', 'n8n', 'n8n', 'publish:workflow', `--id=${id}`];
}

function publish(id) {
  const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
  const result = spawnSync(docker, publishCommand(id), { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`N8N_DEV_ACTIVATION_FAILED: ${id}`);
}

function activeWorkflowIds() {
  const sqlite = process.env.SQLITE3_PATH ?? (process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3');
  const database = new URL('../data/n8n/database.sqlite', import.meta.url);
  const result = spawnSync(sqlite, [fileURLToPath(database), 'SELECT id FROM workflow_entity WHERE active = 1;'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('N8N_DEV_ACTIVATION_RUNTIME_UNREADABLE');
  return result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--confirm-dev') || process.env.NODE_ENV === 'production') {
    console.error('N8N_DEV_ACTIVATION_REQUIRES_CONFIRM_DEV');
    process.exitCode = 1;
  } else {
    try {
      const active = new Set(activeWorkflowIds());
      const result = await activateDevWorkflows({ executor: publish, workflowIds: ALLOWED_WORKFLOW_IDS.filter((id) => !active.has(id)) });
      console.log(`n8n dev workflows published: ${result.activated.join(', ')}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
