// Read-only Stage 1–5 readiness probe. No network, database, provider or file writes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const STAGE_KEYS = Object.freeze([
  'lead_generation', 'lead_qualification', 'account_creation',
  'package_selection', 'document_upload',
]);

const loadFixture = () => JSON.parse(readFileSync(
  fileURLToPath(new URL('../../services/api/src/fixtures/ancfz-catalog-v2.json', import.meta.url)),
  'utf8',
));

export function assessStage5Catalog(document) {
  const errors = [];
  const warnings = [];
  if (document.schemaVersion !== 2 || !document.sheets) {
    return { status: 'BLOCKED', errors: ['catalog_v2_required'], warnings, stages: [] };
  }
  const goal = 'anc.company_formation';
  const stages = document.sheets.BusinessStages.filter(row => row.businessGoalKey === goal && row.active)
    .sort((a, b) => a.stageOrder - b.stageOrder);
  for (const [index, key] of STAGE_KEYS.entries()) {
    if (!stages[index] || stages[index].stageKey !== key || stages[index].stageOrder !== index + 1) {
      errors.push('stage_order_missing_or_invalid:' + key);
    }
  }
  const qualification = stages.find(s => s.stageKey === 'lead_qualification');
  const qualificationFacts = ['business_activity', 'entity_type', 'visa_count', 'timeline'];
  for (const fact of qualificationFacts) {
    if (!qualification?.entryRequirements.includes(fact)) errors.push('qualification_fact_missing:' + fact);
  }
  if (!stages.find(s => s.stageKey === 'document_upload')?.completionEvidencePolicyKey.includes('sf02')) {
    errors.push('document_sf02_evidence_policy_missing');
  }
  for (const key of ['lead_generation', 'account_creation', 'package_selection', 'document_upload']) {
    const tool = document.sheets.ToolBindings?.find(row =>
      row.enabled && row.stageKey === key && row.sideEffectClass !== 'read_only');
    if (!tool) warnings.push('no_active_stage_action_binding:' + key);
  }
  const stage5 = stages.find(s => s.stageKey === 'document_upload');
  if (!stage5) errors.push('document_stage_missing');
  const status = errors.length ? 'BLOCKED' : warnings.length ? 'POLICY_DEFINED_ACTIONS_UNREADY' : 'CATALOG_STATIC_PREFLIGHT_PASS';
  return { status, errors, warnings, stages: STAGE_KEYS };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replaceAll('\\', '/')) {
  const report = assessStage5Catalog(loadFixture());
  console.log(JSON.stringify({
    suite: 'stage1-5-static-catalog-preflight', ...report,
    liveConversation: 'NOT_TESTED', providerWrites: 'NONE', databaseAccess: 'NONE',
  }, null, 2));
  if (report.errors.length || (process.argv.includes('--strict') && report.warnings.length)) {
    process.exitCode = 2;
  }
}
