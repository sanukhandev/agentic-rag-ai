import type { SupportingDocument } from './types.js';
import { validateV2DocumentProviderResult, type V2DocumentProviderRequest, type V2DocumentProviderResult } from './conversation/document-provider.js';
import type { V2TrustedProviderReadback } from './conversation/provider-evidence.js';

export interface DocumentCompletionScope {
  tenantId: string;
  sessionId: string;
  opportunityId: string;
  intentKey: string;
  catalogVersionId: string;
}

/** Local Stage 5 completion gate. This is NOT Salesforce SF-02 verification. */
export const requiredDocumentSetComplete = (
  requiredTypes: readonly string[],
  documents: readonly SupportingDocument[],
  scope: DocumentCompletionScope,
): boolean => {
  const uniqueTypes = new Set(requiredTypes);
  if (uniqueTypes.size === 0 || uniqueTypes.size !== requiredTypes.length) return false;
  return [...uniqueTypes].every((type) => documents.some((document) =>
    document.tenantId === scope.tenantId
    && document.sessionId === scope.sessionId
    && document.opportunityId === scope.opportunityId
    && document.catalogVersionId === scope.catalogVersionId
    && document.intentKey === scope.intentKey
    && document.expectedDocumentType === type
    && document.status === 'completed'));
};


/**
 * Stage 5 cannot complete from OCR success alone. Each required document must
 * also have an independently verified SF-02 attachment to the Lead and Account.
 * Contract attachments are evaluated after a contract record exists.
 */
export const requiredSf02DocumentSetComplete = (
  requiredTypes: readonly string[],
  documents: readonly SupportingDocument[],
  scope: DocumentCompletionScope,
  attachments: readonly { request: V2DocumentProviderRequest; result: V2DocumentProviderResult; readback: V2TrustedProviderReadback }[],
): boolean => requiredDocumentSetComplete(requiredTypes, documents, scope)
  && requiredTypes.every(type => documents.some(document => {
    if (document.expectedDocumentType !== type || document.status !== 'completed'
      || document.tenantId !== scope.tenantId || document.sessionId !== scope.sessionId
      || document.opportunityId !== scope.opportunityId || document.catalogVersionId !== scope.catalogVersionId
      || document.intentKey !== scope.intentKey) return false;
    return attachments.some(({ request, result, readback }) =>
      request.documentId === document.id && request.tenantId === scope.tenantId
      && request.sessionId === scope.sessionId && request.opportunityId === scope.opportunityId
      && request.catalogVersionId === scope.catalogVersionId && request.leadId === document.leadId
      && validateV2DocumentProviderResult(request, result, readback).stageCompletionEligible);
  }));
