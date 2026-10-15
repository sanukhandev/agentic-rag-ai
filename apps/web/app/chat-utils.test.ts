import { describe, expect, it } from 'vitest';
import { isValidTenantSlug } from './chat-utils';

describe('web chat utilities', () => {
  it('accepts only tenant-safe slugs', () => {
    expect(isValidTenantSlug('tenant-a')).toBe(true);
    expect(isValidTenantSlug('Tenant A')).toBe(false);
    expect(isValidTenantSlug('../other')).toBe(false);
  });
});
