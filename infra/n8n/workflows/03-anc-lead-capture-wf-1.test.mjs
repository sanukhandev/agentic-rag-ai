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
  assert.match(workflow.nodes.find((node) => node.name === 'Authenticate and Claim Event')?.parameters.jsonBody ?? '', /n8nWorkflowId: \$workflow\.id/);
  assert.match(workflow.nodes.find((node) => node.name === 'Authenticate and Claim Event')?.parameters.jsonBody ?? '', /limit: 1/);
  assert.doesNotMatch(workflow.nodes.find((node) => node.name === 'Authenticate and Claim Event')?.parameters.jsonBody ?? '', /anc\.crm\.lead\.capture/);
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
  assert.match(workflow.nodes.find((node) => node.name === 'Complete Support Review')?.parameters.jsonBody ?? '', /human_review/);
  assert.match(workflow.nodes.find((node) => node.name === 'Complete Partial Review')?.parameters.jsonBody ?? '', /awaiting_customer/);
  assert.match(workflow.nodes.find((node) => node.name === 'Complete CRM Reconciliation')?.parameters.jsonBody ?? '', /reconcile_required/);
  assert.match(workflow.nodes.find((node) => node.name === 'Return Support or Human Review')?.parameters.jsCode ?? '', /human_review/);
  assert.match(workflow.nodes.find((node) => node.name === 'Return Partial Lead')?.parameters.jsCode ?? '', /awaiting_customer/);
  assert.equal(workflow.nodes.some((node) => node.name === 'Return Registered'), false);
});

test('routes from the claimed catalog intent and current consent, not message keywords', async () => {
  const text = await readFile(new URL('./03-anc-lead-capture-wf-1.json', import.meta.url), 'utf8');
  const workflow = JSON.parse(text);
  const routeCode = workflow.nodes.find((node) => node.name === 'Multi-Intent Routing')?.parameters.jsCode;
  assert.equal(typeof routeCode, 'string');
  assert.doesNotMatch(routeCode, /support\|renew\|licen|do not contact|unsubscribe/iu);
  const route = (input) => new Function('$json', routeCode)(input)[0].json;
  const catalog = {
    intents: [
      { intentKey: 'trade.license.application', category: 'company_formation', workflowKey: 'crm.lead.create', active: true, priority: 100 },
      { intentKey: 'trade.license.renewal', category: 'support', workflowKey: 'crm.support.review', active: true, priority: 90 }
    ],
    signals: [
      { intentKey: 'trade.license.application', value: 'new licence', weight: 80 },
      { intentKey: 'trade.license.renewal', value: 'renew licence', weight: 80 }
    ],
    workflowBindings: [
      { workflowKey: 'crm.lead.create', sideEffectClass: 'crm_write', active: true },
      { workflowKey: 'crm.support.review', sideEffectClass: 'human_review', active: true }
    ]
  };
  assert.equal(route({ intent: 'trade.license.application', workflowKey: 'crm.lead.create', leadData: { contactConsent: true }, catalog, conversation: [{ role: 'user', content: 'I need a new licence' }] }).route, 'commercial');
  assert.equal(route({ intent: 'trade.license.renewal', workflowKey: 'crm.support.review', leadData: { contactConsent: true }, catalog, conversation: [{ role: 'user', content: 'I need to renew licence' }] }).route, 'support');
  assert.equal(route({ intent: 'trade.license.application', workflowKey: 'crm.lead.create', leadData: { contactConsent: true }, catalog, conversation: [{ role: 'user', content: 'Do not contact me' }, { role: 'user', content: 'I need a new licence' }] }).route, 'commercial');
});
