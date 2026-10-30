import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogV2Sha256, catalogV2VersionRef, createLegacyCatalogMigrationCandidate, validateCatalogV2, type CatalogV2Document } from './catalog-v2.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')) as unknown;
const scenarios = JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2-scenarios.json', import.meta.url), 'utf8')) as { persona: { name: string; permittedLanguages: string[]; status: string }; qualificationVariants: Array<{ visaCount: number }>; remoteWritePolicy: { enabledToolCount: number; enabledWorkflowCount: number; providerEvidenceRequired: boolean } };

describe('strict catalog v2 contract', () => {
  it('accepts the valid ANCFZ reference and produces a stable immutable version reference', () => {
    const result = validateCatalogV2(fixture);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.document).not.toBeNull();
    const catalog = result.document as CatalogV2Document;
    const hash = catalogV2Sha256(catalog);
    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(catalogV2VersionRef(catalog)).toBe(`ancfz:r1:${hash}`);
  });

  it('covers the approved persona, qualification variants and disabled remote writes', () => {
    const result = validateCatalogV2(fixture);
    expect(result.ok).toBe(true);
    expect(scenarios.persona).toEqual({ name: 'Zara', permittedLanguages: ['en'], status: 'published_reference_only' });
    expect(scenarios.qualificationVariants.map((variant) => variant.visaCount)).toEqual([3, 5]);
    expect(scenarios.remoteWritePolicy).toEqual({ enabledToolCount: 0, enabledWorkflowCount: 0, providerEvidenceRequired: true });
    const catalog = result.document as CatalogV2Document;
    expect(catalog.sheets.ToolBindings.filter((tool) => tool.enabled && tool.sideEffectClass !== 'read_only')).toHaveLength(0);
    expect(catalog.sheets.WorkflowBindings.filter((binding) => binding.enabled)).toHaveLength(0);
    expect(catalog.sheets.BusinessStages).toHaveLength(7);
  });

  it('rejects v1 and unversioned input at the v2 boundary', () => {
    expect(validateCatalogV2({ version: 1, intents: [] }).ok).toBe(false);
    expect(validateCatalogV2({ manifest: {}, sheets: {} }).ok).toBe(false);
  });

  it('rejects unknown executable sheets and orphan references', () => {
    const unknownSheet = structuredClone(fixture) as Record<string, unknown>;
    (unknownSheet.sheets as Record<string, unknown>).UnsafeWorkflowUrls = [];
    expect(validateCatalogV2(unknownSheet).errors.some(error => error.includes('Unrecognized key'))).toBe(true);

    const orphaned = structuredClone(fixture) as Record<string, unknown>;
    const goals = (orphaned.sheets as Record<string, unknown>).BusinessGoals as Array<Record<string, unknown>>;
    goals[0] = { ...goals[0], businessGoalKey: 'missing.goal' };
    expect(validateCatalogV2(orphaned).errors.some(error => error.includes('unknown goal'))).toBe(true);
  });

  it('rejects non-contiguous stages and unapproved side-effect bindings', () => {
    const invalid = structuredClone(fixture) as Record<string, unknown>;
    const sheets = invalid.sheets as Record<string, unknown>;
    const stages = sheets.BusinessStages as Array<Record<string, unknown>>;
    stages[1] = { ...stages[1], stageOrder: 4 };
    const tools = sheets.ToolBindings as Array<Record<string, unknown>>;
    tools[1] = { ...tools[1], consent: 'none' };
    const result = validateCatalogV2(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.some(error => error.includes('stageOrder'))).toBe(true);
    expect(result.errors.some(error => error.includes('side-effect proposals require'))).toBe(true);
  });

  it('creates a hash-bound review-only legacy migration candidate', () => {
    const candidate = createLegacyCatalogMigrationCandidate({ version: 1, intents: [{ intentKey: 'legacy' }] });
    expect(candidate.status).toBe('review_required');
    expect(candidate.autoPublish).toBe(false);
    expect(candidate.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(candidate.warnings).toHaveLength(3);
  });
});
