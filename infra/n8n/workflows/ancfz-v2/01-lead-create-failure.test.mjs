import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

test('routes lead workflow failures to a bounded correlated Node callback', async () => {
  const workflow = JSON.parse(await readFile(new URL('./01-lead-create.json', import.meta.url), 'utf8'));
  const sideEffects = ['Claim Authorized Action', 'Call Provider - Configure Credential', 'Read Back Provider State', 'Ask Node to Verify Provider Evidence', 'Complete Correlated Action'];
  const failure = workflow.nodes.find((node) => node.name === 'Report Correlated Failure');
  assert.match(failure?.parameters?.url ?? '', /workflow-events\/fail$/);
  assert.match(failure?.parameters?.jsonBody ?? '', /reasonCode/);
  assert.doesNotMatch(failure?.parameters?.jsonBody ?? '', /error|body|response/iu);
  for (const name of sideEffects) {
    const node = workflow.nodes.find((candidate) => candidate.name === name);
    assert.equal(node?.onError, 'continueErrorOutput', name);
    assert.equal(workflow.connections[name]?.main?.[1]?.[0]?.node, 'Report Correlated Failure', name);
  }
});
