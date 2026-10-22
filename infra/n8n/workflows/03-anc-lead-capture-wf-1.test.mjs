import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

test('binds remote CRM OAuth to the n8n credential store', async () => {
  const text = await readFile(new URL('./03-anc-lead-capture-wf-1.json', import.meta.url), 'utf8');
  const workflow = JSON.parse(text);
  assert.equal(workflow.id, 'ANCLeadCaptureWF1');
  assert.equal(workflow.name, 'ANC Lead Capture WF-1');
  const webhook = workflow.nodes.find((node) => node.name === 'ANC Lead Capture Webhook');
  assert.equal(webhook?.parameters.path, 'anc-lead-capture-wf-1');
  assert.equal(webhook?.parameters.responseMode, 'onReceived');
  assert.equal(webhook?.parameters.responseCode, 202);
  assert.match(workflow.nodes.find((node) => node.name === 'Authenticate and Claim Event')?.parameters.jsonBody, /anc-lead-capture-v1/);
  assert.equal(workflow.nodes.find((node) => node.name === 'Fetch Authorized Remote CRM Payload')?.parameters.url.includes('/remote-payload'), true);
  const remoteCreate = workflow.nodes.find((node) => node.name === 'Remote CRM Create Lead');
  assert.equal(remoteCreate?.parameters.url, '={{ $env.REMOTE_CRM_LEAD_URL }}');
  assert.deepEqual(remoteCreate?.credentials?.oAuth2Api, { id: 'TLK73VxX5k6day4t', name: 'SalesForce ANC - CREDS' });
  assert.equal(workflow.nodes.some((node) => node.name === 'Remote CRM OAuth'), false);
  assert.match(text, /Fetch Authorized Remote CRM Payload.*Remote CRM Create Lead/s);
  assert.doesNotMatch(text, /REMOTE_CRM_TOKEN_URL|REMOTE_CRM_GRANT_TYPE|REMOTE_CRM_CLIENT_ID|REMOTE_CRM_CLIENT_SECRET/);
  assert.doesNotMatch(text, /techcarrot4--realforce|salesforce\.com|remote\/sync/iu);
  const internalCompletion = workflow.nodes.find((node) => node.name === 'Complete Internal Registration');
  assert.match(internalCompletion?.parameters.url ?? '', /workflow-events\/complete/);
  assert.equal(workflow.connections['Remote CRM Qualification Gate'].main[1][0].node, 'Complete Internal Registration');
  assert.equal(workflow.connections['Complete Internal Registration'].main[0][0].node, 'Return Internal Registration');
  assert.equal(workflow.connections['Commercial Opportunity?'].main[1][0].node, 'Complete Support Review');
  assert.equal(workflow.connections['Required Lead Data Present?'].main[1][0].node, 'Complete Partial Review');
  assert.equal(workflow.connections['Complete Support Review'].main[0][0].node, 'Return Support or Human Review');
  assert.equal(workflow.connections['Complete Partial Review'].main[0][0].node, 'Return Partial Lead');
  for (const name of ['Internal CRM Upsert', 'Persist Score and Summary', 'Fetch Authorized Remote CRM Payload', 'Remote CRM Create Lead', 'Validate Remote CRM Lead ID', 'Internal CRM Remote ID Callback', 'Complete Support Review', 'Complete Partial Review']) {
    assert.equal(workflow.nodes.find((node) => node.name === name)?.onError, 'continueErrorOutput');
    assert.equal(workflow.connections[name].main[1][0].node, 'Complete CRM Reconciliation');
  }
  assert.equal(workflow.connections['Complete CRM Reconciliation'].main[0][0].node, 'Return CRM Reconciliation');
  assert.match(workflow.nodes.find((node) => node.name === 'Complete CRM Reconciliation')?.parameters.jsonBody ?? '', /reconcile_required/);
  assert.equal(workflow.nodes.some((node) => node.name === 'Return Registered'), false);
});
