export const getTenantChatUrl = (slug: string, publicOrigin?: string | null): string => {
  const cleanSlug = encodeURIComponent(slug.trim().toLowerCase());
  if (publicOrigin && publicOrigin.trim()) {
    return `${publicOrigin.trim().replace(/\/+$/, '')}/?tenant=${cleanSlug}`;
  }
  const globalWin = typeof window !== 'undefined' ? window : (globalThis as any).window;
  if (globalWin && globalWin.location) {
    if (globalWin.location.port === '4200' || globalWin.location.port === '8080') {
      return `${globalWin.location.protocol}//${globalWin.location.hostname}:3000/?tenant=${cleanSlug}`;
    }
    return `${globalWin.location.origin}/?tenant=${cleanSlug}`;
  }
  return `http://localhost:3000/?tenant=${cleanSlug}`;
};

export const openTenantChatWindow = (slug: string, publicOrigin?: string | null): string => {
  const url = getTenantChatUrl(slug, publicOrigin);
  const globalWin = typeof window !== 'undefined' ? window : (globalThis as any).window;
  if (globalWin && typeof globalWin.open === 'function') {
    globalWin.open(url, '_blank', 'noopener,noreferrer');
  }
  return url;
};
