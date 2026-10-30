import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { catalogV2VersionRef, validateCatalogV2 } from './catalog-v2.js';
import { evaluateCatalogV2Stage, scoreCatalogV2Turn, validatePublishedCatalogV2 } from './catalog-v2-runtime.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const catalog = fixture as never;

describe('catalog v2 runtime policy', () => {
  it('accepts only the trusted published tenant and canonical version pin', () => {
    const validated = validateCatalogV2(fixture);
    expect(validated.document).not.toBeNull();
    const version = catalogV2VersionRef(validated.document!);
    expect(validatePublishedCatalogV2(fixture, { published: true, tenantScope: 'ancfz', pinnedVersionRef: version }).ok).toBe(true);
    expect(validatePublishedCatalogV2(fixture, { published: false, tenantScope: 'ancfz', pinnedVersionRef: version }).errors).toContain('Catalog is not published.');
    expect(validatePublishedCatalogV2(fixture, { published: true, tenantScope: 'other', pinnedVersionRef: version }).errors).toContain('Catalog tenant scope does not match the trusted tenant.');
  });

  it('rejects dependency cycles and later-stage requirement leakage', () => {
    const invalid = structuredClone(fixture) as { sheets: Record<string, unknown[]> };
    const stages = invalid.sheets.BusinessStages as Array<Record<string, unknown>>;
    stages[0]!.entryRequirements = ['account_confirmation'];
    const requirements = invalid.sheets.RequirementPolicies as Array<Record<string, unknown>>;
    requirements[1]!.dependencies = ['account_confirmation'];
    const result = validatePublishedCatalogV2(invalid, { published: true, tenantScope: 'ancfz', pinnedVersionRef: 'wrong' });
    expect(result.errors.some(error => error.includes('leaks backward'))).toBe(true);
    expect(result.errors.some(error => error.includes('dependency cycle'))).toBe(true);
  });

  it('keeps evidence, ambiguity, coverage and action readiness separate', () => {
    const high = scoreCatalogV2Turn(catalog, { businessGoalKey: 'anc.company_formation', matchedSignalIds: ['signal.company.register'], runnerUpScore: 20, verifiedRequirementKeys: [], currentStageKey: 'lead_qualification', goalConfirmed: true });
    expect(high.evidenceScore).toBe(80);
    expect(high.confidenceBand).toBe('high');
    expect(high.thresholdMet).toBe(true);
    expect(high.actionReadiness.eligible).toBe(false);
    expect(high.actionReadiness.reasons).toContain('requirements_missing');
    const ambiguous = scoreCatalogV2Turn(catalog, { businessGoalKey: 'anc.company_formation', matchedSignalIds: ['signal.company.register'], runnerUpScore: 75, verifiedRequirementKeys: ['business_activity'], currentStageKey: 'lead_qualification', goalConfirmed: true });
    expect(ambiguous.ambiguous).toBe(true);
    expect(ambiguous.actionReadiness.reasons).toContain('ambiguous');
  });

  it('does not let a later document requirement block an earlier stage', () => {
    const stage = evaluateCatalogV2Stage(catalog, 'anc.company_formation', 'lead_generation', []);
    expect(stage.eligible).toBe(true);
    expect(stage.missingEntryRequirements).toEqual([]);
  });
});
