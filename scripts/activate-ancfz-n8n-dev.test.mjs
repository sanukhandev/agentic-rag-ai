import test from 'node:test';
import assert from 'node:assert/strict';
import { activateDevWorkflows } from './activate-ancfz-n8n-dev.mjs';

test('publishes only the reviewed local ANCFZ workflow allowlist', async () => {
  const calls = [];
  const result = await activateDevWorkflows({
    executor: async (id) => calls.push(id),
    workflowIds: ['ancfzV2LeadCreateR1', 'ancfzV2PackageQuoteR1', 'ANCDocumentOCRWF1'],
  });
  assert.deepEqual(calls, ['ancfzV2LeadCreateR1', 'ancfzV2PackageQuoteR1', 'ANCDocumentOCRWF1']);
  assert.deepEqual(result, { activated: calls });
});

test('rejects any workflow outside the local allowlist before publishing', async () => {
  await assert.rejects(() => activateDevWorkflows({ executor: async () => {}, workflowIds: ['ancfzV2LeadCreateR1', 'unrelated'] }), /N8N_DEV_ACTIVATION_WORKFLOW_NOT_ALLOWED/);
});
