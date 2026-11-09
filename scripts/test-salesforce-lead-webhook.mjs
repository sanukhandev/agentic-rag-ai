import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockSalesforceProvider } from './mock-salesforce-webhook.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const env = Object.fromEntries(readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : [];
}));
const webhook = `${env.N8N_WEBHOOK_URL || 'http://localhost/n8n/'}webhook/ancfz/v2/lead-create`;
const body = { workflowKey: 'wrong.workflow', contract: 'wrong-contract' };
const provider = await startMockSalesforceProvider();
try {
  const unauthenticated = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const authenticated = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json', 'x-agentic-internal-secret': env.N8N_WEBHOOK_SECRET }, body: JSON.stringify(body) });
  const db = resolve(root, 'data/n8n/database.sqlite');
  const latest = spawnSync(process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3', [db, "select status from execution_entity where workflowId='ancfzV2LeadCreateR1' order by startedAt desc limit 1;"], { encoding: 'utf8' }).stdout.trim();
  const report = {
    generatedAt: new Date().toISOString(),
    workflowId: 'ancfzV2LeadCreateR1',
    webhookPath: 'ancfz/v2/lead-create',
    cases: {
      missingAuth: { status: unauthenticated.status, rejected: unauthenticated.status === 403 },
      invalidContract: { status: authenticated.status, n8nExecutionStatus: latest, providerCalls: provider.counts.create, rejectedBeforeProvider: provider.counts.create === 0 && latest === 'error' },
    },
    mockProvider: { createCalls: provider.counts.create, readbackCalls: provider.counts.readback, contacted: provider.counts.create + provider.counts.readback > 0 },
    redaction: { secretsIncluded: false, customerPayloadIncluded: false, rawProviderErrorIncluded: false },
  };
  mkdirSync(resolve(root, 'docs/verification'), { recursive: true });
  writeFileSync(resolve(root, 'docs/verification/salesforce-lead-webhook-mock-2026-11-09.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (!report.cases.missingAuth.rejected || !report.cases.invalidContract.rejectedBeforeProvider) process.exitCode = 1;
  console.log(JSON.stringify(report, null, 2));
} finally {
  provider.server.close();
}
