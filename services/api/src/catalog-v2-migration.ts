import { createHash } from 'node:crypto';
import type { IntentCatalogVersion } from './types.js';
import { catalogV2Sha256, catalogV2VersionRef, validateCatalogV2, type CatalogV2Document } from './catalog-v2.js';

export interface LegacyCatalogAudit {
  sourceVersionId: string;
  tenantId: string;
  version: number;
  status: IntentCatalogVersion['status'];
  sourceFileName: string;
  sourceHash: string;
  parserVersion: string;
  createdAt: string;
  publishedAt: string | null;
  recordCounts: { intents: number; signals: number; slots: number; relations: number; workflowBindings: number };
  readOnly: true;
  preservedHistory: true;
}

export interface LegacyCatalogV2Candidate {
  candidateId: string;
  sourceVersionId: string;
  sourceHash: string;
  targetTenantScope: string;
  status: 'review_required';
  autoPublish: false;
  catalog: CatalogV2Document;
  catalogVersionRef: string;
  warnings: readonly string[];
}

export interface LegacyCatalogV2CandidateInput {
  legacyVersion: IntentCatalogVersion;
  tenantScope: string;
  proposedCatalog: unknown;
}

export const auditLegacyCatalogVersion = (version: IntentCatalogVersion): LegacyCatalogAudit => ({
  sourceVersionId: version.id,
  tenantId: version.tenantId,
  version: version.version,
  status: version.status,
  sourceFileName: version.sourceFileName,
  sourceHash: version.sourceHash,
  parserVersion: version.parserVersion,
  createdAt: version.createdAt,
  publishedAt: version.publishedAt,
  recordCounts: {
    intents: version.catalog.intents.length,
    signals: version.catalog.signals.length,
    slots: version.catalog.slots.length,
    relations: version.catalog.relations.length,
    workflowBindings: version.catalog.workflowBindings.length,
  },
  readOnly: true,
  preservedHistory: true,
});

export const createLegacyCatalogV2Candidate = (input: LegacyCatalogV2CandidateInput): LegacyCatalogV2Candidate => {
  const validation = validateCatalogV2(input.proposedCatalog);
  if (!validation.ok || !validation.document) throw new Error(`LEGACY_V2_MAPPING_INVALID: ${validation.errors.join(' ')}`);
  if (validation.document.manifest.tenantScope !== input.tenantScope) throw new Error('LEGACY_V2_TENANT_MISMATCH: mapped catalog scope does not match the trusted tenant.');
  const catalog = validation.document;
  return {
    candidateId: `legacy-v1-review:${input.legacyVersion.id}:${catalogV2Sha256(catalog).slice(0, 24)}`,
    sourceVersionId: input.legacyVersion.id,
    sourceHash: input.legacyVersion.sourceHash,
    targetTenantScope: input.tenantScope,
    status: 'review_required',
    autoPublish: false,
    catalog,
    catalogVersionRef: catalogV2VersionRef(catalog),
    warnings: [
      'The v1 catalog remains unchanged and is still the rollback source.',
      'The mapped v2 catalog is an unpublished draft and requires separate Admin publication.',
      'Prior v1 consent, actions, sessions and provider identities are not copied into v2 state.',
    ],
  };
};

export const legacyCatalogAuditDigest = (audit: LegacyCatalogAudit): string => createHash('sha256').update(JSON.stringify(audit), 'utf8').digest('hex');
