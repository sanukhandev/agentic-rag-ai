import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

test('claims approved actions by polling and chains the catalog quality workflow', async () => {
  const workflow = JSON.parse(await readFile(new URL('./01-lead-capture-and-crm.json', import.meta.url), 'utf8'));
  assert.equal(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.webhook'), false);
  assert.equal(workflow.nodes.find((node) => node.name === 'Poll Approved Lead Actions')?.type, 'n8n-nodes-base.scheduleTrigger');
  assert.equal(workflow.nodes.find((node) => node.name === 'Claim Approved Catalog Actions')?.parameters.url, 'http://api:4000/api/v1/internal/workflow-events/claim');
  assert.equal(workflow.nodes.find((node) => node.name === 'Prepare Quality Input')?.type, 'n8n-nodes-base.code');
  assert.equal(workflow.nodes.find((node) => node.name === 'Calculate Catalog Lead Quality')?.type, 'n8n-nodes-base.executeWorkflow');
});
