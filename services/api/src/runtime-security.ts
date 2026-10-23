export const assertExternalEndpoint = (endpoint: string, label: string, nodeEnv = process.env.NODE_ENV ?? 'development'): void => {
  if (!endpoint) return;
  let parsed: URL;
  try { parsed = new URL(endpoint); } catch { throw new Error(`${label} endpoint must be a valid URL.`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${label} endpoint must use HTTP(S).`);
  if (parsed.username || parsed.password) throw new Error(`${label} endpoint must not include credentials.`);
  if (nodeEnv === 'production' && parsed.protocol !== 'https:') throw new Error(`${label} endpoint must use HTTPS in production.`);
};

export const assertPiiVaultSecret = (secret: string | undefined, nodeEnv = process.env.NODE_ENV ?? 'development'): void => {
  if (nodeEnv !== 'production') return;
  if (!secret || secret.length < 32 || /^(?:replace-with|local-development|change-me)/iu.test(secret)) throw new Error('Production PII_VAULT_KEY must be a configured, non-placeholder secret of at least 32 characters.');
};
