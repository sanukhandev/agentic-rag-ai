import fs from 'node:fs/promises';
import path from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const root = process.cwd();
const outputDir = path.join(root, 'examples');
const outputPath = path.join(outputDir, 'crm-lead-capture-intent-catalog.xlsx');
const previewPath = path.join(root, '.tmp-crm-intent-catalog-preview.png');
const headerStyle = { fill: '#1F4E78', font: { color: '#FFFFFF', bold: true }, horizontalAlignment: 'center', verticalAlignment: 'center', wrapText: true };
const bodyStyle = { font: { color: '#1F2937' }, verticalAlignment: 'center', wrapText: true };

const tables = {
  Intents: {
    headers: ['intent_key', 'display_name', 'description', 'category', 'workflow_key', 'minimum_score', 'confidence_threshold', 'confirmation_required', 'active', 'priority', 'version_note'],
    rows: [['lead.capture', 'Request a service', 'Capture a qualified CRM lead from a service or demo request.', 'sales', 'crm.lead.create', 70, 0.8, true, true, 100, 'Initial CRM lead capture catalog.']],
  },
  Signals: {
    headers: ['intent_key', 'signal_id', 'signal_type', 'value', 'language', 'match_mode', 'weight', 'relation_group', 'notes'],
    rows: [
      ['lead.capture', 'lead-demo', 'phrase', 'i need a demo', 'en', 'contains', 65, 'service_request', 'Strong demo request.'],
      ['lead.capture', 'lead-book-demo', 'phrase', 'book a demo', 'en', 'contains', 65, 'service_request', 'Strong demo request.'],
      ['lead.capture', 'lead-live-demo', 'phrase', 'live demo', 'en', 'contains', 65, 'service_request', 'Request to see a live demo.'],
      ['lead.capture', 'lead-schedule-demo', 'phrase', 'schedule a demo', 'en', 'contains', 65, 'service_request', 'Request to schedule a demo.'],
      ['lead.capture', 'lead-demo-keyword', 'keyword', 'demo', 'en', 'contains', 20, 'service_request', 'Demo qualifier.'],
      ['lead.capture', 'lead-schedule-call', 'phrase', 'schedule a call', 'en', 'contains', 70, 'service_request', 'Request to schedule a call.'],
      ['lead.capture', 'lead-book-call', 'phrase', 'book a call', 'en', 'contains', 70, 'service_request', 'Request to book a call.'],
      ['lead.capture', 'lead-connect-sanu', 'phrase', 'connect with sanu', 'en', 'contains', 70, 'service_request', 'Request to connect with Sanu.'],
      ['lead.capture', 'lead-call-sanu', 'phrase', 'call with sanu', 'en', 'contains', 70, 'service_request', 'Request to call Sanu.'],
      ['lead.capture', 'lead-talk-sanu', 'phrase', 'talk to sanu', 'en', 'contains', 70, 'service_request', 'Request to talk with Sanu.'],
      ['lead.capture', 'lead-let-him-know', 'phrase', 'let him know', 'en', 'contains', 70, 'service_request', 'Request to pass a message to Sanu.'],
      ['lead.capture', 'lead-can-let-him-know', 'phrase', 'can you let him know', 'en', 'contains', 70, 'service_request', 'Request to pass a message to Sanu.'],
      ['lead.capture', 'lead-tell-him-i-was-here', 'phrase', 'tell him i was here', 'en', 'contains', 70, 'service_request', 'Request to pass a message to Sanu.'],
      ['lead.capture', 'lead-pass-message', 'phrase', 'pass along a message', 'en', 'contains', 70, 'service_request', 'Request to pass a message to Sanu.'],
      ['lead.capture', 'lead-interested', 'phrase', 'interested in your services', 'en', 'contains', 55, 'service_request', 'Commercial intent.'],
      ['lead.capture', 'lead-interested-keyword', 'phrase', 'interested in', 'en', 'contains', 25, 'service_request', 'Commercial qualifier.'],
      ['lead.capture', 'lead-quote', 'keyword', 'quote', 'en', 'contains', 45, 'service_request', 'Commercial intent.'],
      ['lead.capture', 'lead-consultation', 'keyword', 'consultation', 'en', 'contains', 45, 'service_request', 'Commercial intent.'],
      ['lead.capture', 'lead-hire', 'keyword', 'hire', 'en', 'contains', 40, 'service_request', 'Commercial intent.'],
      ['lead.capture', 'lead-developer', 'keyword', 'developer', 'en', 'contains', 15, 'project_request', 'Project requirement qualifier.'],
      ['lead.capture', 'lead-erp', 'keyword', 'erp', 'en', 'contains', 15, 'project_request', 'Project domain qualifier.'],
      ['lead.capture', 'lead-erp-build', 'phrase', 'build an erp solution', 'en', 'contains', 35, 'project_request', 'ERP project qualifier.'],
      ['lead.capture', 'lead-build', 'keyword', 'build', 'en', 'contains', 10, 'project_request', 'Project requirement qualifier.'],
      ['lead.capture', 'lead-information', 'exclusion', 'what services do you offer', 'en', 'contains', -50, 'information_request', 'Informational questions must not create a lead.'],
    ],
  },
  Slots: {
    headers: ['intent_key', 'slot_key', 'data_type', 'required', 'alternative_group', 'collection_order', 'prompt_key', 'validation_rule', 'retention_class', 'quality_weight'],
    rows: [
      ['lead.capture', 'name', 'person_name', true, '', 1, 'lead.ask_name', 'token:NAME', 'pii', 50],
      ['lead.capture', 'email', 'email', false, 'contact', 2, 'lead.ask_contact', 'token:EMAIL', 'pii', 30],
      ['lead.capture', 'phone', 'phone', false, 'contact', 3, 'lead.ask_contact', 'token:PHONE', 'pii', 20],
    ],
  },
  Relations: {
    headers: ['source_intent', 'related_intent', 'relation_type', 'trigger_group', 'score_adjustment', 'minimum_cooccurrence', 'clarification_prompt_key'],
    rows: [],
  },
  WorkflowBindings: {
    headers: ['workflow_key', 'n8n_workflow_id', 'webhook_path', 'payload_contract', 'side_effect_class', 'active'],
    rows: [
      ['crm.lead.create', 'jMhE7ENPNNtLUFJm', 'lead-capture', 'crm-lead-v1', 'crm_write', true],
      ['crm.lead.quality.score', 'KW2teJmT6SdLV4ow', 'lead-quality-score', 'crm-lead-quality-v1', 'crm_write', true],
    ],
  },
  QualityRules: {
    headers: ['intent_key', 'quality_workflow_key', 'intent_weight', 'confidence_weight', 'contact_weight', 'hot_threshold', 'warm_threshold', 'nurture_threshold'],
    rows: [['lead.capture', 'crm.lead.quality.score', 0.6, 0.2, 0.2, 85, 70, 40]],
  },
};

const workbook = Workbook.create();
const readme = workbook.worksheets.add('README');
readme.showGridLines = false;
readme.getRange('A1:B7').values = [
  ['Tenant scope', 'sanu-khan'],
  ['Catalog purpose', 'CRM lead capture and catalog-driven lead quality scoring'],
  ['Trigger model', 'n8n polls approved actions; the API never invokes a workflow'],
  ['PII handling', 'Name, email, and phone remain reversible server-side tokens until authorized CRM display'],
  ['Lead workflow', 'crm.lead.create writes one deduplicated CRM lead'],
  ['Quality workflow', 'crm.lead.quality.score calculates score from this workbook only'],
  ['Version note', 'Sample catalog for local development and n8n smoke testing'],
];
readme.getRange('A1:A7').format = { font: { bold: true, color: '#1F4E78' }, verticalAlignment: 'center' };
readme.getRange('B1:B7').format = bodyStyle;
readme.getRange('A1:B7').format.borders = { preset: 'outside', style: 'thin', color: '#D9E2F3' };
readme.getRange('A1:A7').format.columnWidth = 24;
readme.getRange('B1:B7').format.columnWidth = 95;

for (const [name, definition] of Object.entries(tables)) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  const rowCount = definition.rows.length + 1;
  const columnCount = definition.headers.length;
  const endColumn = String.fromCharCode(64 + columnCount);
  const values = [definition.headers, ...definition.rows];
  sheet.getRange(`A1:${endColumn}${rowCount}`).values = values;
  sheet.getRange(`A1:${endColumn}1`).format = headerStyle;
  if (definition.rows.length) sheet.getRange(`A2:${endColumn}${rowCount}`).format = bodyStyle;
  sheet.getRange(`A1:${endColumn}${rowCount}`).format.borders = { preset: 'all', style: 'thin', color: '#D9E2F3' };
  sheet.getRange(`A1:${endColumn}${rowCount}`).format.autofitColumns();
  sheet.freezePanes.freezeRows(1);
  sheet.tables.add(`A1:${endColumn}${rowCount}`, true, `${name}Table`);
}

workbook.recalculate();
const inspection = await workbook.inspect({ kind: 'workbook,sheet,table', maxChars: 5000, tableMaxRows: 3, tableMaxCols: 5, tableMaxCellChars: 80 });
console.log(inspection.ndjson ?? inspection);
const preview = await workbook.render({ sheetName: 'README', autoCrop: 'all', scale: 1, format: 'png' });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
await fs.mkdir(outputDir, { recursive: true });
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);
console.log(`Wrote ${outputPath}`);
