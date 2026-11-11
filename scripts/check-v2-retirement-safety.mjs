#!/usr/bin/env node
/** Offline, read-only tripwires for a deliberate, reviewed V1 retirement. */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_MIGRATIONS = `
001-schema 002-lifecycle 003-message-response 004-session-tokens 005-action-result
006-source-idempotency 007-role-expansion 008-ingestion-jobs 009-source-versions
010-auth-sessions 011-callback-nonces 012-persona-versions 013-tenant-domains
014-session-persona 015-chat-context 016-crm-leads 017-chat-activity
018-persona-voice 019-intent-catalog 020-crm-lead-dedupe 021-workflow-polling
022-channel-credentials 023-channel-credential-rotation 024-crm-remote-lead
025-supporting-documents 026-channel-api-key-auth 027-supporting-document-policy
028-conversation-state 029-crm-secondary-intents 030-event-driven-execution
031-catalog-normalization-rollout 032-event-inbox-lifecycle
033-crm-contact-completeness 034-outbox-dead-letter
035-v2-reliability-hardening 036-review-race-and-inbox-dlq
037-poll-claim-leases 038-ingestion-error-detail 039-intent-journey-requirements
040-document-journey-scope 041-supporting-document-idempotency-scope
042-azure-text-embedding-large 043-embedding-readiness
044-journey-opportunity-identity 045-document-opportunity-scope
046-document-opportunity-idempotency 047-business-lifecycle
048-crm-lead-associations 049-crm-account-remote-identity-uniqueness
050-anc-account-conversion-catalog 051-anc-sandbox-pricebook
052-anc-finance-contract-catalog 053-qualification-and-catalog-gates
054-foundry-conversation-bindings 055-catalog-v2-versions 056-user-intent-document
057-v2-business-goal-confirmation 058-v2-action-catalog-identity 059-package-v2-catalog-identity
060-anc-v2-sandbox-pricebook 061-anc-natural-formation-aliases
`.trim().split(/\s+/u).map(name => `infra/postgres/${name}.sql`);

export const PROTECTED_V2_SOURCES = [
  'services/api/src/index.ts',
  'services/api/src/app.ts',
  'services/api/src/conversation/turn-controller.ts',
  'services/api/src/conversation/coordinator.ts',
  'services/api/src/conversation/planning.ts',
  'services/api/src/conversation/catalog.ts',
  'services/api/src/conversation/catalog-runtime.ts',
  'services/api/src/user-intent-document.ts',
  'services/api/src/conversation/tool-gateway.ts',
  'services/api/src/conversation/action-gate.ts',
  'services/api/src/conversation/provider-evidence.ts',
  'services/api/src/conversation/provider-correlation.ts',
  'services/api/src/store-postgres.ts',
  'services/api/src/store-memory.ts',
  'services/api/src/privacy.ts',
  'services/api/src/knowledge.ts',
  'services/model-gateway/gateway/app.py',
  'services/model-gateway/gateway/agent.py',
  'services/model-gateway/gateway/graph.py',
  'services/model-gateway/gateway/v2_contracts.py',
  'services/model-gateway/gateway/tool_definitions.py',
];

export const APPROVED_PYTHON_READ_TOOLS = [
  'get_conversation_context', 'get_persona', 'get_intent_catalog',
  'get_conversation_history_summary', 'get_missing_requirements', 'search_knowledge', 'get_journey_state',
  'get_available_packages', 'get_document_requirements', 'get_action_status',
];

const rootFromScript = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const normalize = value => value.split('\\').join('/');
const fileText = async (root, path) => readFile(join(root, path), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});

async function sourceFiles(root, relativeDirectory) {
  const dir = join(root, relativeDirectory);
  const entries = await readdir(dir, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const results = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = normalize(join(relativeDirectory, entry.name));
    if (entry.isDirectory()) results.push(...await sourceFiles(root, path));
    else if (entry.isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.d.ts')) results.push(path);
  }
  return results;
}

export async function checkV2RetirementSafety(root = rootFromScript) {
  const issues = [];
  const add = (code, path, detail) => issues.push({ code, path, detail });
  for (const path of BASELINE_MIGRATIONS) {
    if (await fileText(root, path) === null) add('MIGRATION_MISSING', path, 'Baseline SQL migration must remain in the repository.');
  }
  for (const path of PROTECTED_V2_SOURCES) {
    if (await fileText(root, path) === null) add('V2_SOURCE_MISSING', path, 'Protected production V2 module must remain.');
  }

  // Rollback-only exception: index.ts is currently the sole production entry that
  // may import the V1 Python adapter. Tests and the adapter's own file are excluded.
  const legacyImport = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)['"][^'"]*chat-model-adapter(?:\.(?:js|ts))?['"]/gu;
  for (const path of await sourceFiles(root, 'services/api/src')) {
    if (path === 'services/api/src/index.ts' || path === 'services/api/src/python-model/chat-model-adapter.ts') continue;
    const body = await fileText(root, path);
    if (body && legacyImport.test(body)) add('V1_ADAPTER_IMPORT', path, 'Only index.ts may retain the explicit rollback adapter import.');
    legacyImport.lastIndex = 0;
  }

  const forbiddenV2PlannerCalls = [
    /\bresolveIntent\s*\(/u, /\bresolveIntentContinuity\s*\(/u,
    /\brunAgentTools\s*\(/u, /\bpythonChatModelFromEnv\s*\(/u,
    /\bnew\s+DeterministicGroundedModel\s*\(/u,
    /\bplanV2\s*\(/u, /\b(?:model\.)?(?:draft|normalizeQuery)\s*\(/u,
    /\/internal\/v1\/model\/(?:plan|normalize)/u,
  ];
  for (const path of ['services/api/src/conversation/turn-controller.ts', 'services/api/src/conversation/coordinator.ts']) {
    const body = await fileText(root, path);
    if (!body) continue; // Missing module is already reported above.
    for (const expression of forbiddenV2PlannerCalls) {
      if (expression.test(body)) add('V1_PLANNER_IN_V2_ROUTE', path, `Forbidden GPT-first routing reference: ${expression.source}`);
    }
  }

  const toolPath = 'services/model-gateway/gateway/tool_definitions.py';
  const toolDefinitions = await fileText(root, toolPath);
  if (toolDefinitions !== null) {
    const keys = [...toolDefinitions.matchAll(/^    ["']([^"']+)["']:\s*\{/gmu)].map(match => match[1]);
    if (!keys.length) add('PYTHON_TOOLS_UNPARSEABLE', toolPath, 'Cannot verify Python function tool definitions.');
    for (const key of keys) if (!APPROVED_PYTHON_READ_TOOLS.includes(key)) add('PYTHON_TOOL_NOT_READ_ONLY', toolPath, `Unapproved tool definition: ${key}`);
    if (!/for name in allowlist if name in TOOL_DEFINITIONS/u.test(toolDefinitions)) {
      add('PYTHON_TOOL_ALLOWLIST_MISSING', toolPath, 'Tool exposure must remain an intersection of the authorized allowlist and definitions.');
    }
  }

  for (const path of [
    'services/model-gateway/gateway/app.py',
    'services/model-gateway/gateway/agent.py',
    'services/model-gateway/gateway/graph.py',
    'services/model-gateway/gateway/tool_definitions.py',
  ]) {
    const body = await fileText(root, path);
    if (!body) continue;
    if (/(?:\b(?:import|from)\s+(?:psycopg\w*|asyncpg|sqlalchemy|redis|simple_salesforce|boto3|subprocess)\b|\bos\.system\s*\(|\bsubprocess\.|\b(?:requests|httpx)\.(?:post|put|patch|delete)\s*\()/u.test(body)) {
      add('PYTHON_WRITE_CAPABILITY', path, 'Direct DB, external write transport, or subprocess capability in inference runtime.');
    }
    const lines = body.split('\n');
    lines.forEach((line, index) => {
      if (/\.(?:put|patch|delete)\s*\(/u.test(line) && !line.trim().startsWith('@app.')) {
        add('PYTHON_WRITE_CAPABILITY', path, `HTTP write-like method on line ${index + 1}.`);
      }
      if (/\.post\s*\(/u.test(line) && !line.trim().startsWith('@app.') &&
        !(path.endsWith('/agent.py') && line.includes('client.post(f"{self.base_url}/internal/v2/tools/execute"'))) {
        add('PYTHON_WRITE_CAPABILITY', path, `Unapproved HTTP POST on line ${index + 1}.`);
      }
    });
  }
  issues.sort((a, b) => `${a.path}|${a.code}|${a.detail}`.localeCompare(`${b.path}|${b.code}|${b.detail}`, 'en'));
  return issues;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = await checkV2RetirementSafety();
  if (issues.length) {
    for (const issue of issues) console.error(`${issue.code} ${issue.path}: ${issue.detail}`);
    process.exitCode = 1;
  } else {
    console.log(`V2 retirement guard passed (${BASELINE_MIGRATIONS.length} migrations, ${PROTECTED_V2_SOURCES.length} protected modules, ${APPROVED_PYTHON_READ_TOOLS.length} approved Python tools).`);
  }
}
