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
    assert.match(text, /N8N_WEBHOOK_SECRET/);
    assert.doesNotMatch(text, /client_secret|client_id|password|api[_-]?key|techcarrot4--realforce|salesforce\.com|anc-test|sanu-khan/iu);
    assert.ok(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.webhook'));
  }
});
