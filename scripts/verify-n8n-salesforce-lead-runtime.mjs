import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class N8nSalesforceReadinessError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'N8nSalesforceReadinessError';
    this.code = code;
  }
}

const requiredFlags = ['createUrl', 'readbackUrl', 'oauthClient', 'internalWebhookSecret'];

export function verifyRuntime({ workflowId, expectedPath, expectedContract, runtimeList, envPresence }) {
  const workflow = (runtimeList ?? []).find((item) => item?.id === workflowId);
  if (!workflow) throw new N8nSalesforceReadinessError('N8N_SALESFORCE_READINESS_WORKFLOW_MISSING', 'required workflow is not active');
  if (workflow.active !== true) throw new N8nSalesforceReadinessError('N8N_SALESFORCE_READINESS_WORKFLOW_INACTIVE', 'required workflow is inactive');
  if (workflow.webhookPath !== expectedPath) throw new N8nSalesforceReadinessError('N8N_SALESFORCE_READINESS_PATH_MISMATCH', 'webhook path does not match the catalog binding');
  if (workflow.payloadContract !== expectedContract) throw new N8nSalesforceReadinessError('N8N_SALESFORCE_READINESS_CONTRACT_MISMATCH', 'payload contract does not match the Node binding');
  const missing = requiredFlags.filter((key) => envPresence?.[key] !== true);
  if (missing.length) throw new N8nSalesforceReadinessError('N8N_SALESFORCE_READINESS_MISSING_SECRET', `required runtime configuration is missing: ${missing.join(',')}`);
  return { ok: true, workflowId, path: expectedPath, contract: expectedContract };
}

function activeWorkflowIds() {
  const sqlite = process.env.SQLITE3_PATH ?? (process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3');
  const database = resolve(fileURLToPath(new URL('..', import.meta.url)), 'data/n8n/database.sqlite');
  const result = spawnSync(sqlite, [database, "SELECT id FROM workflow_entity WHERE active = 1;"], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Unable to inspect active n8n workflows.');
  return result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

function runtimeCredentialNames() {
  const sqlite = process.env.SQLITE3_PATH ?? (process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3');
  const database = resolve(fileURLToPath(new URL('..', import.meta.url)), 'data/n8n/database.sqlite');
  const result = spawnSync(sqlite, [database, "SELECT name FROM credentials_entity;"], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Unable to inspect n8n credential bindings.');
  return result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

function sourceMetadata() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const workflow = JSON.parse(readFileSync(resolve(root, 'infra/n8n/workflows/ancfz-v2/01-lead-create.json'), 'utf8'));
  const webhook = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.webhook');
  const validator = workflow.nodes.find((node) => node.name === 'Validate Dispatch Envelope');
  const contract = String(validator?.parameters?.jsCode ?? '').match(/input\.contract !== ["']([^"']+)["']/)?.[1];
  return { path: webhook?.parameters?.path, contract };
}

function runtimeEnvPresence() {
  const values = { ...process.env };
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  try {
    for (const line of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && values[match[1]] === undefined) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* .env is optional; container/CI variables remain authoritative. */ }
  return {
    createUrl: Boolean(values.REMOTE_CRM_LEAD_URL),
    readbackUrl: Boolean(values.REMOTE_CRM_LEAD_READ_URL?.includes('{leadId}')),
    oauthClient: Boolean(values.REMOTE_CRM_TOKEN_URL && values.REMOTE_CRM_CLIENT_ID && values.REMOTE_CRM_CLIENT_SECRET),
    internalWebhookSecret: Boolean(values.N8N_WEBHOOK_SECRET),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const workflowId = 'ancfzV2LeadCreateR1';
  const metadata = sourceMetadata();
  try {
    const result = verifyRuntime({
      workflowId,
      expectedPath: 'ancfz/v2/lead-create',
      expectedContract: 'ancfz-v2-stage-action-v1',
      runtimeList: [{ id: workflowId, active: activeWorkflowIds().includes(workflowId), webhookPath: metadata.path, payloadContract: metadata.contract }],
      envPresence: { ...runtimeEnvPresence(), oauthClient: runtimeCredentialNames().includes('SalesForce ANC - CREDS') },
    });
    console.log(`n8n Salesforce readiness PASS: ${result.workflowId} ${result.path} ${result.contract}`);
  } catch (error) {
    console.error(error instanceof N8nSalesforceReadinessError ? error.message : 'N8N_SALESFORCE_READINESS_CHECK_FAILED');
    process.exitCode = 1;
  }
}
