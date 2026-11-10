import type { IntentCatalogV2Version } from '../types.js';

export type V2WorkflowRoute = {
  workflowKey: string;
  webhookPath: string;
  n8nWorkflowId: string;
  payloadContract: string;
};

/** A V2 workflow is dispatchable only when the published catalog binds every transport identity. */
export const resolveV2WorkflowRoute = (version: IntentCatalogV2Version, workflowKey: string): V2WorkflowRoute | null => {
  const binding = version.status === 'published'
    ? version.catalog.sheets.WorkflowBindings.find(candidate => candidate.workflowKey === workflowKey && candidate.enabled)
    : null;
  if (!binding?.n8nWorkflowId || !binding.webhookPath || !binding.payloadContract) return null;
  return { workflowKey: binding.registryKey, webhookPath: binding.webhookPath, n8nWorkflowId: binding.n8nWorkflowId, payloadContract: binding.payloadContract };
};
