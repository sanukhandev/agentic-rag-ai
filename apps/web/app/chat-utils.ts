export const isValidTenantSlug = (slug: string): boolean => /^[a-z0-9-]+$/.test(slug);
