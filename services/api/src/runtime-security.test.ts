import { describe, expect, it, vi } from 'vitest';
import { crmLeadQualityRule, pruneExpiredRateLimits, resolveTenantForPlatformAdmin } from './app.js';
import { assertExternalEndpoint, assertPiiVaultSecret } from './runtime-security.js';
import type { Store } from './types.js';

describe('external endpoint security', () => {
  it('allows local HTTP but requires HTTPS and no URL credentials in production', () => {
    expect(() => assertExternalEndpoint('http://n8n:5678', 'n8n', 'development')).not.toThrow();
    expect(() => assertExternalEndpoint('http://n8n:5678', 'n8n', 'production')).toThrow('HTTPS');
    expect(() => assertExternalEndpoint('https://user:pass@example.test', 'Azure AI', 'development')).toThrow('credentials');
    expect(() => assertExternalEndpoint('ftp://example.test', 'Azure AI', 'development')).toThrow('HTTP(S)');
  });

  it('removes expired rate-limit entries without disturbing active clients', () => {
    const entries = new Map([
      ['expired', { count: 1, resetAt: 99 }],
      ['active', { count: 1, resetAt: 101 }],
    ]);
    pruneExpiredRateLimits(entries, 100);
    expect([...entries.keys()]).toEqual(['active']);
  });

  it('fails closed for missing or placeholder production vault keys', () => {
    expect(() => assertPiiVaultSecret(undefined, 'production')).toThrow('PII_VAULT_KEY');
    expect(() => assertPiiVaultSecret('local-development-pii-vault-key', 'production')).toThrow('PII_VAULT_KEY');
    expect(() => assertPiiVaultSecret('a'.repeat(32), 'production')).not.toThrow();
  });

  it('resolves platform tenant scope from either UUID or slug before database queries', async () => {
    const tenant = { id: '11111111-1111-4111-8111-111111111111', slug: 'anc' };
    const store = {
      getTenant: async (id: string) => id === tenant.id ? tenant : null,
      getTenantBySlug: async (slug: string) => slug === tenant.slug ? tenant : null
    };

    await expect(resolveTenantForPlatformAdmin(store as unknown as Pick<Store, 'getTenant' | 'getTenantBySlug'>, tenant.slug)).resolves.toBe(tenant.id);
    await expect(resolveTenantForPlatformAdmin(store as unknown as Pick<Store, 'getTenant' | 'getTenantBySlug'>, tenant.id)).resolves.toBe(tenant.id);
  });

  it('does not query the legacy catalog table with a V2 catalog reference', async () => {
    const getIntentCatalogVersion = vi.fn();

    await expect(crmLeadQualityRule(
      { getIntentCatalogVersion } as unknown as Pick<Store, 'getIntentCatalogVersion'>,
      { tenantId: 'tenant-1', catalogVersionId: 'anc:r5:catalog-hash', intent: 'anc.company_formation' }
    )).resolves.toBeUndefined();
    expect(getIntentCatalogVersion).not.toHaveBeenCalled();
  });
});
