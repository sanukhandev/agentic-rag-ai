import { catalogV2VersionRef, type CatalogV2Document, validateCatalogV2 } from './catalog-v2.js';

type Catalog = CatalogV2Document;

export interface CatalogV2RuntimeValidation {
  ok: boolean;
  errors: string[];
  catalog: Catalog | null;
}

export interface CatalogV2RuntimeOptions {
  published: boolean;
  tenantScope: string;
  pinnedVersionRef: string;
}

export interface CatalogV2ScoreInput {
  businessGoalKey: string;
  matchedSignalIds: string[];
  runnerUpScore?: number;
  verifiedRequirementKeys: string[];
  currentStageKey: string | null;
  goalConfirmed: boolean;
}

export interface CatalogV2Score {
  evidenceScore: number;
  threshold: number;
  thresholdMet: boolean;
  ambiguityMargin: number;
  ambiguous: boolean;
  confidenceBand: 'low' | 'medium' | 'high';
  verifiedRequirementCoverage: number;
  missingRequirementKeys: string[];
  actionReadiness: { eligible: boolean; reasons: string[] };
}

export interface CatalogV2StagePolicy {
  stageKey: string;
  missingEntryRequirements: string[];
  eligible: boolean;
}

const uniqueErrors = (values: string[]): string[] => [...new Set(values)];
const duplicates = (values: string[]): string[] => values.filter((value, index) => values.indexOf(value) !== index);
const evidenceClassIsUnsafe = (value: string): boolean => /^(?:model|llm|gpt|n8n(?:[._-]execution)?|http)/iu.test(value);

const cycleErrors = (catalog: Catalog): string[] => {
  const errors: string[] = [];
  const byKey = new Map<string, Catalog['sheets']['RequirementPolicies'][number]>(catalog.sheets.RequirementPolicies.map(row => [`${row.goalKey}:${row.requirementKey}`, row] as const));
  const visit = (key: string, path: Set<string>): void => {
    if (path.has(key)) { errors.push(`RequirementPolicies.${key}: dependency cycle.`); return; }
    const row = byKey.get(key);
    if (!row) return;
    const next = new Set(path).add(key);
    for (const dependency of row.dependencies) visit(`${row.goalKey}:${dependency}`, next);
  };
  for (const key of byKey.keys()) visit(key, new Set());
  return errors;
};

const duplicateErrors = (catalog: Catalog): string[] => [
  ['BusinessGoals', catalog.sheets.BusinessGoals.map(row => row.businessGoalKey)],
  ['IntentCategories', catalog.sheets.IntentCategories.map(row => row.categoryKey)],
  ['TurnIntents', catalog.sheets.TurnIntents.map(row => row.turnIntentKey)],
  ['IntentSignals', catalog.sheets.IntentSignals.map(row => row.signalId)],
  ['ScoringPolicies', catalog.sheets.ScoringPolicies.map(row => row.scoringPolicyKey)],
  ['RequirementPolicies', catalog.sheets.RequirementPolicies.map(row => `${row.goalKey}:${row.requirementKey}`)],
  ['BusinessStages', catalog.sheets.BusinessStages.map(row => `${row.businessGoalKey}:${row.stageKey}`)],
  ['ToolBindings', catalog.sheets.ToolBindings.map(row => row.toolKey)],
  ['WorkflowBindings', catalog.sheets.WorkflowBindings.map(row => row.registryKey)],
  ['FollowUpPolicies', catalog.sheets.FollowUpPolicies.map(row => row.policyKey)],
  ['KnowledgeTopics', catalog.sheets.KnowledgeTopics.map(row => row.topicKey)],
  ['PersonaPolicies', catalog.sheets.PersonaPolicies.map(row => row.personaPolicyKey)],
  ['DocumentPolicies', catalog.sheets.DocumentPolicies.map(row => row.policyKey)],
].flatMap(([sheet, keys]) => duplicates(keys as string[]).map(key => `${sheet}.${key}: duplicate key.`));

const stagePolicyErrors = (catalog: Catalog): string[] => {
  const errors: string[] = [];
  const stages = new Map(catalog.sheets.BusinessStages.map(row => [`${row.businessGoalKey}:${row.stageKey}`, row] as const));
  const requirements = new Map(catalog.sheets.RequirementPolicies.map(row => [`${row.goalKey}:${row.requirementKey}`, row] as const));
  for (const row of catalog.sheets.BusinessStages) {
    for (const requirementKey of row.entryRequirements) {
      const requirement = requirements.get(`${row.businessGoalKey}:${requirementKey}`);
      if (requirement && stages.get(`${row.businessGoalKey}:${requirement.stageKey}`)!.stageOrder > row.stageOrder) errors.push(`BusinessStages.${row.stageKey}: later-stage requirement ${requirementKey} leaks backward.`);
    }
  }
  for (const row of catalog.sheets.RequirementPolicies) {
    const owner = stages.get(`${row.goalKey}:${row.stageKey}`);
    for (const dependencyKey of row.dependencies) {
      const dependency = requirements.get(`${row.goalKey}:${dependencyKey}`);
      const dependencyStage = dependency && stages.get(`${row.goalKey}:${dependency.stageKey}`);
      if (owner && dependencyStage && dependencyStage.stageOrder > owner.stageOrder) errors.push(`RequirementPolicies.${row.requirementKey}: dependency ${dependencyKey} is from a later stage.`);
    }
  }
  return errors;
};

export const validatePublishedCatalogV2 = (input: unknown, options: CatalogV2RuntimeOptions): CatalogV2RuntimeValidation => {
  const parsed = validateCatalogV2(input);
  if (!parsed.ok || !parsed.document) return { ok: false, errors: parsed.errors, catalog: null };
  const catalog = parsed.document;
  const errors = [
    ...duplicateErrors(catalog),
    ...cycleErrors(catalog),
    ...stagePolicyErrors(catalog),
    ...catalog.sheets.BusinessStages.flatMap(row => [row.completionEvidencePolicyKey]).filter(evidenceClassIsUnsafe).map(key => `BusinessStages: unsupported evidence class ${key}.`),
    ...catalog.sheets.WorkflowBindings.filter(row => row.enabled && !catalog.sheets.ToolBindings.some(tool => tool.registryKey === row.registryKey && tool.enabled)).map(row => `WorkflowBindings.${row.workflowKey}: enabled binding is not reachable from an enabled tool.`),
  ];
  if (!options.published) errors.push('Catalog is not published.');
  if (catalog.manifest.tenantScope !== options.tenantScope) errors.push('Catalog tenant scope does not match the trusted tenant.');
  if (catalogV2VersionRef(catalog) !== options.pinnedVersionRef) errors.push('Catalog version pin does not match canonical catalog identity.');
  return errors.length ? { ok: false, errors: uniqueErrors(errors), catalog: null } : { ok: true, errors: [], catalog };
};

export const evaluateCatalogV2Stage = (catalog: Catalog, businessGoalKey: string, stageKey: string, verifiedRequirementKeys: string[]): CatalogV2StagePolicy => {
  const stage = catalog.sheets.BusinessStages.find(row => row.businessGoalKey === businessGoalKey && row.stageKey === stageKey);
  if (!stage) return { stageKey, missingEntryRequirements: ['unknown_stage'], eligible: false };
  const verified = new Set(verifiedRequirementKeys);
  const missingEntryRequirements = stage.entryRequirements.filter(key => !verified.has(key));
  return { stageKey, missingEntryRequirements, eligible: missingEntryRequirements.length === 0 };
};

export const scoreCatalogV2Turn = (catalog: Catalog, input: CatalogV2ScoreInput): CatalogV2Score => {
  const policy = catalog.sheets.ScoringPolicies.find(row => row.businessGoalKey === input.businessGoalKey);
  const goal = catalog.sheets.BusinessGoals.find(row => row.businessGoalKey === input.businessGoalKey);
  const activeSignals = new Set(input.matchedSignalIds);
  const goalIntentKeys = new Set(catalog.sheets.TurnIntents.filter(row => row.businessGoalKey === input.businessGoalKey).map(row => row.turnIntentKey));
  goalIntentKeys.add(input.businessGoalKey);
  const evidenceScore = Math.max(0, Math.min(100, catalog.sheets.IntentSignals.filter(row => goalIntentKeys.has(row.targetKey) && activeSignals.has(row.signalId)).reduce((total, row) => total + row.weight, 0)));
  const threshold = policy?.threshold ?? 100;
  const ambiguityMargin = policy?.ambiguityMargin ?? 0;
  const ambiguous = input.runnerUpScore !== undefined && threshold > 0 && Math.abs(evidenceScore - input.runnerUpScore) <= ambiguityMargin;
  const stage = input.currentStageKey ? catalog.sheets.BusinessStages.find(row => row.businessGoalKey === input.businessGoalKey && row.stageKey === input.currentStageKey) : undefined;
  const required = stage?.entryRequirements ?? [];
  const verified = new Set(input.verifiedRequirementKeys);
  const missingRequirementKeys = required.filter(key => !verified.has(key));
  const verifiedRequirementCoverage = required.length === 0 ? 1 : (required.length - missingRequirementKeys.length) / required.length;
  const reasons: string[] = [];
  if (!goal?.active) reasons.push('goal_inactive');
  if (!policy) reasons.push('missing_scoring_policy');
  if (evidenceScore < threshold) reasons.push('insufficient_evidence');
  if (ambiguous) reasons.push('ambiguous');
  if (!input.goalConfirmed) reasons.push('goal_not_confirmed');
  if (missingRequirementKeys.length) reasons.push('requirements_missing');
  return {
    evidenceScore,
    threshold,
    thresholdMet: evidenceScore >= threshold,
    ambiguityMargin,
    ambiguous,
    confidenceBand: evidenceScore >= threshold ? 'high' : evidenceScore >= threshold * 0.5 ? 'medium' : 'low',
    verifiedRequirementCoverage,
    missingRequirementKeys,
    actionReadiness: { eligible: reasons.length === 0, reasons },
  };
};
