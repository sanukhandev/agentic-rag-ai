import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const files = ['CRM01ContactLookup.json', 'CRM02ContactUpsert.json', 'CRM03SummarySync.json', 'DOC01DocumentProcessing.json', ...Array.from({ length: 13 }, (_, index) => `INTENTancfzint${String(index + 1).padStart(2, '0')}.json`)];

test('CRM v2 workflow exports are tenant-neutral and server-authenticated', async () => {
  for (const file of files) {
    const text = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
    const workflow = JSON.parse(text);
    assert.equal(workflow.active, false, `${file} must not be activated without approval`);
    assert.ok(workflow.nodes.some((node) => node.name === 'Authenticate and Claim Event'));
    assert.doesNotMatch(text, /N8N_WEBHOOK_SECRET|\\$env\\./);
    const internalRequests = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.httpRequest');
    assert.ok(internalRequests.length >= 2, `${file} should have authenticated internal HTTP calls`);
    for (const node of internalRequests) {
      assert.equal(node.parameters.authentication, 'genericCredentialType', `${file} ${node.name} requires managed authentication`);
      assert.equal(node.parameters.genericAuthType, 'httpHeaderAuth');
    }
    assert.doesNotMatch(text, /client_secret|client_id|password|api[_-]?key|techcarrot4--realforce|salesforce\.com|anc-test|sanu-khan/iu);
    assert.ok(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.webhook'));
    if (file === 'CRM02ContactUpsert.json' || file.startsWith('INTENT')) {
      const verify = workflow.nodes.find((node) => node.name === 'Verify Remote CRM Completion');
      const terminal = workflow.nodes.find((node) => node.name === 'Finalize Claimed Action');
      assert.ok(verify && terminal, `${file} must explicitly complete or fail a claimed CRM action`);
      assert.match(verify.parameters.jsCode, /remoteVerified \? 'completed' : 'failed'/);
      assert.match(terminal.parameters.url, /workflow-events\/complete/);
      assert.ok(workflow.connections['Verify Remote CRM Completion'].main[0].some((item) => item.node === 'Finalize Claimed Action'));
      assert.match(workflow.notes, /INACTIVE TEMPLATE/);
    }
  }
});
