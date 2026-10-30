import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFinalAcceptancePlan, FINAL_ACCEPTANCE_CONFIRMATION, FINAL_ACCEPTANCE_STAGES, parseFinalAcceptanceArgs, runPreflight } from './ancfz-final-acceptance.mjs';

test('requires an explicit dry-run or manual execution mode', () => {
  assert.throws(() => parseFinalAcceptanceArgs([], {}), /choose exactly one/);
  const config = parseFinalAcceptanceArgs(['--dry-run', '--provider-mode=mock'], {});
  assert.deepEqual({ ...config, outputPath: undefined }, { help: false, dryRun: true, execute: false, providerMode: 'mock', tenantSlug: 'anc', outputPath: undefined });
  assert.match(config.outputPath, /^artifacts\/ancfz-final-acceptance\/[0-9a-f-]{36}\.json$/u);
});

test('blocks unsafe provider modes and automatic execution', () => {
  assert.throws(() => parseFinalAcceptanceArgs(['--dry-run', '--provider-mode=real'], {}), /mock or sandbox/);
  assert.throws(() => parseFinalAcceptanceArgs(['--execute'], { ANCFZ_FINAL_ACCEPTANCE_CONFIRM: FINAL_ACCEPTANCE_CONFIRMATION, CI: 'true' }), /CI/);
  assert.throws(() => parseFinalAcceptanceArgs(['--execute'], { ANCFZ_FINAL_ACCEPTANCE_CONFIRM: FINAL_ACCEPTANCE_CONFIRMATION, CODEX_AUTO_RUN: 'true' }), /manual operator/);
  assert.throws(() => parseFinalAcceptanceArgs(['--execute'], {}), /ANCFZ_FINAL_ACCEPTANCE_CONFIRM/);
});

test('requires explicit sandbox opt-in and preserves the seven ordered stages', () => {
  assert.throws(() => parseFinalAcceptanceArgs(['--execute', '--provider-mode=sandbox'], { ANCFZ_FINAL_ACCEPTANCE_CONFIRM: FINAL_ACCEPTANCE_CONFIRMATION }), /ANCFZ_ALLOW_SANDBOX/);
  const config = parseFinalAcceptanceArgs(['--execute', '--provider-mode=sandbox'], { ANCFZ_FINAL_ACCEPTANCE_CONFIRM: FINAL_ACCEPTANCE_CONFIRMATION, ANCFZ_ALLOW_SANDBOX: 'true', TENANT_SLUG: 'ancfz' });
  const plan = runPreflight(config);
  assert.equal(plan.tenantSlug, 'ancfz');
  assert.deepEqual(plan.sevenStages.map((stage) => stage.stage), [...FINAL_ACCEPTANCE_STAGES]);
  assert.equal(plan.safety.realPayments, false);
  assert.equal(plan.safety.legalSignatures, false);
});

test('dry-run is a pure redacted plan and does not create provider claims', () => {
  const plan = buildFinalAcceptancePlan({ tenantSlug: 'anc', providerMode: 'mock', outputPath: 'artifacts/test.json' });
  assert.equal(plan.status, 'READY_FOR_MANUAL_EXECUTION');
  assert.equal(plan.syntheticCustomer, 'generated-at-run-time-and-redacted');
  assert.equal(plan.sevenStages.length, 7);
  assert.equal(plan.safety.legalRegistration, 'separate_authoritative_evidence');
  assert.match(JSON.stringify(plan), /READY_FOR_MANUAL_EXECUTION/);
  assert.doesNotMatch(JSON.stringify(plan), /@example|\+971|providerId|paymentUrl|signingUrl/);
});
