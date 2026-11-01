import type { SupportingDocument } from './types.js';

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
