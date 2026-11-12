#!/usr/bin/env node
/**
 * P7 real-provider diagnostic runner. No V2 workflow sends, no CRM confirmation,
 * no document uploads and no changes to protected knowledge records.
 * Only run on two dedicated synthetic canary tenants via loopback ingress.
 *
 * Examples:
 *   node scripts/p7-azure-uat.mjs --dry-run
 *   node scripts/p7-azure-uat.mjs --run
 *   node scripts/p7-azure-uat.mjs --evaluate artifacts/p7-uat/<id>/run.json \
 *     --review artifacts/p7-uat/<id>/review.json --baseline artifacts/.../v2-run.json
 */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { P7_CASES, assertSuite } from './p7-uat-cases.mjs';
import { evaluateP7, p7Markdown, reviewTemplate, sanitizePreview, hashId, validateLocalUrl, P7_SUITE_HASH } from './p7-uat-core.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const oneArg = name => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1] ?? null;
};
const outputDir = resolve(process.env.P7_REPORT_DIR ?? join(root, 'artifacts', 'p7-uat'));
const sleep = ms => new Promise(done => setTimeout(done, ms));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function checkConfig() {
  const base = validateLocalUrl(process.env.P7_API_BASE_URL ?? 'http://127.0.0.1', 'P7_API_BASE_URL');
  const origin = validateLocalUrl(process.env.P7_ORIGIN ?? 'http://localhost', 'P7_ORIGIN').origin;
  const tenants = [
    { id: process.env.P7_TENANT_ID ?? '', slug: process.env.P7_TENANT_SLUG ?? '' },
    { id: process.env.P7_SECOND_TENANT_ID ?? '', slug: process.env.P7_SECOND_TENANT_SLUG ?? '' },
  ];
  if (tenants.some(x => !UUID.test(x.id) || !/^p7[-_][a-z0-9_-]{2,50}$/u.test(x.slug))
    || tenants[0].id === tenants[1].id || tenants[0].slug === tenants[1].slug) {
    throw new Error('Two distinct UUID/slug synthetic tenants are required; slugs must start p7- or p7_');
  }
  if (process.env.P6_CANARY_TENANT_IDS
    && tenants.some(x => !process.env.P6_CANARY_TENANT_IDS.split(',').map(y => y.trim()).includes(x.id))) {
    throw new Error('P6_CANARY_TENANT_IDS must include BOTH P7 synthetic tenant IDs');
  }
  const sentinel = process.env.P7_SECOND_TENANT_SENTINEL ?? '';
  if (!/^P7-BETA-[a-zA-Z0-9-]{12,90}$/u.test(sentinel)) {
    throw new Error('P7_SECOND_TENANT_SENTINEL must be a unique synthetic test marker starting P7-BETA-');
  }
  const timeoutMs = Number(process.env.P7_TURN_TIMEOUT_MS ?? 120000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10000 || timeoutMs > 180000) {
    throw new Error('P7_TURN_TIMEOUT_MS must be 10000..180000');
  }
  const pauseMs = Number(process.env.P7_BETWEEN_TURNS_MS ?? 500);
  if (!Number.isInteger(pauseMs) || pauseMs < 0 || pauseMs > 10000) throw new Error('Invalid P7 pause');
  return { base: base.origin, origin, tenants, timeoutMs, pauseMs, sentinel };
}

/** Attest actual private container settings; no credential value is printed. */
function attestAzure() {
  const script = `import os,json\nprint(json.dumps({"mode":os.getenv("MODEL_MODE",""),"provider":os.getenv("AI_PROVIDER",""),"model":os.getenv("AI_MODEL") or os.getenv("AZURE_OPENAI_DEPLOYMENT",""),"credentialConfigured":bool(os.getenv("AI_API_KEY") or os.getenv("AZURE_OPENAI_API_KEY"))}))`;
  const stdout = execFileSync('docker', ['compose', 'exec', '-T', 'model-gateway', 'python', '-c', script],
    { cwd: root, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
  const settings = JSON.parse(stdout.trim());
  if (settings.mode === 'mock' || settings.provider !== 'azure' || !settings.model || !settings.credentialConfigured) {
    throw new Error('Model gateway does not attest to non-mock Azure configuration; no live UAT will run');
  }
  return { attested: true, provider: 'azure', mode: settings.mode, deployment: sanitizePreview(settings.model, 120) };
}

async function connectAuditDatabase() {
  const connectionString = process.env.P7_AUDIT_DATABASE_URL ?? '';
  let uri;
  try { uri = new URL(connectionString); } catch { throw new Error('P7_AUDIT_DATABASE_URL must be a PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(uri.protocol)
    || !['localhost','127.0.0.1','[::1]'].includes(uri.hostname)
    || !uri.pathname || uri.pathname === '/' || uri.search || uri.hash) {
    throw new Error('P7_AUDIT_DATABASE_URL must be a locally forwarded PostgreSQL URL');
  }
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000 });
  await pool.query('SELECT 1');
  return pool;
}

async function checkSyntheticTenants(pool, tenants, sentinel) {
  for (const tenant of tenants) {
    const row = await pool.query('SELECT id,slug,status,public_chat_enabled FROM tenants WHERE id=$1', [tenant.id]);
    if (row.rows.length !== 1 || row.rows[0].slug !== tenant.slug || row.rows[0].status !== 'active'
      || row.rows[0].public_chat_enabled !== true) {
      throw new Error(`Synthetic tenant ${tenant.slug} is absent or not active and publicly chat-enabled`);
    }
    const persona = await pool.query("SELECT 1 FROM persona_versions WHERE tenant_id=$1 AND status='published' LIMIT 1",[tenant.id]);
    const catalog = await pool.query("SELECT 1 FROM intent_catalog_v2_versions WHERE tenant_id=$1 AND status='published' LIMIT 1",[tenant.id]);
    if (!persona.rows.length || !catalog.rows.length) {
      throw new Error(`Synthetic tenant ${tenant.slug} needs a published persona and Catalog V2`);
    }
  }
  // P7 may READ a synthetic sentinel, but may never insert or modify knowledge.
  // It must exist in an approved public chunk of Beta and never in Alpha.
  const found = await pool.query(`
    SELECT c.tenant_id::text AS tenant_id, count(*)::int AS matches
      FROM source_chunks c JOIN knowledge_sources s ON s.id = c.source_id
       AND s.tenant_id = c.tenant_id AND s.version_id = c.version_id
     WHERE c.tenant_id = ANY($1::uuid[]) AND s.status='active' AND s.audience='public'
       AND POSITION($2 IN c.content) > 0
     GROUP BY c.tenant_id
  `, [tenants.map(t => t.id), sentinel]);
  if (found.rows.length !== 1 || found.rows[0].tenant_id !== tenants[1].id || found.rows[0].matches < 1) {
    throw new Error('Approved synthetic Beta-only RAG sentinel missing or visible in Alpha');
  }
}

async function fingerprint(pool, tenantId) {
  const result = await pool.query(`
    SELECT
      (SELECT md5(COALESCE(string_agg(id::text || ':' || content_hash || ':' || version_id::text
        || ':' || status || ':' || audience || ':' || md5(title), ',' ORDER BY id::text), ''))
       FROM knowledge_sources WHERE tenant_id=$1) AS source_fingerprint,
      (SELECT md5(COALESCE(string_agg(id::text || ':' || content_hash || ':' || version_id::text
        || ':' || md5(content) || ':' || md5(embedding::text) || ':' || locator, ',' ORDER BY id::text), ''))
       FROM source_chunks WHERE tenant_id=$1) AS chunk_fingerprint,
      (SELECT count(*)::int FROM action_requests WHERE tenant_id=$1) AS action_count,
      (SELECT md5(COALESCE(string_agg(id::text || ':' || state || ':' || md5(payload::text)
        || ':' || md5(COALESCE(result::text,'')), ',' ORDER BY id::text), ''))
       FROM action_requests WHERE tenant_id=$1) AS action_fingerprint,
      (SELECT count(*)::int FROM action_executions WHERE tenant_id=$1) AS execution_count,
      (SELECT md5(COALESCE(string_agg(id::text || ':' || provider_status || ':'
        || md5(COALESCE(outcome::text,'')), ',' ORDER BY id::text), ''))
       FROM action_executions WHERE tenant_id=$1) AS execution_fingerprint,
      (SELECT count(*)::int FROM event_outbox WHERE tenant_id=$1) AS outbox_count,
      (SELECT md5(COALESCE(string_agg(event_id::text || ':' || COALESCE(published_at::text,'')
        || ':' || attempts::text || ':' || md5(payload::text), ',' ORDER BY event_id::text), ''))
       FROM event_outbox WHERE tenant_id=$1) AS outbox_fingerprint,
      (SELECT count(*)::int FROM crm_leads WHERE tenant_id=$1) AS lead_count,
      (SELECT md5(COALESCE(string_agg(id::text || ':' || summary_status || ':'
        || md5(lead_data::text), ',' ORDER BY id::text), ''))
       FROM crm_leads WHERE tenant_id=$1) AS lead_fingerprint
  `, [tenantId]);
  const row = result.rows[0];
  return {
    sourceFingerprint: row.source_fingerprint, chunkFingerprint: row.chunk_fingerprint,
    actionCount: row.action_count, actionFingerprint: row.action_fingerprint,
    executionCount: row.execution_count, executionFingerprint: row.execution_fingerprint,
    outboxCount: row.outbox_count, outboxFingerprint: row.outbox_fingerprint,
    leadCount: row.lead_count, leadFingerprint: row.lead_fingerprint,
  };
}

async function auditAll(pool, tenants) {
  const values = {};
  for (const [i, tenant] of tenants.entries()) {
    values[i === 0 ? 'primary' : 'secondary'] = await fingerprint(pool, tenant.id);
  }
  return values;
}

async function httpJson(url, options, timeoutMs) {
  const response = await fetch(url, { ...options, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body: body && typeof body === 'object' ? body : {} };
}

async function openSession(config, tenant) {
  const { status, body } = await httpJson(`${config.base}/api/v1/chat/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: config.origin },
    body: JSON.stringify({ tenantSlug: tenant.slug }),
  }, config.timeoutMs);
  if (status !== 201 || !UUID.test(body.sessionId) || typeof body.sessionToken !== 'string'
    || body.sessionToken.length < 32 || body.tenantId !== tenant.id) {
    throw new Error(`P7 secure session creation failed for ${tenant.slug} (HTTP ${status}, code ${String(body.error?.code ?? 'unknown')})`);
  }
  return { id: body.sessionId, token: body.sessionToken, tenantId: body.tenantId };
}

function turnRequest(config, session, message, clientMessageId, origin = config.origin, token = session.token) {
  return httpJson(`${config.base}/api/v1/chat/candidate/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'x-agentic-session-token': token },
    body: JSON.stringify({ sessionId: session.id, clientMessageId, message }),
  }, config.timeoutMs);
}

async function runProbes(config, primary, secondary) {
  const checks = [
    { id: 'invalid_customer_token', session: primary, token: 'invalid-credential-length-xxxxxxxxxxxxxxxx', origin: config.origin, expected: 401 },
    { id: 'wrong_tenant_token_A', session: primary, token: secondary.token, origin: config.origin, expected: 401 },
    { id: 'wrong_tenant_token_B', session: secondary, token: primary.token, origin: config.origin, expected: 401 },
    { id: 'untrusted_origin', session: primary, token: primary.token, origin: 'http://attacker.invalid', expected: 403 },
  ];
  const results = [];
  for (const item of checks) {
    try {
      const result = await turnRequest(config, item.session, 'P7 credential isolation probe', `p7-probe-${randomUUID()}`,
        item.origin, item.token);
      results.push({ id: item.id, status: result.status, passed: result.status === item.expected });
    } catch { results.push({ id: item.id, status: null, passed: false }); }
  }
  return results;
}

async function runCase(config, test) {
  const result = { id: test.id, category: test.category, expectation: test.expectation,
    sessionDigest: null, status: 'failed', turns: [] };
  let session;
  try { session = await openSession(config, config.tenants[0]); }
  catch (error) { result.failure = sanitizePreview(error.message); return result; }
  result.sessionDigest = hashId(session.id);
  for (const [index, prompt] of test.turns.entries()) {
    const start = performance.now();
    try {
      const out = await turnRequest(config, session, prompt, `p7-${test.id}-${index + 1}-${randomUUID()}`);
      const latencyMs = Math.round(performance.now() - start);
      const successful = out.status === 200 && out.body.engine === 'p6-candidate'
        && typeof out.body.answer === 'string' && out.body.answer.trim().length > 0
        && Array.isArray(out.body.citations);
      const row = { index: index + 1, questionPreview: sanitizePreview(prompt),
        status: successful ? 'ok' : 'failed', httpStatus: out.status, latencyMs,
        engine: typeof out.body.engine === 'string' ? out.body.engine : null,
        grounded: out.body.grounded === true, citationCount: Array.isArray(out.body.citations) ? out.body.citations.length : null,
        answerPreview: successful ? sanitizePreview(out.body.answer.replaceAll(config.sentinel, '[P7_CROSS_TENANT_MARKER]')) : null,
        crossTenantSentinelSeen: successful ? out.body.answer.includes(config.sentinel) : false,
        errorCode: successful ? null : sanitizePreview(out.body.error?.code ?? 'P7_INVALID_RESPONSE', 100),
      };
      result.turns.push(row);
      if (!successful) return result;
    } catch (error) {
      result.turns.push({ index: index + 1, questionPreview: sanitizePreview(prompt),
        status: 'failed', httpStatus: null, latencyMs: Math.round(performance.now() - start),
        errorCode: error.name === 'TimeoutError' ? 'P7_TIMEOUT' : 'P7_TRANSPORT_ERROR' });
      return result;
    }
    if (config.pauseMs && index < test.turns.length - 1) await sleep(config.pauseMs);
  }
  result.status = 'completed';
  return result;
}

async function createReport(run, review = null, baseline = null, baselineReview = null) {
  const report = evaluateP7(run, review, baseline, baselineReview);
  const target = join(outputDir, run.runId);
  await mkdir(target, { recursive: true });
  await Promise.all([
    writeFile(join(target, 'run.json'), JSON.stringify(run, null, 2) + '\n', { mode: 0o600 }),
    writeFile(join(target, 'gate.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }),
    writeFile(join(target, 'gate.md'), p7Markdown(report), { mode: 0o600 }),
  ]);
  return { report, target };
}

async function execute() {
  const { conversations, turns } = assertSuite();
  if (args.includes('--dry-run')) {
    console.log(JSON.stringify({ mode: 'dry-run', conversations, turns,
      categories: Object.fromEntries([...new Set(P7_CASES.map(c => c.category))]
        .map(category => [category, P7_CASES.filter(c => c.category === category).length])),
      liveAzureCalls: 0, productionCutover: false }, null, 2));
    return;
  }
  if (oneArg('--evaluate')) {
    const run = JSON.parse(await readFile(resolve(oneArg('--evaluate')), 'utf8'));
    const review = oneArg('--review') ? JSON.parse(await readFile(resolve(oneArg('--review')), 'utf8')) : null;
    const baseline = oneArg('--baseline') ? JSON.parse(await readFile(resolve(oneArg('--baseline')), 'utf8')) : null;
    const baselineReview = oneArg('--baseline-review') ? JSON.parse(await readFile(resolve(oneArg('--baseline-review')), 'utf8')) : null;
    const { report, target } = await createReport(run, review, baseline, baselineReview);
    console.log(JSON.stringify({ gate: report.status, quality: report.qualityRate, target, gates: report.gates }, null, 2));
    if (report.status !== 'conversation_canary_pass') process.exitCode = 2;
    return;
  }
  if (!args.includes('--run')) throw new Error('Choose --dry-run, --run, or --evaluate <run.json>');
  if (process.env.P7_SYNTHETIC_ONLY_ACK !== 'YES') {
    throw new Error('Set P7_SYNTHETIC_ONLY_ACK=YES to confirm two isolated synthetic canary tenants');
  }
  const config = checkConfig();
  const azureAttestation = attestAzure();
  const pool = await connectAuditDatabase();
  const run = {
    schema: 'p7-canary-run-v1',
    runId: `p7-${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`,
    startedAt: new Date().toISOString(), commit: process.env.P7_COMMIT_SHA ?? 'not_supplied',
    mode: 'p6-canary', suiteHash: P7_SUITE_HASH, sentinelConfigured: true,
    target: 'local_canary_only', provider: 'azure', azureAttestation,
    tenants: config.tenants.map(t => ({ tenantDigest: hashId(t.id), slug: t.slug })),
    cases: [], securityProbes: [], databaseAudit: { before: null, after: null },
  };
  let failure = null;
  try {
    await checkSyntheticTenants(pool, config.tenants, config.sentinel);
    run.databaseAudit.before = await auditAll(pool, config.tenants);
    const a = await openSession(config, config.tenants[0]);
    const b = await openSession(config, config.tenants[1]);
    run.securityProbes = await runProbes(config, a, b);
    if (run.securityProbes.some(x => !x.passed)) {
      throw new Error('P7 security probes failed; no model traffic will start');
    }
    for (const [index, test] of P7_CASES.entries()) {
      const result = await runCase(config, test);
      run.cases.push(result);
      console.log(`P7 ${index+1}/${P7_CASES.length}: ${result.id} ${result.status}`);
      if (result.status !== 'completed') {
        failure = 'One or more candidate turns failed; further provider traffic stopped';
        break;
      }
    }
  } catch (error) { failure = sanitizePreview(error.message, 250); }
  finally {
    try { run.databaseAudit.after = await auditAll(pool, config.tenants); }
    catch (error) { failure = `${failure ?? 'Database audit failed'}; after-snapshot unavailable`; }
    await pool.end();
  }
  run.finishedAt = new Date().toISOString();
  const { report, target } = await createReport(run);
  await writeFile(join(target, 'review-template.json'), JSON.stringify(reviewTemplate({ ...run,
    cases: P7_CASES.map(c => ({ ...c, turns: c.turns.map(() => ({})) })),
  }), null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ reportDir: target, completedCases: run.cases.length,
    conversationGate: report.status, productionCutover: report.productionCutover,
    error: failure, humanReview: 'pending' }, null, 2));
  if (failure || run.cases.length !== P7_CASES.length) process.exitCode = 1;
  else process.exitCode = 2; // Human review and comparable V2 baseline remain pending.
}

await execute().catch(error => { console.error('P7 halted:', sanitizePreview(error.message, 300)); process.exitCode = 1; });
