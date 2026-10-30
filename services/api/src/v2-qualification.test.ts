import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateV2Qualification } from './v2-qualification.js';
import type { CatalogV2Document } from './catalog-v2.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')) as CatalogV2Document;
const facts = (overrides: Record<string, string | number> = {}) => ({
  business_activity: { value: 'technology services', source: 'customer' as const, messageSequence: 2, evidenceRefs: ['turn:2'] },
  entity_type: { value: 'new company', source: 'customer' as const, messageSequence: 3, evidenceRefs: ['turn:3'] },
  visa_count: { value: 3, source: 'customer' as const, messageSequence: 4, evidenceRefs: ['turn:4'] },
  timeline: { value: 'next quarter', source: 'customer' as const, messageSequence: 5, evidenceRefs: ['turn:5'] },
  ...Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, { value, source: 'customer' as const, messageSequence: 6, evidenceRefs: ['turn:6'] }])),
});

describe('v2 deterministic qualification policy', () => {
  it('qualifies only when every catalog stage requirement is valid and preserves provenance', () => {
    const decision = evaluateV2Qualification(fixture, 'anc.company_formation', 'lead_qualification', facts());
    expect(decision).toMatchObject({ status: 'qualified', eligibleForAccountCreation: true, missingFactKeys: [], invalidFactKeys: [] });
    expect(decision.provenance.visa_count).toMatchObject({ source: 'customer', messageSequence: 4, evidenceRefs: ['turn:4'] });
  });

  it('returns unknown for missing or invalid facts and never treats documents as qualification evidence', () => {
    const missing = evaluateV2Qualification(fixture, 'anc.company_formation', 'lead_qualification', facts({ visa_count: -1 }));
    expect(missing.status).toBe('unknown');
    expect(missing.reasons).toContain('fact_invalid:visa_count');
    const documentOnly = evaluateV2Qualification(fixture, 'anc.company_formation', 'lead_qualification', { document: { value: 'reviewed', source: 'provider', messageSequence: 8, evidenceRefs: ['document:1'] } });
    expect(documentOnly.reasons).toContain('requirements_missing');
    expect(documentOnly.eligibleForAccountCreation).toBe(false);
  });

  it('uses only explicit catalog disqualifiers and supports manual review', () => {
    const catalog = structuredClone(fixture);
    catalog.sheets.QualificationPolicies = [
      { policyKey: 'qualification.disqualify.activity', goalKey: 'anc.company_formation', stageKey: 'lead_qualification', factKey: 'business_activity', operator: 'equals', values: ['restricted activity'], outcome: 'disqualified', active: true },
      { policyKey: 'qualification.review.entity', goalKey: 'anc.company_formation', stageKey: 'lead_qualification', factKey: 'entity_type', operator: 'equals', values: ['unclear'], outcome: 'manual_review', active: true },
    ];
    expect(evaluateV2Qualification(catalog, 'anc.company_formation', 'lead_qualification', facts({ business_activity: 'restricted activity' }))).toMatchObject({ status: 'disqualified', eligibleForAccountCreation: false, reasons: ['disqualified:qualification.disqualify.activity'] });
    expect(evaluateV2Qualification(catalog, 'anc.company_formation', 'lead_qualification', facts({ entity_type: 'unclear' }))).toMatchObject({ status: 'manual_review', eligibleForAccountCreation: false, reasons: ['manual_review:qualification.review.entity'] });
  });

  it('does not enable Account creation for an unknown or disqualified result', () => {
    expect(evaluateV2Qualification(fixture, 'anc.company_formation', 'not-a-stage', facts()).eligibleForAccountCreation).toBe(false);
  });
});
