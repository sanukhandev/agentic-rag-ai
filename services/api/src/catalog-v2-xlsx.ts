import type { CatalogV2Document } from './catalog-v2.js';
import { exportWorkbookSheets, type SheetDefinition } from './intent-catalog-xlsx.js';

const headers: Record<string, string[]> = {
  README: ['key', 'value'],
  CatalogManifest: ['schema_version', 'catalog_key', 'tenant_scope', 'revision', 'policy_version'],
  BusinessGoals: ['business_goal_key', 'name', 'description', 'active', 'confirmation_required', 'completion_policy_key'],
  IntentCategories: ['category_key', 'name', 'active'],
  TurnIntents: ['turn_intent_key', 'category_key', 'business_goal_key', 'active'],
  IntentSignals: ['signal_id', 'target_key', 'signal_type', 'value', 'language', 'weight', 'min_weight', 'max_weight'],
  ScoringPolicies: ['scoring_policy_key', 'business_goal_key', 'threshold', 'ambiguity_margin', 'policy_version'],
  RequirementPolicies: ['requirement_key', 'goal_key', 'stage_key', 'type', 'required', 'dependencies', 'validation', 'source_of_truth', 'prompt_key', 'priority'],
  BusinessStages: ['business_goal_key', 'stage_key', 'stage_order', 'entry_requirements', 'completion_evidence_policy_key', 'active'],
  ToolBindings: ['tool_key', 'goal_key', 'stage_key', 'side_effect_class', 'arguments_schema_ref', 'required_keys', 'consent', 'confirmation', 'registry_key', 'enabled'],
  WorkflowBindings: ['workflow_key', 'registry_key', 'provider_type', 'payload_schema_ref', 'callback_schema_ref', 'evidence_policy_key', 'enabled'],
  FollowUpPolicies: ['policy_key', 'goal_key', 'stage_key', 'requirement_key', 'priority', 'no_question_reasons'],
  KnowledgeTopics: ['topic_key', 'goal_key', 'source_scope', 'citation_required', 'active'],
  PersonaPolicies: ['persona_policy_key', 'persona_version_id', 'permitted_languages', 'fallback_template_ref', 'enabled'],
  DocumentPolicies: ['policy_key', 'goal_key', 'stage_key', 'doc_type', 'required', 'mime_types', 'review_policy', 'retention_class', 'enabled'],
};

const camel = (value: string): string => value.replace(/_([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
const cell = (value: unknown): string | number | boolean | null => Array.isArray(value) ? JSON.stringify(value) : value === undefined ? null : value as string | number | boolean | null;

export const exportCatalogV2Workbook = (catalog: CatalogV2Document): Buffer => {
  const sheets: SheetDefinition[] = Object.entries(catalog.sheets).map(([name, rows]) => ({
    name,
    headers: headers[name] ?? [],
    rows: (rows as Array<Record<string, unknown>>).map((row) => (headers[name] ?? []).map((header) => cell(row[camel(header)]))),
  }));
  return exportWorkbookSheets(sheets);
};
