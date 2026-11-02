import { z } from 'zod';
import type { ActionRequest } from './types.js';

const actionKey = z.string().trim().regex(/^[a-z][a-z0-9._-]{1,79}$/u);
export const v2ProviderCorrelationSchema = z.object({
  tenantId: z.string().guid(),
  idempotencyKey: z.string().trim().min(1).max(200),
  sessionId: z.string().guid(),
  opportunityId: z.string().guid(),
  catalogVersionId: z.string().guid(),
  actionKey,
  actionRevision: z.number().int().positive(),
}).strict();

export type V2ProviderCorrelation = z.infer<typeof v2ProviderCorrelationSchema>;

export const validateV2ProviderCorrelation = (action: ActionRequest, input: V2ProviderCorrelation): string | null => {
  if (input.tenantId !== action.tenantId) return 'tenant_mismatch';
  if (input.idempotencyKey !== action.idempotencyKey) return 'idempotency_mismatch';
  if (input.sessionId !== action.sessionId) return 'session_mismatch';
  if ((input.opportunityId ?? null) !== (action.opportunityId ?? null)) return 'opportunity_mismatch';
  if (input.catalogVersionId !== action.catalogVersionId) return 'catalog_revision_mismatch';
  if (input.actionKey !== action.actionKey) return 'action_identity_mismatch';
  if (input.actionRevision !== action.actionRevision) return 'action_revision_mismatch';
  return null;
};
