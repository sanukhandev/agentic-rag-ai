import type { IntentCatalogV2Version } from '../types.js';

export type WorkflowRoute = {
  workflowKey: string;
  providerType: string;
  webhookPath: string;
  n8nWorkflowId: string;
  payloadContract: string;
};

export type DocumentRoute = {
  workflowKey: string;
  registryKey: string;
  providerType: string;
  enabled: boolean;
  webhookPath?: string;
  n8nWorkflowId?: string;
  payloadContract?: string;
  policyKey?: string;
  docType?: string;
  mimeTypes?: string[];
};

/** A Published workflow is dispatchable only when the published catalog binds every transport identity. */
export const resolveWorkflowRoute = (version: IntentCatalogV2Version, workflowKey: string): WorkflowRoute | null => {
  const binding = version.status === 'published'
    ? version.catalog.sheets.WorkflowBindings.find(candidate => candidate.workflowKey === workflowKey && candidate.enabled)
    : null;
  if (!binding?.n8nWorkflowId || !binding.webhookPath || !binding.payloadContract) return null;
  return { workflowKey: binding.registryKey, providerType: binding.providerType, webhookPath: binding.webhookPath, n8nWorkflowId: binding.n8nWorkflowId, payloadContract: binding.payloadContract };
};

/** Resolves document route from published catalog ToolBindings, DocumentPolicies, and WorkflowBindings. */
export const resolveDocumentRoute = (
  version: IntentCatalogV2Version,
  goalKey: string,
): DocumentRoute | null => {
  if (version.status !== 'published') return null;
  const policy = version.catalog.sheets.DocumentPolicies.find(
    candidate => candidate.goalKey === goalKey && candidate.stageKey === 'document_upload' && candidate.enabled,
  );
  const tool = version.catalog.sheets.ToolBindings.find(
    candidate => candidate.goalKey === goalKey && candidate.stageKey === 'document_upload' && candidate.registryKey,
  );
  if (!tool?.registryKey) return null;
  const binding = version.catalog.sheets.WorkflowBindings.find(
    candidate => candidate.workflowKey === tool.registryKey || candidate.registryKey === tool.registryKey,
  );
  if (!binding) return null;
  return {
    workflowKey: binding.workflowKey,
    registryKey: binding.registryKey,
    providerType: binding.providerType,
    enabled: Boolean(binding.enabled && tool.enabled),
    ...(binding.webhookPath ? { webhookPath: binding.webhookPath } : {}),
    ...(binding.n8nWorkflowId ? { n8nWorkflowId: binding.n8nWorkflowId } : {}),
    ...(binding.payloadContract ? { payloadContract: binding.payloadContract } : {}),
    ...(policy?.policyKey ? { policyKey: policy.policyKey } : {}),
    ...(policy?.docType ? { docType: policy.docType } : {}),
    ...(policy?.mimeTypes ? { mimeTypes: policy.mimeTypes } : {}),
  };
};
