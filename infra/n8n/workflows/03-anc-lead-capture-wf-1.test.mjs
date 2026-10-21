import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

test('binds remote CRM OAuth to the n8n credential store', async () => {
  const text = await readFile(new URL('./03-anc-lead-capture-wf-1.json', import.meta.url), 'utf8');
  const workflow = JSON.parse(text);
  assert.equal(workflow.id, 'ANCLeadCaptureWF1');
  assert.equal(workflow.name, 'ANC Lead Capture WF-1');
  assert.equal(workflow.nodes.find((node) => node.name === 'ANC Lead Capture Webhook')?.parameters.path, 'anc-lead-capture-wf-1');
  assert.match(workflow.nodes.find((node) => node.name === 'Authenticate and Claim Event')?.parameters.jsonBody, /anc-lead-capture-v1/);
  assert.equal(workflow.nodes.find((node) => node.name === 'Fetch Authorized Remote CRM Payload')?.parameters.url.includes('/remote-payload'), true);
  const remoteCreate = workflow.nodes.find((node) => node.name === 'Remote CRM Create Lead');
  assert.equal(remoteCreate?.parameters.url, '={{ $env.REMOTE_CRM_LEAD_URL }}');
  assert.deepEqual(remoteCreate?.credentials?.oAuth2Api, { id: 'TLK73VxX5k6day4t', name: 'SalesForce ANC - CREDS' });
  assert.equal(workflow.nodes.some((node) => node.name === 'Remote CRM OAuth'), false);
  assert.match(text, /Fetch Authorized Remote CRM Payload.*Remote CRM Create Lead/s);
  assert.doesNotMatch(text, /REMOTE_CRM_TOKEN_URL|REMOTE_CRM_GRANT_TYPE|REMOTE_CRM_CLIENT_ID|REMOTE_CRM_CLIENT_SECRET/);
  assert.doesNotMatch(text, /techcarrot4--realforce|salesforce\.com|remote\/sync/iu);
});
