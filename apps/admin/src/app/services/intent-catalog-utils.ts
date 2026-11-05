import type { IngestionJobStatus } from '../types/admin.types';

export function isCatalogJobPending(status: IngestionJobStatus): boolean {
  return status === 'queued' || status === 'processing';
}

/**
 * Tenant administrators use their authenticated tenant even when the Admin
 * tenant selector was not populated. Platform administrators must explicitly
 * select a tenant, preventing accidental fallback to the first organization.
 */
export function catalogLoadScope(
  accessToken: string,
  isPlatformAdmin: boolean,
  tenantId: string | null
): string | null {
  if (!accessToken) return null;
  if (isPlatformAdmin) return tenantId ? `tenant:${tenantId}` : null;
  return tenantId ? `tenant:${tenantId}` : 'authenticated-tenant';
}
