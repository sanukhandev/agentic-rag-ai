import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockSalesforceProvider, waitForTerminalStatus } from './mock-salesforce-webhook.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const body = { workflowKey: 'wrong.workflow', contract: 'wrong-contract' };
const provider = await startMockSalesforceProvider();
try {
  const probe = "const url='http://n8n:5678/webhook/ancfz/v2/lead-create'; const body=JSON.stringify({workflowKey:'wrong.workflow',contract:'wrong-contract'}); Promise.all([fetch(url,{method:'POST',headers:{'content-type':'application/json'},body}),fetch(url,{method:'POST',headers:{'content-type':'application/json','x-agentic-internal-secret':process.env.N8N_WEBHOOK_SECRET},body})]).then(async rs=>console.log(JSON.stringify(await Promise.all(rs.map(async r=>({status:r.status,body:await r.text()})))))).catch(e=>{console.error(e.message);process.exitCode=1})";
  const probeResult = spawnSync(process.platform === 'win32' ? 'docker.exe' : 'docker', ['exec', 'agentic-event-worker', 'node', '-e', probe], { encoding: 'utf8' });
  if (probeResult.status !== 0) throw new Error('Mock webhook container probe failed.');
  const [unauthenticated, authenticated] = JSON.parse(probeResult.stdout.trim());
  const db = resolve(root, 'data/n8n/database.sqlite');
  const latest = await waitForTerminalStatus(async () => spawnSync(process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3', [db, "select status from execution_entity where workflowId='ancfzV2LeadCreateR1' order by startedAt desc limit 1;"], { encoding: 'utf8' }).stdout.trim());
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
