import { z } from 'zod';
import type { ActionRequest } from './types.js';

const actionKey = z.string().trim().regex(/^[a-z][a-z0-9._-]{1,79}$/u);
export const v2ProviderCorrelationSchema = z.object({
  sessionId: z.string().guid().optional(),
  opportunityId: z.string().guid().nullable().optional(),
  catalogVersionId: z.string().guid().optional(),
  actionKey: actionKey.optional(),
  actionRevision: z.number().int().positive().optional(),
}).strict();

export type V2ProviderCorrelation = z.infer<typeof v2ProviderCorrelationSchema>;

export const validateV2ProviderCorrelation = (action: ActionRequest, input: V2ProviderCorrelation): string | null => {
  if (input.sessionId !== action.sessionId) return 'session_mismatch';
  if ((input.opportunityId ?? null) !== (action.opportunityId ?? null)) return 'opportunity_mismatch';
  if (input.catalogVersionId !== action.catalogVersionId) return 'catalog_revision_mismatch';
  if (input.actionKey !== action.actionKey) return 'action_identity_mismatch';
  if (input.actionRevision !== action.actionRevision) return 'action_revision_mismatch';
  return null;
};
