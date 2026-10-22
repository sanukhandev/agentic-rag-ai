import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'infra', 'n8n', 'workflows');
const esc = (value) => value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
const header = { parameters: { method: 'POST', url: '={{ "http://api:4000/api/v1/internal/workflow-events/claim" }}', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ workflowKey: $json.workflowKey, contract: $json.contract, limit: 10 }) }}', options: {} }, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2 };
const baseWorkflow = ({ id, name, webhookPath, workflowKey, contract, target }) => {
  const webhook = `${id}-webhook`;
  const validate = `${id}-validate`;
  const claim = `${id}-claim`;
  const expand = `${id}-expand`;
  const nodes = [
    { parameters: { httpMethod: 'POST', path: webhookPath, responseMode: 'lastNode', options: {} }, id: webhook, name: `${name} Webhook`, type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: webhookPath },
    { parameters: { jsCode: `const input = $json.body ?? $json;\nif (input.workflowKey !== ${JSON.stringify(workflowKey)} || input.contract !== ${JSON.stringify(contract)}) throw new Error('Workflow contract mismatch.');\nif (typeof input.tenantId !== 'string' || typeof input.sessionId !== 'string') throw new Error('Server-generated tenant and session references are required.');\nreturn [{ json: { ...input, workflowKey: ${JSON.stringify(workflowKey)}, contract: ${JSON.stringify(contract)} } }];` }, id: validate, name: 'Validate Server Event', type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, 0] },
    { ...header, id: claim, name: 'Authenticate and Claim Event', position: [480, 0] },
    { parameters: { jsCode: 'const items = Array.isArray($json.items) ? $json.items : [];\nreturn items.map((item) => ({ json: item }));' }, id: expand, name: 'Expand Claimed Events', type: 'n8n-nodes-base.code', typeVersion: 2, position: [720, 0] },
  ];
  const connections = {
    [`${name} Webhook`]: { main: [[{ node: 'Validate Server Event', type: 'main', index: 0 }]] },
    'Validate Server Event': { main: [[{ node: 'Authenticate and Claim Event', type: 'main', index: 0 }]] },
    'Authenticate and Claim Event': { main: [[{ node: 'Expand Claimed Events', type: 'main', index: 0 }]] },
  };
  if (target) {
    const targetId = `${id}-target`;
    nodes.push({ parameters: { method: target.method, url: target.url, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: target.body, options: {} }, id: targetId, name: target.name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [980, 0] });
    connections['Expand Claimed Events'] = { main: [[{ node: target.name, type: 'main', index: 0 }]] };
  }
  return { id, name, nodes, connections, active: false, settings: { executionOrder: 'v1' }, versionId: `${id}-v1`, meta: { templateCredsSetupCompleted: false }, tags: [], notes: 'Generated generic tenant-neutral export. Internal HTTP nodes require a tenant-authorized n8n HTTP Header Auth credential; keep inactive until provider integration, security approval and terminal action completion are verified.' };
};

const workflows = [
  baseWorkflow({ id: 'CRM01ContactLookup', name: 'CRM-01 Contact Lookup', webhookPath: 'crm-contact-lookup', workflowKey: 'crm.contact.lookup', contract: 'crm-contact-lookup-v1', target: { name: 'Authorized CRM Contact Lookup', method: 'POST', url: '={{ "http://api:4000/api/v1/internal/crm/contact-lookup" }}', body: '={{ JSON.stringify({ tenantId: $json.tenantId, sessionId: $json.sessionId, actionId: $json.actionId }) }}' } }),
  baseWorkflow({ id: 'CRM02ContactUpsert', name: 'CRM-02 Contact Upsert', webhookPath: 'crm-contact-upsert', workflowKey: 'crm.lead.create', contract: 'crm-contact-upsert-v1', target: { name: 'Internal CRM Upsert', method: 'POST', url: '={{ "http://api:4000/api/v1/internal/crm/leads" }}', body: '={{ JSON.stringify({ actionId: $json.actionId, tenantId: $json.tenantId, sessionId: $json.sessionId, leadData: $json.leadData, intent: $json.intent, intentScore: $json.intentScore, intentConfidence: $json.intentConfidence, catalogVersionId: $json.catalogVersionId, score: $json.score, validationPass: $json.validationPass, conversation: $json.conversation, completeAction: false }) }}' } }),
  baseWorkflow({ id: 'CRM03SummarySync', name: 'CRM-03 Summary Sync', webhookPath: 'crm-summary-sync', workflowKey: 'crm.lead.summary.sync', contract: 'crm-summary-sync-v1', target: { name: 'Internal CRM Summary', method: 'PUT', url: '={{ "http://api:4000/api/v1/internal/crm/leads/" + $json.leadId + "/summary" }}', body: '={{ JSON.stringify({ tenantId: $json.tenantId, summary: $json.summary, status: $json.status || "completed" }) }}' } }),
  baseWorkflow({ id: 'DOC01DocumentProcessing', name: 'DOC-01 Document Processing Request', webhookPath: 'document-processing-request', workflowKey: 'anc.document.ocr.extract', contract: 'anc-document-ocr-v1', target: { name: 'Queue Authorized OCR Job', method: 'POST', url: '={{ "http://api:4000/api/v1/internal/documents/" + $json.documentId + "/process" }}', body: '={{ JSON.stringify({ tenantId: $json.tenantId, jobId: $json.jobId }) }}' } }),
];
const intentKeys = ['ancfz.int_01', 'ancfz.int_02', 'ancfz.int_03', 'ancfz.int_04', 'ancfz.int_05', 'ancfz.int_06', 'ancfz.int_07', 'ancfz.int_08', 'ancfz.int_09', 'ancfz.int_10', 'ancfz.int_11', 'ancfz.int_12', 'ancfz.int_13'];
for (const intentKey of intentKeys) {
  const workflowKey = `anc.${intentKey.replace(/[^a-z0-9]+/gi, '.').replace(/\.+/g, '.').replace(/\.$/u, '')}.request`;
  workflows.push(baseWorkflow({ id: `INTENT${intentKey.replace(/[^a-z0-9]/gi, '')}`, name: `INTENT-${intentKey}`, webhookPath: `intent-${esc(intentKey)}`, workflowKey, contract: 'omnichannel-intent-v1', target: { name: 'Internal Intent CRM Upsert', method: 'POST', url: '={{ "http://api:4000/api/v1/internal/crm/leads" }}', body: '={{ JSON.stringify({ actionId: $json.actionId, tenantId: $json.tenantId, sessionId: $json.sessionId, leadData: $json.leadData, intent: $json.intent, intentScore: $json.intentScore, intentConfidence: $json.intentConfidence, catalogVersionId: $json.catalogVersionId, score: $json.score, validationPass: $json.validationPass, conversation: $json.conversation, completeAction: false }) }}' } }));
}
for (const workflow of workflows) await fs.writeFile(path.join(out, `${workflow.id}.json`), `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ generated: workflows.map((workflow) => workflow.name), count: workflows.length }));
