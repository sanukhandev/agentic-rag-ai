import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = 'C:/Users/SanuKarimullaKhan/Downloads/ANCFZ_Intent_Catalog_Review_Import_Fixed_2026-10-27.xlsx';
const outputPath = 'artifacts/ANCFZ_Intent_Catalog_Executable_Proposal_2026-10-28.xlsx';
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const header = { fill: '#1F4E78', font: { color: '#FFFFFF', bold: true }, horizontalAlignment: 'center', verticalAlignment: 'center', wrapText: true };
const body = { verticalAlignment: 'center', wrapText: true };
const slots = workbook.worksheets.getItem('Slots');
const slotRow = slots.getUsedRange().rowCount + 1;
slots.getRange(`A${slotRow}:J${slotRow}`).values = [['anc.setup.new_company','workspace_preference','enum',false,'',8,'setup.ask_workspace','enum:shared_office|private_office|none','business',0]];
const addTable = (name, headers, rows) => {
  const sheet = workbook.worksheets.add(name);
  const values = [headers, ...rows];
  const end = String.fromCharCode(64 + headers.length);
  sheet.getRange(`A1:${end}${values.length}`).values = values;
  sheet.getRange(`A1:${end}1`).format = header;
  sheet.getRange(`A2:${end}${values.length}`).format = body;
  sheet.getRange(`A1:${end}${values.length}`).format.autofitColumns();
  sheet.freezePanes.freezeRows(1);
};
addTable('JourneyRequirements', ['intent_key','requirement_key','requirement_type','required','collection_order','prompt_key','validation_rule','slot_key','document_type','fulfillment_mode','source_of_truth','visitor_confirmation_text','notes'], [
  ['anc.setup.new_company','setup.interest_summary','slot',true,1,'lead.ask_interest','text:nonempty','interest_summary','','conversation_ready','tenant_catalog','','Business enquiry summary.'],
  ['anc.setup.new_company','setup.business_activity','slot',true,2,'setup.ask_activity','text:nonempty','business_activity','','conversation_ready','tenant_catalog','','Activity remains subject to approved eligibility evidence.'],
  ['anc.setup.new_company','setup.visa_count','slot',false,7,'setup.ask_visa_count','number:nonnegative','visa_count','','conversation_ready','tenant_catalog','','Optional qualification fact.'],
  ['anc.setup.new_company','setup.workspace_preference','slot',false,8,'setup.ask_workspace','enum:shared_office|private_office|none','workspace_preference','','conversation_ready','tenant_catalog','','Requires approved package data before recommendation.'],
  ['anc.setup.new_company','setup.timeline','slot',false,9,'setup.ask_timeline','text:nonempty','timeline','','conversation_ready','tenant_catalog','','Customer-provided target timeline.'],
  ['anc.setup.new_company','setup.name','slot',true,80,'lead.ask_name','token:NAME','name','','conversation_ready','tenant_catalog','','Validated contact name.'],
  ['anc.setup.new_company','setup.email','slot',true,81,'lead.ask_contact','token:EMAIL','email','','conversation_ready','tenant_catalog','','Validated contact email.'],
  ['anc.setup.new_company','setup.phone','slot',true,82,'lead.ask_phone','token:PHONE','phone','','conversation_ready','tenant_catalog','','Validated contact phone.'],
  ['anc.setup.new_company','setup.contact_consent','consent',true,83,'lead.ask_consent','boolean:explicit_opt_in','contact_consent','','external_confirmation_required','tenant_catalog','','Purpose-bound CRM lead consent.'],
  ['anc.setup.new_company','setup.package_confirmation','confirmation',false,90,'package.ask_confirmation','boolean:explicit_opt_in','','','external_confirmation_required','tenant_catalog','','Only after an approved versioned package is selected.']
]);
addTable('JourneyTransitions', ['source_intent_key','target_intent_key','activation_mode','max_depth','trigger_group','prompt_key','notes'], [
  ['anc.setup.new_company','anc.sales.proposal','offer',2,'package_selection','journey.offer_package','Offer package exploration only after qualification.'],
  ['anc.sales.proposal','anc.document.supporting_upload','offer',2,'supporting_documents','journey.offer_documents','Offer documents only after authorized CRM/conversion prerequisites.']
]);
workbook.recalculate();
console.log((await workbook.inspect({ kind: 'workbook,sheet', maxChars: 5000 })).ndjson ?? 'inspection complete');
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
