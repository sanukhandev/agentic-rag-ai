import { z } from 'zod';
import type { ActionRequest } from './types.js';

const actionKey = z.string().trim().regex(/^[a-z][a-z0-9._-]{1,79}$/u);
export const v2CatalogVersionRefSchema = z.string().trim().min(8).max(240);
export const v2ProviderCorrelationSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  sessionId: z.string().guid(),
  opportunityId: z.string().guid(),
  catalogVersionId: v2CatalogVersionRefSchema,
  actionKey,
  actionRevision: z.number().int().positive(),
}).strict();

/** Callback payload includes tenant identity; shared shape can be spread into routes
 * which already declare tenantId without duplicate-property compilation errors. */
export const v2CallbackCorrelationSchema = v2ProviderCorrelationSchema.extend({
  tenantId: z.string().guid(),
}).strip(); // Full callback bodies carry action/status fields; validate only correlated identity.
export type V2ProviderCorrelation = z.infer<typeof v2CallbackCorrelationSchema>;

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
