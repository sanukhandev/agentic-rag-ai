import type { CatalogV2Document } from './catalog-v2.js';

export interface V2QualificationFact {
  value: string | number | boolean;
  source: 'customer' | 'node' | 'provider';
  messageSequence: number;
  evidenceRefs: string[];
}

export interface V2QualificationDecision {
  status: 'qualified' | 'disqualified' | 'unknown' | 'manual_review';
  eligibleForAccountCreation: boolean;
  reasons: string[];
  requiredFactKeys: string[];
  missingFactKeys: string[];
  invalidFactKeys: string[];
  evidence: Record<string, string | number | boolean>;
  provenance: Record<string, { source: V2QualificationFact['source']; messageSequence: number; evidenceRefs: string[] }>;
}

const normalized = (value: string | number | boolean): string => String(value).trim().toLocaleLowerCase('en-US');

const validFact = (validation: string, value: string | number | boolean): boolean => {
  if (validation === 'integer.nonnegative') return typeof value === 'number' ? Number.isInteger(value) && value >= 0 : /^\d+$/u.test(String(value).trim());
  if (validation === 'number.nonnegative') return typeof value === 'number' ? Number.isFinite(value) && value >= 0 : /^(?:0|\d+(?:\.\d+)?)$/u.test(String(value).trim());
  return typeof value === 'string' ? value.trim().length > 0 : true;
};

export const evaluateV2Qualification = (catalog: CatalogV2Document, goalKey: string, stageKey: string, facts: Record<string, V2QualificationFact>): V2QualificationDecision => {
  const stage = catalog.sheets.BusinessStages.find((candidate) => candidate.businessGoalKey === goalKey && candidate.stageKey === stageKey);
  if (!stage) return { status: 'manual_review', eligibleForAccountCreation: false, reasons: ['stage_not_configured'], requiredFactKeys: [], missingFactKeys: [], invalidFactKeys: [], evidence: {}, provenance: {} };
  const requirements = new Map(catalog.sheets.RequirementPolicies.filter((requirement) => requirement.goalKey === goalKey && requirement.stageKey === stageKey).map((requirement) => [requirement.requirementKey, requirement]));
  const requiredFactKeys = stage.entryRequirements;
  const missingFactKeys = requiredFactKeys.filter((key) => !facts[key] || String(facts[key]!.value).trim() === '');
  const invalidFactKeys = requiredFactKeys.filter((key) => {
    const requirement = requirements.get(key);
    const fact = facts[key];
    return Boolean(fact && requirement && !validFact(requirement.validation, fact.value));
  });
  const unconfiguredKeys = requiredFactKeys.filter((key) => !requirements.has(key));
  const evidence = Object.fromEntries(requiredFactKeys.filter((key) => facts[key] && !invalidFactKeys.includes(key)).map((key) => [key, facts[key]!.value]));
  const provenance = Object.fromEntries(requiredFactKeys.filter((key) => facts[key] && !invalidFactKeys.includes(key)).map((key) => [key, { source: facts[key]!.source, messageSequence: facts[key]!.messageSequence, evidenceRefs: facts[key]!.evidenceRefs.slice(0, 16) }]));
  if (unconfiguredKeys.length) return { status: 'manual_review', eligibleForAccountCreation: false, reasons: ['requirements_unconfigured'], requiredFactKeys, missingFactKeys, invalidFactKeys, evidence, provenance };
  if (invalidFactKeys.length) return { status: 'unknown', eligibleForAccountCreation: false, reasons: invalidFactKeys.map((key) => `fact_invalid:${key}`), requiredFactKeys, missingFactKeys, invalidFactKeys, evidence, provenance };
  if (missingFactKeys.length) return { status: 'unknown', eligibleForAccountCreation: false, reasons: ['requirements_missing'], requiredFactKeys, missingFactKeys, invalidFactKeys, evidence, provenance };
  const disqualifiers = (catalog.sheets.QualificationPolicies ?? []).filter((policy) => policy.active && policy.goalKey === goalKey && policy.stageKey === stageKey && policy.operator === 'equals' && policy.values.some((value) => normalized(value) === normalized(facts[policy.factKey]?.value ?? '')));
  if (disqualifiers.some((policy) => policy.outcome === 'manual_review')) return { status: 'manual_review', eligibleForAccountCreation: false, reasons: disqualifiers.filter((policy) => policy.outcome === 'manual_review').map((policy) => `manual_review:${policy.policyKey}`), requiredFactKeys, missingFactKeys, invalidFactKeys, evidence, provenance };
  if (disqualifiers.length) return { status: 'disqualified', eligibleForAccountCreation: false, reasons: disqualifiers.map((policy) => `disqualified:${policy.policyKey}`), requiredFactKeys, missingFactKeys, invalidFactKeys, evidence, provenance };
  return { status: 'qualified', eligibleForAccountCreation: true, reasons: [], requiredFactKeys, missingFactKeys, invalidFactKeys, evidence, provenance };
};
