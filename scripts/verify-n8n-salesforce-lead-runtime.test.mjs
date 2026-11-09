import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRuntime } from './verify-n8n-salesforce-lead-runtime.mjs';

const expected = {
  workflowId: 'ancfzV2LeadCreateR1',
  expectedPath: 'ancfz/v2/lead-create',
  expectedContract: 'ancfz-v2-stage-action-v1',
};

const valid = {
  id: expected.workflowId,
  active: true,
  webhookPath: expected.expectedPath,
  payloadContract: expected.expectedContract,
};

test('accepts the active Salesforce lead workflow with required secret-presence flags', () => {
  assert.deepEqual(verifyRuntime({
    ...expected,
    runtimeList: [valid],
    envPresence: {
      createUrl: true,
      readbackUrl: true,
      oauthClient: true,
      internalWebhookSecret: true,
    },
  }), {
    ok: true,
    workflowId: expected.workflowId,
    path: expected.expectedPath,
    contract: expected.expectedContract,
  });
});

for (const [name, workflow] of [
  ['missing workflow', []],
  ['inactive workflow', [{ ...valid, active: false }]],
  ['wrong webhook path', [{ ...valid, webhookPath: 'wrong/path' }]],
  ['wrong payload contract', [{ ...valid, payloadContract: 'wrong-contract' }]],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() => verifyRuntime({
      ...expected,
      runtimeList: workflow,
      envPresence: { createUrl: true, readbackUrl: true, oauthClient: true, internalWebhookSecret: true },
    }), /N8N_SALESFORCE_READINESS_/);
  });
}

test('rejects missing credential-presence flags without exposing their values', () => {
  assert.throws(() => verifyRuntime({
    ...expected,
    runtimeList: [valid],
    envPresence: { createUrl: true, readbackUrl: false, oauthClient: true, internalWebhookSecret: true },
  }), /N8N_SALESFORCE_READINESS_MISSING_SECRET/);
});
