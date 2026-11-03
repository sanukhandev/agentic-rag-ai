import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  checkV2RetirementSafety, BASELINE_MIGRATIONS,
  PROTECTED_V2_SOURCES, APPROVED_PYTHON_READ_TOOLS,
} from './check-v2-retirement-safety.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'retirement-guard-'));
  const put = async (path, content = '/* kept */\n') => {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
  };
  for (const path of [...BASELINE_MIGRATIONS, ...PROTECTED_V2_SOURCES]) await put(path);
  await put('services/model-gateway/gateway/tool_definitions.py', `TOOL_DEFINITIONS = {\n${APPROVED_PYTHON_READ_TOOLS.map(name => `    "${name}": {},`).join('\n')}\n}\ndef definitions_for(allowlist):\n    return [TOOL_DEFINITIONS[name] for name in allowlist if name in TOOL_DEFINITIONS]\n`);
  await put('services/model-gateway/gateway/agent.py', 'await client.post(f"{self.base_url}/internal/v2/tools/execute")\n');
  try { await run({ root, put }); } finally { await rm(root, { force: true, recursive: true }); }
}

const has = (issues, code) => issues.some(issue => issue.code === code);

test('baseline guard accepts the pinned read-only fixture', async () => fixture(async ({ root }) => {
  assert.deepEqual(await checkV2RetirementSafety(root), []);
}));

test('reports a deleted applied migration', async () => fixture(async ({ root }) => {
  await rm(join(root, BASELINE_MIGRATIONS[0]));
  assert.ok(has(await checkV2RetirementSafety(root), 'MIGRATION_MISSING'));
}));

test('reports a deleted protected V2 module', async () => fixture(async ({ root }) => {
  await rm(join(root, PROTECTED_V2_SOURCES[2]));
  assert.ok(has(await checkV2RetirementSafety(root), 'V2_SOURCE_MISSING'));
}));

test('allows the explicit index.ts rollback import but rejects a new production import', async () => fixture(async ({ root, put }) => {
  await put('services/api/src/index.ts', "import { pythonChatModelFromEnv } from './python-model/chat-model-adapter.js';\n");
  assert.equal(has(await checkV2RetirementSafety(root), 'V1_ADAPTER_IMPORT'), false);
  await put('services/api/src/routes/chat.ts', "import { PythonChatModelAdapter } from '../python-model/chat-model-adapter.js';\n");
  assert.ok(has(await checkV2RetirementSafety(root), 'V1_ADAPTER_IMPORT'));
}));

test('rejects direct legacy planner invocation by the V2 turn controller', async () => fixture(async ({ root, put }) => {
  await put('services/api/src/v2-turn-controller.ts', 'const result = resolveIntent(catalog, text);\n');
  assert.ok(has(await checkV2RetirementSafety(root), 'V1_PLANNER_IN_V2_ROUTE'));
}));

test('rejects unapproved Python tool definitions', async () => fixture(async ({ root, put }) => {
  await put('services/model-gateway/gateway/tool_definitions.py', `TOOL_DEFINITIONS = {\n    "create_salesforce_lead": {},\n}\ndef definitions_for(allowlist):\n    return [TOOL_DEFINITIONS[name] for name in allowlist if name in TOOL_DEFINITIONS]\n`);
  assert.ok(has(await checkV2RetirementSafety(root), 'PYTHON_TOOL_NOT_READ_ONLY'));
}));

test('requires Python tool exposure to intersect with the allowlist', async () => fixture(async ({ root, put }) => {
  await put('services/model-gateway/gateway/tool_definitions.py', 'TOOL_DEFINITIONS = {\n    "get_persona": {},\n}\ndef definitions_for(allowlist):\n    return list(TOOL_DEFINITIONS.values())\n');
  assert.ok(has(await checkV2RetirementSafety(root), 'PYTHON_TOOL_ALLOWLIST_MISSING'));
}));

test('rejects Python HTTP writes outside the allowlisted Node read gateway', async () => fixture(async ({ root, put }) => {
  await put('services/model-gateway/gateway/agent.py', 'await client.post("https://crm.example/leads", json={})\n');
  assert.ok(has(await checkV2RetirementSafety(root), 'PYTHON_WRITE_CAPABILITY'));
}));

test('rejects direct Python database access', async () => fixture(async ({ root, put }) => {
  await put('services/model-gateway/gateway/graph.py', 'import sqlalchemy\n');
  assert.ok(has(await checkV2RetirementSafety(root), 'PYTHON_WRITE_CAPABILITY'));
}));

test('protects the confirmed-goal migration added after the original baseline', async () => fixture(async ({ root }) => {
  const latest = BASELINE_MIGRATIONS.at(-1);
  assert.equal(latest, 'infra/postgres/057-v2-business-goal-confirmation.sql');
  await rm(join(root, latest));
  assert.ok(has(await checkV2RetirementSafety(root), 'MIGRATION_MISSING'));
}));
