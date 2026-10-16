import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Session } from './types.js';

export interface MaskResult {
  masked: string;
  tokens: Array<{ token: string; value: string }>;
}

const token = (kind: string, index: number): string => `[${kind}_${index}]`;

export type RehydrationPurpose = 'assistant_response' | 'workflow_payload';

export class TokenVault {
  private readonly masterKey: Buffer;
  constructor(secret: string, private readonly ttlMs = 15 * 60_000) {
    if (secret.length < 16) throw new Error('PII vault secret must be at least 16 characters.');
    this.masterKey = createHmac('sha256', secret).update('agentic-rag-pii-vault').digest();
  }

  private key(sessionId: string): Buffer { return createHmac('sha256', this.masterKey).update(`session:${sessionId}`).digest(); }

  private encrypt(sessionId: string, value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(sessionId), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
  }

  private decrypt(sessionId: string, encoded: string): string | null {
    try {
      const [version, ivText, tagText, ciphertextText] = encoded.split('.');
      if (version !== 'v1' || !ivText || !tagText || !ciphertextText) return null;
      const decipher = createDecipheriv('aes-256-gcm', this.key(sessionId), Buffer.from(ivText, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
    } catch { return null; }
  }

  save(session: Session, values: MaskResult['tokens']): void {
    this.purgeExpired(session);
    for (const item of values) session.tokenMap.set(item.token, this.encrypt(session.id, JSON.stringify({ value: item.value, expiresAt: Date.now() + this.ttlMs })));
  }

  private resolveValue(session: Session, placeholder: string): string | null {
    const ciphertext = session.tokenMap.get(placeholder);
    const encoded = ciphertext ? this.decrypt(session.id, ciphertext) : null;
    if (!encoded) return null;
    try {
      const entry = JSON.parse(encoded) as { value?: unknown; expiresAt?: unknown };
      if (typeof entry.value !== 'string' || typeof entry.expiresAt !== 'number') return null;
      if (entry.expiresAt <= Date.now()) session.tokenMap.delete(placeholder);
      return entry.expiresAt > Date.now() ? entry.value : null;
    } catch { return null; }
  }

  purgeExpired(session: Session): number {
    const before = session.tokenMap.size;
    for (const placeholder of [...session.tokenMap.keys()]) this.resolveValue(session, placeholder);
    return before - session.tokenMap.size;
  }

  has(session: Session, placeholder: string): boolean { return this.resolveValue(session, placeholder) !== null; }

  resolve(session: Session, placeholder: string, purpose: RehydrationPurpose): string | null {
    if (purpose !== 'assistant_response') return null;
    return this.resolveValue(session, placeholder);
  }

  rotate(session: Session, nextVault: TokenVault): void {
    const values = [...session.tokenMap.keys()].flatMap((placeholder) => {
      const value = this.resolveValue(session, placeholder);
      return value ? [{ token: placeholder, value }] : [];
    });
    nextVault.save(session, values);
  }
}

const defaultVault = new TokenVault(process.env.PII_VAULT_KEY ?? 'local-development-pii-vault-key');

export const maskPii = (input: string): MaskResult => {
  const tokens: Array<{ token: string; value: string }> = [];
  let masked = input;
  const replace = (pattern: RegExp, kind: string): void => {
    masked = masked.replace(pattern, (value) => {
      const tokenValue = token(kind, tokens.filter((item) => item.token.startsWith(`[${kind}_`)).length + 1);
      tokens.push({ token: tokenValue, value });
      return tokenValue;
    });
  };
  const replaceName = (pattern: RegExp): void => {
    masked = masked.replace(pattern, (_value, name: string) => {
      const tokenValue = token('NAME', tokens.filter((item) => item.token.startsWith('[NAME_')).length + 1);
      tokens.push({ token: tokenValue, value: name });
      return tokenValue;
    });
  };
  replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'EMAIL');
  replace(/(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)/g, 'PHONE');
  replaceName(/\bmy name is\s+([A-Z][A-Za-z0-9'-]+(?:\s+[A-Z][A-Za-z0-9'-]+)?)/gi);
  replaceName(/\b(?:[Ii] am|[Ii]'m)\s+([A-Z][A-Za-z0-9'-]+(?:\s+[A-Z][A-Za-z0-9'-]+)?)/g);
  replace(/\b(?:passport|account|customer|member)[ #:-]*[A-Z0-9-]{4,}\b/gi, 'ID');
  return { masked, tokens };
};

export const sanitizeKnowledgeText = (input: string): string => input
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
  .replace(/(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)/g, '[REDACTED_PHONE]')
  .replace(/(api[_ -]?key|secret|password|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED_SECRET]');

export const assertKnownTokens = (session: Session, text: string, vault: TokenVault = defaultVault): void => {
  const placeholders = text.match(/\[(?:EMAIL|PHONE|NAME|ID)_\d+\]/g) ?? [];
  for (const placeholder of placeholders) if (!vault.has(session, placeholder)) throw new Error('Model returned an unknown privacy token.');
};

export const saveTokens = (session: Session, values: MaskResult['tokens'], vault: TokenVault = defaultVault): void => vault.save(session, values);

export const maskPiiForSession = (session: Session, input: string, vault: TokenVault = defaultVault): string => {
  const result = maskPii(input);
  if (result.tokens.length === 0) return input;
  const used = new Set(session.tokenMap.keys());
  const replacements = new Map<string, string>();
  const values = result.tokens.map((item) => {
    const kind = item.token.slice(1, item.token.indexOf('_'));
    let index = 1;
    let replacement = `[${kind}_${index}]`;
    while (used.has(replacement)) { index += 1; replacement = `[${kind}_${index}]`; }
    used.add(replacement);
    replacements.set(item.token, replacement);
    return { token: replacement, value: item.value };
  });
  let masked = result.masked;
  for (const [from, to] of replacements) masked = masked.replaceAll(from, to);
  vault.save(session, values);
  return masked;
};

export const rehydrateForSession = (session: Session, text: string, vault: TokenVault = defaultVault, purpose: RehydrationPurpose = 'assistant_response'): string => {
  let result = text;
  for (const placeholder of session.tokenMap.keys()) {
    const value = vault.resolve(session, placeholder, purpose);
    if (value) result = result.replaceAll(placeholder, value);
  }
  return result;
};

export const opaqueReference = (): string => `lead-${randomUUID()}`;
