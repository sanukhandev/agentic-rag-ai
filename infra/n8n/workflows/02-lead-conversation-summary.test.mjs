import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

test('formats a CRM summary for people while keeping raw conversation data separate', async () => {
  const workflow = JSON.parse(await readFile(new URL('./02-lead-conversation-summary.json', import.meta.url), 'utf8'));
  assert.equal(workflow.nodes.find((node) => node.name === 'When Lead Is Captured').parameters.inputSource, 'passthrough');
  const code = workflow.nodes.find((node) => node.name === 'Generate Conversation Summary').parameters.jsCode;
  const run = new Function('$json', code);
  const [{ json }] = run({
    leadId: 'lead-1',
    tenantId: 'tenant-1',
    intent: 'lead.capture',
    score: 70,
    quality: 'warm',
    validationPass: true,
    leadData: { name: '[NAME_1]', email: '[EMAIL_1]' },
    conversation: [
      { role: 'user', content: 'I want to discuss a website for my startup.', createdAt: '2026-01-01T00:00:00.000Z' },
      { role: 'assistant', content: 'What name should I use?', createdAt: '2026-01-01T00:00:01.000Z' },
      { role: 'user', content: '[NAME_1] Three', createdAt: '2026-01-01T00:00:02.000Z' },
      { role: 'assistant', content: 'What is the best email?', createdAt: '2026-01-01T00:00:03.000Z' },
      { role: 'user', content: '[EMAIL_1]', createdAt: '2026-01-01T00:00:04.000Z' },
    ],
  });

  assert.match(json.summary, /^Customer request: I want to discuss a website for my startup\./m);
  assert.match(json.summary, /Contact details: Provided\./);
  assert.match(json.summary, /Intent: lead capture\./);
  assert.match(json.summary, /Lead quality: Warm \(70\/100\)\./);
  assert.match(json.summary, /Validation: Passed\./);
  assert.match(json.summary, /Conversation: 3 visitor message\(s\), 2 assistant response\(s\)\./);
  assert.doesNotMatch(json.summary, /\[NAME_1\]|\[EMAIL_1\]/);
  assert.doesNotMatch(json.summary, /Full conversation JSON|createdAt/);
});

test('calculates quality from the published catalog rule and slot weights', async () => {
  const workflow = JSON.parse(await readFile(new URL('./02-lead-conversation-summary.json', import.meta.url), 'utf8'));
  const code = workflow.nodes.find((node) => node.name === 'Calculate Catalog Quality').parameters.jsCode;
  const run = new Function('$json', code);
  const [{ json }] = run({
    leadId: 'lead-1',
    tenantId: 'tenant-1',
    workflowKey: 'crm.lead.create',
    qualityWorkflowKey: 'crm.lead.quality.score',
    catalogVersionId: 'catalog-1',
    intent: 'lead.capture',
    intentScore: 80,
    intentConfidence: 0.8,
    leadData: { name: '[NAME_1]', phone: '[PHONE_1]' },
    catalog: {
      intents: [{ intentKey: 'lead.capture', active: true }],
      workflowBindings: [{ workflowKey: 'crm.lead.create', active: true }, { workflowKey: 'crm.lead.quality.score', active: true }],
      slots: [{ intentKey: 'lead.capture', slotKey: 'name', qualityWeight: 50 }, { intentKey: 'lead.capture', slotKey: 'email', qualityWeight: 30 }, { intentKey: 'lead.capture', slotKey: 'phone', qualityWeight: 20 }],
      qualityRules: [{ intentKey: 'lead.capture', qualityWorkflowKey: 'crm.lead.quality.score', intentWeight: 0.6, confidenceWeight: 0.2, contactWeight: 0.2, hotThreshold: 85, warmThreshold: 70, nurtureThreshold: 40 }],
    },
    conversation: [],
  });

  assert.equal(json.score, 78);
  assert.equal(json.quality, 'warm');
  assert.equal(json.qualityWorkflowKey, 'crm.lead.quality.score');
});
