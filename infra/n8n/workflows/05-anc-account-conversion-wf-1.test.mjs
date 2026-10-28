import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

test('Account conversion stays conditional and requires verified remote IDs', async () => {
  const workflow = JSON.parse(await readFile(new URL('./05-anc-account-conversion-wf-1.json', import.meta.url), 'utf8'));
  assert.equal(workflow.id, 'ANCAccountConversionWF1');
  assert.equal(workflow.active, true);
  const claim = workflow.nodes.find((node) => node.name === 'Authenticate and Claim Account Event');
  assert.match(claim.parameters.jsonBody, /n8nWorkflowId: \$workflow\.id/);
  assert.match(claim.parameters.jsonBody, /workflowKey: 'crm\.account\.convert'/);
  assert.match(claim.parameters.jsonBody, /anc-account-conversion-v1/);
  assert.match(claim.parameters.jsonBody, /limit: 1/);
  const payload = workflow.nodes.find((node) => node.name === 'Fetch Authorized Account Conversion Payload');
  assert.match(payload.parameters.url, /crm\/accounts/);
  assert.match(payload.parameters.url, /remote-payload/);
  const remote = workflow.nodes.find((node) => node.name === 'Remote CRM Convert Lead');
  assert.equal(remote.parameters.url, '={{ $env.REMOTE_CRM_ACCOUNT_URL }}');
  assert.deepEqual(remote.credentials.oAuth2Api, { id: 'TLK73VxX5k6day4t', name: 'SalesForce ANC - CREDS' });
  const validate = workflow.nodes.find((node) => node.name === 'Validate Remote Account IDs');
  assert.match(validate.parameters.jsCode, /accountId/);
  assert.match(validate.parameters.jsCode, /contactId/);
  assert.match(validate.parameters.jsCode, /opportunityId/);
  assert.match(validate.parameters.jsCode, /reconciliation/);
  const callback = workflow.nodes.find((node) => node.name === 'Verified Account IDs Callback');
  assert.match(callback.parameters.url, /crm\/accounts/);
  assert.match(callback.parameters.jsonBody, /actionId/);
  assert.match(callback.parameters.jsonBody, /remoteAccountId/);
  for (const name of ['Fetch Authorized Account Conversion Payload', 'Remote CRM Convert Lead', 'Validate Remote Account IDs', 'Verified Account IDs Callback']) {
    assert.equal(workflow.nodes.find((node) => node.name === name).onError, 'continueErrorOutput');
    assert.equal(workflow.connections[name].main[1][0].node, 'Complete Account Reconciliation');
  }
  assert.match(workflow.nodes.find((node) => node.name === 'Complete Account Conversion').parameters.jsonBody, /state: 'completed'/);
  assert.match(workflow.nodes.find((node) => node.name === 'Complete Account Reconciliation').parameters.jsonBody, /state: 'reconcile_required'/);
});
