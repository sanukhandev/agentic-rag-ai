import { createHash } from 'node:crypto';
import { z } from 'zod';

export const CATALOG_V2_SCHEMA_VERSION = 2 as const;

const key = z.string().trim().regex(/^[a-z][a-z0-9._-]{1,79}$/u);
const label = z.string().trim().min(1).max(500);
const boundedText = z.string().trim().max(4_000);
const nullableKey = key.nullable();
const category = z.enum([
  'business_goal',
  'knowledge_advisory',
  'qualification_requirement',
  'service_execution',
  'service_status_support',
  'conversation_navigation',
]);
const stage = z.object({
  businessGoalKey: key,
  stageKey: key,
  stageOrder: z.number().int().min(1).max(100),
  entryRequirements: z.array(key).max(100),
  completionEvidencePolicyKey: key,
  active: z.boolean(),
}).strict();

const sheetSchemas = {
  README: z.array(z.object({ key: label, value: boundedText }).strict()).max(200),
  CatalogManifest: z.array(z.object({
    schemaVersion: z.literal(2),
    catalogKey: key,
    tenantScope: label,
    revision: z.number().int().positive(),
    policyVersion: label,
  }).strict()).length(1),
  BusinessGoals: z.array(z.object({
    businessGoalKey: key,
    name: label,
    description: boundedText,
    active: z.boolean(),
    confirmationRequired: z.boolean(),
    completionPolicyKey: key,
  }).strict()).max(100),
  IntentCategories: z.array(z.object({
    categoryKey: category,
    name: label,
    active: z.boolean(),
  }).strict()).max(20),
  TurnIntents: z.array(z.object({
    turnIntentKey: key,
    categoryKey: category,
    businessGoalKey: nullableKey,
    active: z.boolean(),
  }).strict()).max(200),
  IntentSignals: z.array(z.object({
    signalId: key,
    targetKey: key,
    signalType: z.enum(['phrase', 'keyword', 'exclusion']),
    value: label,
    language: z.string().trim().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/u),
    weight: z.number().min(-100).max(100),
    minWeight: z.number().min(-100).max(100),
    maxWeight: z.number().min(-100).max(100),
  }).strict().superRefine((row, ctx) => {
    if (row.minWeight > row.maxWeight) ctx.addIssue({ code: 'custom', path: ['minWeight'], message: 'minWeight must not exceed maxWeight.' });
    if (row.weight < row.minWeight || row.weight > row.maxWeight) ctx.addIssue({ code: 'custom', path: ['weight'], message: 'weight must be within its approved bounds.' });
  })).max(500),
  ScoringPolicies: z.array(z.object({
    scoringPolicyKey: key,
    businessGoalKey: key,
    threshold: z.number().min(0).max(100),
    ambiguityMargin: z.number().min(0).max(100),
    policyVersion: label,
  }).strict()).max(100),
  RequirementPolicies: z.array(z.object({
    requirementKey: key,
    goalKey: key,
    stageKey: key,
    type: z.enum(['fact', 'document', 'consent', 'confirmation']),
    required: z.boolean(),
    dependencies: z.array(key).max(100),
    validation: label,
    sourceOfTruth: z.enum(['customer', 'catalog', 'node', 'provider']),
    promptKey: key,
    priority: z.number().int().min(0).max(10_000),
  }).strict()).max(500),
  QualificationPolicies: z.array(z.object({
    policyKey: key,
    goalKey: key,
    stageKey: key,
    factKey: key,
    operator: z.literal('equals'),
    values: z.array(label).min(1).max(50),
    outcome: z.enum(['disqualified', 'manual_review']),
    active: z.boolean(),
  }).strict()).max(200).default([]),
  BusinessStages: z.array(stage).max(100),
  ToolBindings: z.array(z.object({
    toolKey: key,
    goalKey: key,
    stageKey: key,
    sideEffectClass: z.enum(['read_only', 'proposal', 'external_write']),
    argumentsSchemaRef: key,
    requiredKeys: z.array(key).max(100),
    consent: z.enum(['none', 'purpose_specific']),
    confirmation: z.enum(['none', 'explicit_customer']),
    registryKey: nullableKey,
    enabled: z.boolean(),
  }).strict()).max(200),
  WorkflowBindings: z.array(z.object({
    workflowKey: key,
    registryKey: key,
    providerType: key,
    payloadSchemaRef: key,
    callbackSchemaRef: key,
    evidencePolicyKey: key,
    enabled: z.boolean(),
  }).strict()).max(200),
  FollowUpPolicies: z.array(z.object({
    policyKey: key,
    goalKey: key,
    stageKey: nullableKey,
    requirementKey: nullableKey,
    priority: z.number().int().min(0).max(10_000),
    noQuestionReasons: z.array(key).max(50),
  }).strict()).max(500),
  KnowledgeTopics: z.array(z.object({
    topicKey: key,
    goalKey: nullableKey,
    sourceScope: key,
    citationRequired: z.boolean(),
    active: z.boolean(),
  }).strict()).max(500),
  PersonaPolicies: z.array(z.object({
    personaPolicyKey: key,
    personaVersionId: label,
    permittedLanguages: z.array(z.string().trim().min(2).max(10)).min(1).max(20),
    fallbackTemplateRef: key,
    enabled: z.boolean(),
  }).strict()).max(100),
  DocumentPolicies: z.array(z.object({
    policyKey: key,
    goalKey: key,
    stageKey: key,
    docType: key,
    required: z.boolean(),
    mimeTypes: z.array(label).min(1).max(50),
    reviewPolicy: key,
    retentionClass: key,
    enabled: z.boolean(),
  }).strict()).max(500),
} as const;

const sheets = z.object(sheetSchemas).strict();
const document = z.object({
  schemaVersion: z.literal(2),
  manifest: z.object({
    schemaVersion: z.literal(2),
    catalogKey: key,
    tenantScope: label,
    revision: z.number().int().positive(),
    policyVersion: label,
  }).strict(),
  sheets,
}).strict();

export type CatalogV2Document = z.infer<typeof document>;
export type CatalogV2SheetName = keyof typeof sheetSchemas;
export const catalogV2SheetNames: readonly CatalogV2SheetName[] = Object.keys(sheetSchemas) as CatalogV2SheetName[];

export interface CatalogV2ValidationResult {
  ok: boolean;
  errors: string[];
  document: CatalogV2Document | null;
}

const issueText = (issue: z.core.$ZodIssue): string => {
  const path = issue.path.length ? issue.path.join('.') : 'catalog';
  return `${path}: ${issue.message}`;
};

const crossReferenceErrors = (catalog: CatalogV2Document): string[] => {
  const errors: string[] = [];
  const goals = new Set(catalog.sheets.BusinessGoals.map(row => row.businessGoalKey));
  const categories = new Set(catalog.sheets.IntentCategories.map(row => row.categoryKey));
  const intents = new Set(catalog.sheets.TurnIntents.map(row => row.turnIntentKey));
  const stages = new Set(catalog.sheets.BusinessStages.map(row => `${row.businessGoalKey}:${row.stageKey}`));
  const requirements = new Set(catalog.sheets.RequirementPolicies.map(row => `${row.goalKey}:${row.requirementKey}`));
  const workflowBindings = new Set(catalog.sheets.WorkflowBindings.map(row => row.registryKey));
  const tools = new Set(catalog.sheets.ToolBindings.map(row => row.toolKey));

  for (const row of catalog.sheets.BusinessGoals) {
    if (!catalog.sheets.ScoringPolicies.some(policy => policy.businessGoalKey === row.businessGoalKey)) errors.push(`BusinessGoals.${row.businessGoalKey}: missing ScoringPolicies row.`);
  }
  for (const row of catalog.sheets.IntentCategories) if (!categories.has(row.categoryKey)) errors.push(`IntentCategories.${row.categoryKey}: invalid category.`);
  for (const row of catalog.sheets.TurnIntents) {
    if (!categories.has(row.categoryKey)) errors.push(`TurnIntents.${row.turnIntentKey}: unknown category.`);
    if (row.businessGoalKey !== null && !goals.has(row.businessGoalKey)) errors.push(`TurnIntents.${row.turnIntentKey}: unknown business goal.`);
  }
  for (const row of catalog.sheets.IntentSignals) if (!goals.has(row.targetKey) && !intents.has(row.targetKey)) errors.push(`IntentSignals.${row.signalId}: unknown target key.`);
  for (const row of catalog.sheets.ScoringPolicies) if (!goals.has(row.businessGoalKey)) errors.push(`ScoringPolicies.${row.scoringPolicyKey}: unknown business goal.`);
  for (const row of catalog.sheets.RequirementPolicies) {
    if (!goals.has(row.goalKey)) errors.push(`RequirementPolicies.${row.requirementKey}: unknown goal.`);
    if (!stages.has(`${row.goalKey}:${row.stageKey}`)) errors.push(`RequirementPolicies.${row.requirementKey}: stage is not declared for its goal.`);
    for (const dependency of row.dependencies) if (!requirements.has(`${row.goalKey}:${dependency}`)) errors.push(`RequirementPolicies.${row.requirementKey}: unknown dependency ${dependency}.`);
  }
  for (const row of catalog.sheets.BusinessStages) if (!goals.has(row.businessGoalKey)) errors.push(`BusinessStages.${row.stageKey}: unknown business goal.`);
  for (const goalKey of goals) {
    const ordered = catalog.sheets.BusinessStages.filter(row => row.businessGoalKey === goalKey).sort((left, right) => left.stageOrder - right.stageOrder);
    for (const [index, row] of ordered.entries()) if (row.stageOrder !== index + 1) errors.push(`BusinessStages.${goalKey}: stageOrder must be contiguous from 1.`);
  }
  for (const row of catalog.sheets.ToolBindings) {
    if (!goals.has(row.goalKey)) errors.push(`ToolBindings.${row.toolKey}: unknown goal.`);
    if (!stages.has(`${row.goalKey}:${row.stageKey}`)) errors.push(`ToolBindings.${row.toolKey}: unknown stage.`);
    for (const requiredKey of row.requiredKeys) if (!requirements.has(`${row.goalKey}:${requiredKey}`)) errors.push(`ToolBindings.${row.toolKey}: unknown requirement ${requiredKey}.`);
    if (row.sideEffectClass === 'read_only' && (row.registryKey !== null || row.consent !== 'none' || row.confirmation !== 'none')) errors.push(`ToolBindings.${row.toolKey}: read_only tools cannot have provider or customer-action gates.`);
    if (row.sideEffectClass !== 'read_only' && (row.registryKey === null || row.consent !== 'purpose_specific' || row.confirmation !== 'explicit_customer')) errors.push(`ToolBindings.${row.toolKey}: side-effect proposals require registry, purpose consent and explicit confirmation.`);
    if (row.registryKey !== null && !workflowBindings.has(row.registryKey)) errors.push(`ToolBindings.${row.toolKey}: registry key is not declared in WorkflowBindings.`);
  }
  for (const row of catalog.sheets.FollowUpPolicies) {
    if (!goals.has(row.goalKey)) errors.push(`FollowUpPolicies.${row.policyKey}: unknown goal.`);
    if (row.stageKey !== null && !stages.has(`${row.goalKey}:${row.stageKey}`)) errors.push(`FollowUpPolicies.${row.policyKey}: unknown stage.`);
    if (row.requirementKey !== null && !requirements.has(`${row.goalKey}:${row.requirementKey}`)) errors.push(`FollowUpPolicies.${row.policyKey}: unknown requirement.`);
  }
  for (const row of catalog.sheets.KnowledgeTopics) if (row.goalKey !== null && !goals.has(row.goalKey)) errors.push(`KnowledgeTopics.${row.topicKey}: unknown goal.`);
  for (const row of catalog.sheets.DocumentPolicies) {
    if (!goals.has(row.goalKey)) errors.push(`DocumentPolicies.${row.policyKey}: unknown goal.`);
    if (!stages.has(`${row.goalKey}:${row.stageKey}`)) errors.push(`DocumentPolicies.${row.policyKey}: unknown stage.`);
  }
  for (const row of catalog.sheets.WorkflowBindings) if (tools.size === 0 && row.enabled) errors.push(`WorkflowBindings.${row.workflowKey}: enabled workflow has no declared tool binding.`);
  return errors;
};

export const validateCatalogV2 = (input: unknown): CatalogV2ValidationResult => {
  const parsed = document.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(issueText), document: null };
  const errors = crossReferenceErrors(parsed.data);
  return errors.length ? { ok: false, errors, document: null } : { ok: true, errors: [], document: parsed.data };
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([name, item]) => [name, canonicalize(item)]));
  }
  return value;
};

export const canonicalCatalogV2Json = (catalog: CatalogV2Document): string => JSON.stringify(canonicalize(catalog));
export const catalogV2Sha256 = (catalog: CatalogV2Document): string => createHash('sha256').update(canonicalCatalogV2Json(catalog), 'utf8').digest('hex');
export const catalogV2VersionRef = (catalog: CatalogV2Document): string => `${catalog.manifest.catalogKey}:r${catalog.manifest.revision}:${catalogV2Sha256(catalog)}`;

export interface LegacyCatalogMigrationCandidate {
  candidateId: string;
  sourceSchemaVersion: string;
  sourceHash: string;
  status: 'review_required';
  autoPublish: false;
  warnings: readonly string[];
}

export const createLegacyCatalogMigrationCandidate = (input: unknown): LegacyCatalogMigrationCandidate => {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const sourceSchemaVersion = typeof source.schemaVersion === 'string'
    ? source.schemaVersion
    : typeof source.version === 'string' ? source.version : 'unknown';
  const sourceHash = createHash('sha256').update(JSON.stringify(canonicalize(input)), 'utf8').digest('hex');
  return {
    candidateId: `legacy-v1-review:${sourceHash.slice(0, 24)}`,
    sourceSchemaVersion,
    sourceHash,
    status: 'review_required',
    autoPublish: false,
    warnings: [
      'Legacy input was not interpreted as an executable v2 catalog.',
      'A reviewer must map goals, stages, requirements, tools, workflows, evidence and persona references.',
      'Prior consent, actions and publication status are never carried into a v2 candidate.',
    ],
  };
};
