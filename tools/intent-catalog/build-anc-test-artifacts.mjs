import fs from 'node:fs/promises';
import path from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const root = process.cwd();
const outputDir = path.join(root, 'artifacts', 'anc-test');
const readJson = async (name) => JSON.parse((await fs.readFile(path.join(outputDir, name), 'utf8')).replace(/^\uFEFF/u, ''));
const source = await readJson('source-catalog.json');
const content = await readJson('content-catalog.json');
const sourceManifest = await readJson('manifest.json');
const headerStyle = { fill: '#1F4E78', font: { color: '#FFFFFF', bold: true }, horizontalAlignment: 'center', verticalAlignment: 'center', wrapText: true };
const bodyStyle = { font: { color: '#1F2937' }, verticalAlignment: 'center', wrapText: true };
const endColumn = (count) => { let result = ''; for (let value = count; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result; return result; };

const sourceIntents = source.catalog.intents.map((row) => ({
  intent_key: row.intentKey,
  display_name: row.displayName,
  description: row.description || 'Source catalog intent; review before publication.',
  category: row.category || 'support',
  workflow_key: `anc.${row.intentKey.replace(/[^a-z0-9]+/gi, '.').replace(/\.+/g, '.').replace(/\.$/u, '')}.request`,
  minimum_score: Number(row.minimumScore ?? 70),
  confidence_threshold: Number(row.confidenceThreshold ?? 0.8),
  confirmation_required: Boolean(row.confirmationRequired),
  active: false,
  priority: Number(row.priority ?? 0),
  version_note: 'Converted source row; inactive pending tenant review and workflow verification.',
}));
const intents = [
  ...sourceIntents,
  { intent_key: 'appointment.request', display_name: 'Request an appointment', description: 'Compatibility mapping for appointment slots and relations.', category: 'sales', workflow_key: 'calendar.appointment.create', minimum_score: 70, confidence_threshold: 0.8, confirmation_required: true, active: false, priority: 90, version_note: 'Compatibility mapping for existing appointment slots; inactive until workflow and consent review.' },
  { intent_key: 'lead.capture', display_name: 'Request a service', description: 'Capture a qualified contact request after explicit consent.', category: 'sales', workflow_key: 'crm.lead.create', minimum_score: 70, confidence_threshold: 0.8, confirmation_required: true, active: false, priority: 100, version_note: 'Compatibility mapping for existing CRM slots; inactive until workflow and consent review.' },
  { intent_key: 'document.intake', display_name: 'Submit supporting documents', description: 'Collect a catalog-authorized document after an active request asks for it.', category: 'support', workflow_key: 'document.intake', minimum_score: 70, confidence_threshold: 0.8, confirmation_required: true, active: false, priority: 80, version_note: 'Compatibility mapping for the document workflow; inactive until policy and OCR review.' },
  { intent_key: 'knowledge.enquiry', display_name: 'Ask about approved information', description: 'Answer source-grounded questions without creating a sales action.', category: 'information', workflow_key: 'human.review', minimum_score: 0, confidence_threshold: 0.8, confirmation_required: false, active: false, priority: 50, version_note: 'Knowledge-only route; inactive until a tenant-approved review binding is configured.' },
];
const sourceSignals = source.catalog.signals.map((row) => ({ intent_key: row.intentKey, signal_id: row.signalId, signal_type: row.signalType, value: row.value, language: row.language || 'en', match_mode: row.matchMode || 'contains', weight: Number(row.weight ?? 0), relation_group: row.relationGroup || '', notes: row.notes || 'Converted source signal.' }));
const slots = source.catalog.slots.map((row) => ({ intent_key: row.intentKey, slot_key: row.slotKey, data_type: row.dataType, required: Boolean(row.required), alternative_group: row.alternativeGroup || '', collection_order: Number(row.collectionOrder ?? 0), prompt_key: row.promptKey, validation_rule: row.validationRule, retention_class: row.retentionClass || 'session', quality_weight: Number(row.qualityWeight ?? 0) }));
slots.push(
  { intent_key: 'appointment.request', slot_key: 'contact_consent', data_type: 'boolean', required: true, alternative_group: '', collection_order: 4, prompt_key: 'lead.ask_consent', validation_rule: 'boolean:explicit_opt_in', retention_class: 'consent', quality_weight: 0 },
  { intent_key: 'lead.capture', slot_key: 'interest_summary', data_type: 'text', required: true, alternative_group: '', collection_order: 4, prompt_key: 'lead.ask_interest', validation_rule: 'text:nonempty', retention_class: 'business', quality_weight: 10 },
  { intent_key: 'lead.capture', slot_key: 'contact_consent', data_type: 'boolean', required: true, alternative_group: '', collection_order: 5, prompt_key: 'lead.ask_consent', validation_rule: 'boolean:explicit_opt_in', retention_class: 'consent', quality_weight: 0 },
  { intent_key: 'document.intake', slot_key: 'document_consent', data_type: 'boolean', required: true, alternative_group: '', collection_order: 1, prompt_key: 'document.ask_consent', validation_rule: 'boolean:explicit_opt_in', retention_class: 'consent', quality_weight: 0 },
);
// CRM writes require all three independently validated contact slots, never an either/or group.
for (const [field, order, promptKey, dataType, validationRule] of [
  ['name', 1, 'lead.ask_name', 'person_name', 'token:NAME'],
  ['email', 2, 'lead.ask_contact', 'email', 'token:EMAIL'],
  ['phone', 3, 'lead.ask_phone', 'phone', 'token:PHONE'],
]) {
  const current = slots.find((row) => row.intent_key === 'lead.capture' && row.slot_key === field);
  if (current) { current.required = true; current.alternative_group = ''; }
  else slots.push({ intent_key: 'lead.capture', slot_key: field, data_type: dataType, required: true, alternative_group: '', collection_order: order, prompt_key: promptKey, validation_rule: validationRule, retention_class: 'pii', quality_weight: 0 });
}
const relations = source.catalog.relations.map((row) => ({ source_intent: row.sourceIntent, related_intent: row.relatedIntent, relation_type: row.relationType, trigger_group: row.triggerGroup, score_adjustment: Number(row.scoreAdjustment ?? 0), minimum_cooccurrence: Number(row.minimumCooccurrence ?? 1), clarification_prompt_key: row.clarificationPromptKey }));
const bindings = [
  { workflow_key: 'crm.lead.create', n8n_workflow_id: 'jMhE7ENPNNtLUFJm', webhook_path: 'lead-capture', payload_contract: 'crm-lead-v1', side_effect_class: 'crm_write', active: false },
  { workflow_key: 'calendar.appointment.create', n8n_workflow_id: 'future-managed-id', webhook_path: 'appointment-request', payload_contract: 'appointment-v1', side_effect_class: 'calendar_write', active: false },
  { workflow_key: 'human.review', n8n_workflow_id: 'future-managed-id', webhook_path: 'human-review', payload_contract: 'human-review-v1', side_effect_class: 'human_review', active: false },
  ...sourceIntents.map((row) => ({ workflow_key: row.workflow_key, n8n_workflow_id: 'not-imported', webhook_path: `intent-${row.intent_key.replace(/[^a-z0-9]+/gi, '-')}`, payload_contract: 'omnichannel-intent-v1', side_effect_class: 'human_review', active: false })),
];
const journeyRequirements = [
  { intent_key: 'lead.capture', requirement_key: 'lead.interest-summary', requirement_type: 'slot', required: true, collection_order: 4, prompt_key: 'lead.ask_interest', validation_rule: 'text:nonempty', slot_key: 'interest_summary', document_type: '', fulfillment_mode: 'conversation_ready', source_of_truth: 'tenant_catalog', visitor_confirmation_text: '', notes: 'Visitor-supplied request context.' },
  { intent_key: 'lead.capture', requirement_key: 'lead.name', requirement_type: 'slot', required: true, collection_order: 1, prompt_key: 'lead.ask_name', validation_rule: 'token:NAME', slot_key: 'name', document_type: '', fulfillment_mode: 'conversation_ready', source_of_truth: 'tenant_catalog', notes: 'Validated visitor name.' },
  { intent_key: 'lead.capture', requirement_key: 'lead.email', requirement_type: 'slot', required: true, collection_order: 2, prompt_key: 'lead.ask_contact', validation_rule: 'token:EMAIL', slot_key: 'email', document_type: '', fulfillment_mode: 'conversation_ready', source_of_truth: 'tenant_catalog', notes: 'Validated visitor email.' },
  { intent_key: 'lead.capture', requirement_key: 'lead.phone', requirement_type: 'slot', required: true, collection_order: 3, prompt_key: 'lead.ask_contact', validation_rule: 'token:PHONE', slot_key: 'phone', document_type: '', fulfillment_mode: 'conversation_ready', source_of_truth: 'tenant_catalog', notes: 'Validated visitor phone.' },
  { intent_key: 'lead.capture', requirement_key: 'lead.contact-consent', requirement_type: 'consent', required: true, collection_order: 5, prompt_key: 'lead.ask_consent', validation_rule: 'boolean:explicit_opt_in', slot_key: 'contact_consent', document_type: '', fulfillment_mode: 'conversation_ready', source_of_truth: 'tenant_catalog', notes: 'Explicit purpose-bound contact consent.' },
  { intent_key: 'appointment.request', requirement_key: 'appointment.name', requirement_type: 'slot', required: true, collection_order: 1, prompt_key: 'lead.ask_name', validation_rule: 'token:NAME', slot_key: 'name', document_type: '', fulfillment_mode: 'conversation_ready', source_of_truth: 'tenant_catalog', notes: 'Validated visitor name.' },
  { intent_key: 'appointment.request', requirement_key: 'appointment.email', requirement_type: 'slot', required: true, collection_order: 2, prompt_key: 'lead.ask_contact', validation_rule: 'token:EMAIL', slot_key: 'email', document_type: '', fulfillment_mode: 'conversation_ready', source_of_truth: 'tenant_catalog', notes: 'Validated visitor email.' },
  { intent_key: 'appointment.request', requirement_key: 'appointment.time', requirement_type: 'slot', required: true, collection_order: 3, prompt_key: 'appointment.ask_time', validation_rule: 'datetime:future', slot_key: 'meeting_time', document_type: '', fulfillment_mode: 'conversation_ready', source_of_truth: 'tenant_catalog', notes: 'Visitor-supplied requested meeting time.' },
  { intent_key: 'appointment.request', requirement_key: 'appointment.contact-consent', requirement_type: 'consent', required: true, collection_order: 4, prompt_key: 'lead.ask_consent', validation_rule: 'boolean:explicit_opt_in', slot_key: 'contact_consent', document_type: '', fulfillment_mode: 'conversation_ready', source_of_truth: 'tenant_catalog', notes: 'Explicit purpose-bound appointment consent.' },
  { intent_key: 'document.intake', requirement_key: 'document.upload-consent', requirement_type: 'consent', required: true, collection_order: 1, prompt_key: 'document.ask_consent', validation_rule: 'boolean:explicit_opt_in', slot_key: 'document_consent', document_type: '', fulfillment_mode: 'conversation_ready', source_of_truth: 'tenant_catalog', notes: 'Explicit document-processing consent.' },
];
const journeyTransitions = [
  { source_intent_key: 'lead.capture', target_intent_key: 'appointment.request', activation_mode: 'offer', max_depth: 4, trigger_group: 'appointment_request', prompt_key: 'journey.offer_appointment', notes: 'Offer appointment scheduling after the lead journey is fulfilled.' },
  { source_intent_key: 'appointment.request', target_intent_key: 'document.intake', activation_mode: 'offer', max_depth: 4, trigger_group: 'supporting_documents', prompt_key: 'journey.offer_documents', notes: 'Offer document intake only after the appointment journey is fulfilled.' },
];
const documentRequirements = content.map((row) => ({ source_key: row.sourceKey, document_type: 'source-derived-rag-document', requirement_mode: 'knowledge-source', status: row.status, notes: 'Pattern-redacted; human review required before activation.' }));
const crmFieldMappings = [
  { provider: 'salesforce', object_name: 'Lead', source_field: 'name', remote_field: 'Name', retention_class: 'pii', required: true },
  { provider: 'salesforce', object_name: 'Lead', source_field: 'email', remote_field: 'Email', retention_class: 'pii', required: true },
  { provider: 'salesforce', object_name: 'Lead', source_field: 'phone', remote_field: 'Phone', retention_class: 'pii', required: true },
  { provider: 'salesforce', object_name: 'Lead', source_field: 'summary', remote_field: 'Description', retention_class: 'business_context', required: true },
];
const channelCapabilities = ['web', 'whatsapp', 'email', 'sms', 'voice'].map((channel) => ({ channel, text: true, postback: channel === 'web' || channel === 'whatsapp', attachment: channel === 'web' || channel === 'whatsapp', server_authenticated: true }));
const testUtterances = [
  ['en', 'company formation', 'I need to set up a company'],
  ['en', 'business activity', 'I need help with a business licence'],
  ['en', 'quotation', 'Please send me a quote'],
  ['en', 'visa', 'How many visas can I request?'],
  ['en', 'support', 'I need help tracking my application'],
  ['ar', 'company formation', 'أريد تأسيس شركة'],
].map(([language, label, utterance], index) => ({ test_id: `source-${index + 1}`, language, label, utterance, expected_mode: 'catalog-review' }));
const catalogManifest = [
  { key: 'schemaVersion', value: 'catalog-v2' },
  { key: 'tenantScope', value: 'anc-test' },
  { key: 'sourceCatalogHash', value: source.sourceHash },
  { key: 'status', value: 'draft' },
  { key: 'publication', value: 'not performed' },
  { key: 'workflowBindingPolicy', value: 'inactive until n8n IDs are verified' },
];

const writeWorkbook = async (fileName, readmeRows, tables, readmePreviewName) => {
  const workbook = Workbook.create();
  const readme = workbook.worksheets.add('README');
  readme.showGridLines = false;
  readme.getRange(`A1:B${readmeRows.length}`).values = readmeRows;
  readme.getRange(`A1:A${readmeRows.length}`).format = { font: { bold: true, color: '#1F4E78' }, verticalAlignment: 'center' };
  readme.getRange(`B1:B${readmeRows.length}`).format = bodyStyle;
  readme.getRange(`A1:A${readmeRows.length}`).format.columnWidth = 28;
  readme.getRange(`B1:B${readmeRows.length}`).format.columnWidth = 100;
  for (const [name, definition] of Object.entries(tables)) {
    const sheet = workbook.worksheets.add(name);
    sheet.showGridLines = false;
    const values = [definition.headers, ...definition.rows];
    const lastColumn = endColumn(definition.headers.length);
    const lastRow = values.length;
    sheet.getRange(`A1:${lastColumn}${lastRow}`).values = values;
    sheet.getRange(`A1:${lastColumn}1`).format = headerStyle;
    if (definition.rows.length) sheet.getRange(`A2:${lastColumn}${lastRow}`).format = bodyStyle;
    sheet.getRange(`A1:${lastColumn}${lastRow}`).format.borders = { preset: 'all', style: 'thin', color: '#D9E2F3' };
    sheet.getRange(`A1:${lastColumn}${lastRow}`).format.autofitColumns();
    sheet.freezePanes.freezeRows(1);
    sheet.tables.add(`A1:${lastColumn}${lastRow}`, true, `${name}Table`);
  }
  workbook.recalculate();
  const inspection = await workbook.inspect({ kind: 'workbook,sheet,table', maxChars: 8000, tableMaxRows: 3, tableMaxCols: 6, tableMaxCellChars: 100 });
  console.log(inspection.ndjson ?? inspection);
  if (process.env.SKIP_ARTIFACT_RENDER !== '1') {
    const preview = await workbook.render({ sheetName: 'README', autoCrop: 'all', scale: 1, format: 'png' });
    await fs.writeFile(path.join(outputDir, readmePreviewName), new Uint8Array(await preview.arrayBuffer()));
  }
  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  await xlsx.save(path.join(outputDir, fileName));
};

await writeWorkbook('ANCFZ_Intent_Catalog_Updated.xlsx', [
  ['Tenant scope', 'anc-test'],
  ['Catalog status', 'Draft; publication is intentionally disabled pending review.'],
  ['Source workbook hash', source.sourceHash],
  ['Intent count', String(intents.length)],
  ['PII policy', 'Contact fields remain server-side tokens; explicit consent is required.'],
  ['Workflow policy', 'Bindings are inactive until n8n IDs, security review and tenant approval are verified.'],
], {
  Intents: { headers: ['intent_key', 'display_name', 'description', 'category', 'workflow_key', 'minimum_score', 'confidence_threshold', 'confirmation_required', 'active', 'priority', 'version_note'], rows: intents.map((row) => Object.values(row)) },
  Signals: { headers: ['intent_key', 'signal_id', 'signal_type', 'value', 'language', 'match_mode', 'weight', 'relation_group', 'notes'], rows: sourceSignals.map((row) => Object.values(row)) },
  Slots: { headers: ['intent_key', 'slot_key', 'data_type', 'required', 'alternative_group', 'collection_order', 'prompt_key', 'validation_rule', 'retention_class', 'quality_weight'], rows: slots.map((row) => Object.values(row)) },
  Relations: { headers: ['source_intent', 'related_intent', 'relation_type', 'trigger_group', 'score_adjustment', 'minimum_cooccurrence', 'clarification_prompt_key'], rows: relations.map((row) => Object.values(row)) },
  WorkflowBindings: { headers: ['workflow_key', 'n8n_workflow_id', 'webhook_path', 'payload_contract', 'side_effect_class', 'active'], rows: bindings.map((row) => Object.values(row)) },
  JourneyRequirements: { headers: ['intent_key', 'requirement_key', 'requirement_type', 'required', 'collection_order', 'prompt_key', 'validation_rule', 'slot_key', 'document_type', 'fulfillment_mode', 'source_of_truth', 'visitor_confirmation_text', 'notes'], rows: journeyRequirements.map((row) => [row.intent_key, row.requirement_key, row.requirement_type, row.required, row.collection_order, row.prompt_key, row.validation_rule, row.slot_key, row.document_type, row.fulfillment_mode, row.source_of_truth, row.visitor_confirmation_text ?? '', row.notes]) },
  JourneyTransitions: { headers: ['source_intent_key', 'target_intent_key', 'activation_mode', 'max_depth', 'trigger_group', 'prompt_key', 'notes'], rows: journeyTransitions.map((row) => Object.values(row)) },
  DocumentRequirements: { headers: ['source_key', 'document_type', 'requirement_mode', 'status', 'notes'], rows: documentRequirements.map((row) => Object.values(row)) },
  CRMFieldMappings: { headers: ['provider', 'object_name', 'source_field', 'remote_field', 'retention_class', 'required'], rows: crmFieldMappings.map((row) => Object.values(row)) },
  ChannelCapabilities: { headers: ['channel', 'text', 'postback', 'attachment', 'server_authenticated'], rows: channelCapabilities.map((row) => Object.values(row)) },
  TestUtterances: { headers: ['test_id', 'language', 'label', 'utterance', 'expected_mode'], rows: testUtterances.map((row) => Object.values(row)) },
  CatalogManifest: { headers: ['key', 'value'], rows: catalogManifest.map((row) => Object.values(row)) },
}, 'intent-catalog-readme.png');

await writeWorkbook('ANCFZ_Training_Content_Catalog.xlsx', [
  ['Tenant scope', 'anc-test'],
  ['Catalog status', 'Draft; source content awaits human review and tenant publication.'],
  ['Source ZIP hash', sourceManifest.sourceZipSha256],
  ['Source count', String(content.length)],
  ['Chunk count', String(content.reduce((sum, row) => sum + Number(row.chunkCount), 0))],
], {
  Sources: { headers: ['tenant_scope', 'source_key', 'title', 'source_file', 'mime_type', 'source_sha256', 'artifact_path', 'chunk_count', 'visibility', 'status', 'pii_screening'], rows: content.map((row) => [row.tenantScope, row.sourceKey, row.title, row.sourceFile, row.mimeType, row.sourceSha256, row.artifactPath, row.chunkCount, row.visibility, row.status, row.piiScreening]) },
}, 'content-catalog-readme.png');

// shortcut: artifact-tool's Windows worker crashes during teardown after all files are saved; exit cleanly here.
process.exit(0);
