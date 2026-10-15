export const assertExternalEndpoint = (endpoint: string, label: string, nodeEnv = process.env.NODE_ENV ?? 'development'): void => {
  if (!endpoint) return;
  let parsed: URL;
  try { parsed = new URL(endpoint); } catch { throw new Error(`${label} endpoint must be a valid URL.`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${label} endpoint must use HTTP(S).`);
  if (parsed.username || parsed.password) throw new Error(`${label} endpoint must not include credentials.`);
  if (nodeEnv === 'production' && parsed.protocol !== 'https:') throw new Error(`${label} endpoint must use HTTPS in production.`);
};
