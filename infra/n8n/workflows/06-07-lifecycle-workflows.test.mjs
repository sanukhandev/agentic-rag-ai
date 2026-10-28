import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

for (const [file, id, claimName, contract, providerName, providerUrl] of [
  ['06-anc-invoice-generation-wf-1.json', 'ANCInvoiceGenerationWF1', 'Authenticate and Claim Invoice Event', 'anc-invoice-generation-v1', 'Create Sandbox Invoice', 'BILLING_INVOICE_URL'],
  ['07-anc-contract-preparation-wf-1.json', 'ANCContractPreparationWF1', 'Authenticate and Claim Contract Event', 'anc-contract-preparation-v1', 'Create Sandbox Contract Draft', 'CONTRACT_PROVIDER_URL'],
]) {
  test(`${file} has bounded, verified provider execution`, async () => {
    const text = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
    const workflow = JSON.parse(text);
    assert.equal(workflow.id, id);
    assert.equal(workflow.active, true);
    const claim = workflow.nodes.find((node) => node.name === claimName);
    assert.match(claim.parameters.jsonBody, /n8nWorkflowId: \$workflow\.id/);
    assert.match(claim.parameters.jsonBody, /limit: 1/);
    assert.match(claim.parameters.jsonBody, new RegExp(contract));
    const provider = workflow.nodes.find((node) => node.name === providerName);
    assert.equal(provider.parameters.url, `={{ $env.${providerUrl} }}`);
    assert.equal(provider.parameters.genericAuthType, 'httpHeaderAuth');
    const validate = workflow.nodes.find((node) => node.name.includes('Validate'));
    assert.match(validate.parameters.jsCode, /reconciliation/);
    for (const name of [providerName, validate.name, workflow.nodes.find((node) => node.name.startsWith('Verified ')).name]) {
      assert.equal(workflow.nodes.find((node) => node.name === name).onError, 'continueErrorOutput');
      assert.equal(workflow.connections[name].main[1][0].node, name.includes('Verified') ? workflow.nodes.find((node) => node.name.includes('Reconciliation')).name : workflow.nodes.find((node) => node.name.includes('Reconciliation')).name);
    }
    assert.doesNotMatch(text, /client_secret|client_id|password|techcarrot4--realforce|salesforce\.com/iu);
  });
}
