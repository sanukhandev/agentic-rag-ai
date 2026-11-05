import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { auditLegacyCatalogVersion, createLegacyCatalogV2Candidate, legacyCatalogAuditDigest } from './catalog-v2-migration.js';
import type { IntentCatalogVersion } from './types.js';

const catalog = JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const legacy: IntentCatalogVersion = {
  id: '11111111-1111-4111-8111-111111111111', tenantId: '22222222-2222-4222-8222-222222222222', version: 7, status: 'published',
  sourceFileName: 'legacy.xlsx', sourceHash: 'a'.repeat(64), parserVersion: 'intent-catalog-xlsx-1.2.0',
  catalog: { tenantScope: 'ancfz', intents: [{ intentKey: 'legacy', displayName: 'Legacy', description: '', category: 'service', workflowKey: 'legacy.workflow', minimumScore: 70, confidenceThreshold: 0.8, confirmationRequired: true, active: false, priority: 1, versionNote: '' }], signals: [], slots: [], relations: [], workflowBindings: [{ workflowKey: 'legacy.workflow', n8nWorkflowId: 'legacy', webhookPath: 'legacy', payloadContract: 'legacy', sideEffectClass: 'crm_write', active: false }] },
  createdAt: '2026-10-30T00:00:00.000Z', publishedAt: '2026-10-30T00:00:00.000Z',
};

describe('legacy v1 catalog audit and migration boundary', () => {
  it('audits history without exposing or mutating the legacy catalog', () => {
    const before = structuredClone(legacy);
    const audit = auditLegacyCatalogVersion(legacy);
    expect(audit).toMatchObject({ sourceVersionId: legacy.id, tenantId: legacy.tenantId, status: 'published', readOnly: true, preservedHistory: true, recordCounts: { intents: 1, workflowBindings: 1 } });
    expect(legacy).toEqual(before);
    expect(legacyCatalogAuditDigest(audit)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('requires a strict mapped v2 document and trusted tenant scope', () => {
    expect(() => createLegacyCatalogV2Candidate({ legacyVersion: legacy, tenantScope: 'ancfz', proposedCatalog: { version: 1 } })).toThrow('LEGACY_V2_MAPPING_INVALID');
    expect(() => createLegacyCatalogV2Candidate({ legacyVersion: legacy, tenantScope: 'other', proposedCatalog: catalog })).toThrow('LEGACY_V2_TENANT_MISMATCH');
  });

  it('creates an unpublished lineage-bound candidate without copying legacy state', () => {
    const candidate = createLegacyCatalogV2Candidate({ legacyVersion: legacy, tenantScope: 'ancfz', proposedCatalog: catalog });
    expect(candidate).toMatchObject({ sourceVersionId: legacy.id, sourceHash: legacy.sourceHash, status: 'review_required', autoPublish: false, targetTenantScope: 'ancfz' });
    expect(candidate.catalogVersionRef).toContain('ancfz:r1:');
    expect(candidate.warnings.join(' ')).toMatch(/not copied/u);
  });
});
