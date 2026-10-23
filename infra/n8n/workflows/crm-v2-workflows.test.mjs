import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const files = ['CRM01ContactLookup.json', 'CRM02ContactUpsert.json', 'CRM03SummarySync.json', 'DOC01DocumentProcessing.json', ...Array.from({ length: 13 }, (_, index) => `INTENTancfzint${String(index + 1).padStart(2, '0')}.json`)];
const claimFiles = ['01-lead-capture-and-crm.json', '03-anc-lead-capture-wf-1.json', ...files];

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
      assert.match(terminal.parameters.jsonBody, /executionReference:\s*\$execution\.id/);
      assert.match(terminal.parameters.jsonBody, /eventId:/);
      assert.match(terminal.parameters.jsonBody, /correlationId:/);
      assert.match(terminal.parameters.jsonBody, /attempt:/);
      assert.ok(workflow.connections['Verify Remote CRM Completion'].main[0].some((item) => item.node === 'Finalize Claimed Action'));
      assert.match(workflow.notes, /INACTIVE TEMPLATE/);
    }
  }
});

test('every checked-in workflow claim includes its own n8n identity and stays single-item', async () => {
  for (const file of claimFiles) {
    const workflow = JSON.parse(await readFile(new URL(`./${file}`, import.meta.url), 'utf8'));
    const claimNodes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.httpRequest' && String(node.parameters.url ?? '').includes('/api/v1/internal/workflow-events/claim'));
    assert.ok(claimNodes.length, `${file} must contain a workflow claim request`);
    for (const node of claimNodes) {
      assert.match(node.parameters.jsonBody ?? '', /n8nWorkflowId:\s*\$workflow\.id/);
      assert.match(node.parameters.jsonBody ?? '', /limit:\s*1/);
    }
    if (file !== '01-lead-capture-and-crm.json') {
      for (const node of claimNodes) {
        assert.match(node.parameters.jsonBody ?? '', /actionId:/);
        assert.match(node.parameters.jsonBody ?? '', /tenantId:/);
        assert.match(node.parameters.jsonBody ?? '', /eventId:/);
        assert.match(node.parameters.jsonBody ?? '', /correlationId:/);
        assert.match(node.parameters.jsonBody ?? '', /attempt:/);
      }
      if (file === '03-anc-lead-capture-wf-1.json') {
        assert.match(claimNodes[0].parameters.jsonBody, /\(\$json\.body \?\? \$json\)\.actionId/);
        assert.match(claimNodes[0].parameters.jsonBody, /\(\$json\.body \?\? \$json\)\.eventId/);
      } else {
        const validation = workflow.nodes.find((node) => node.name === 'Validate Server Event');
        assert.ok(validation, `${file} must validate its webhook envelope`);
        assert.match(validation.parameters.jsCode, /input\.actionId/);
        assert.match(validation.parameters.jsCode, /input\.eventId/);
        assert.match(validation.parameters.jsCode, /input\.correlationId/);
        assert.match(validation.parameters.jsCode, /input\.attempt/);
      }
    } else {
      assert.doesNotMatch(claimNodes[0].parameters.jsonBody ?? '', /actionId:/);
    }
    if (file === '03-anc-lead-capture-wf-1.json') {
      for (const name of ['Complete Async Registration', 'Complete Internal Registration']) {
        const node = workflow.nodes.find((candidate) => candidate.name === name);
        assert.ok(node, `${file} must contain ${name}`);
        assert.match(node.parameters.jsonBody, /executionReference:\s*\$execution\.id/);
        assert.match(node.parameters.jsonBody, /eventId:/);
        assert.match(node.parameters.jsonBody, /correlationId:/);
        assert.match(node.parameters.jsonBody, /attempt:/);
      }
    }
  }
});
