import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForTerminalStatus } from './mock-salesforce-webhook.mjs';

test('waits for the asynchronous n8n execution to reach a terminal error', async () => {
  const statuses = ['running', 'running', 'error'];
  const result = await waitForTerminalStatus(async () => statuses.shift(), { delayMs: 0 });
  assert.equal(result, 'error');
});
