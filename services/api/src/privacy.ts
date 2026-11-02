import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Session } from './types.js';

export interface MaskResult {
  masked: string;
  tokens: Array<{ token: string; value: string }>;
}

const token = (kind: string, index: number): string => `[${kind}_${index}]`;

export type RehydrationPurpose = 'assistant_response' | 'workflow_payload' | 'admin_crm';

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

  private resolveValue(session: Session, placeholder: string, allowExpired = false): string | null {
    const ciphertext = session.tokenMap.get(placeholder);
    const encoded = ciphertext ? this.decrypt(session.id, ciphertext) : null;
    if (!encoded) return null;
    try {
      const entry = JSON.parse(encoded) as { value?: unknown; expiresAt?: unknown };
      if (typeof entry.value !== 'string' || typeof entry.expiresAt !== 'number') return null;
      if (!allowExpired && entry.expiresAt <= Date.now()) {
        session.tokenMap.delete(placeholder);
        return null;
      }
      return entry.value;
    } catch { return null; }
  }

  purgeExpired(session: Session): number {
    const before = session.tokenMap.size;
    for (const placeholder of [...session.tokenMap.keys()]) this.resolveValue(session, placeholder, false);
    return before - session.tokenMap.size;
  }

  has(session: Session, placeholder: string): boolean { return this.resolveValue(session, placeholder, false) !== null; }

  resolve(session: Session, placeholder: string, purpose: RehydrationPurpose): string | null {
    if (purpose === 'admin_crm') return this.resolveValue(session, placeholder, true);
    if (purpose !== 'assistant_response') return null;
    return this.resolveValue(session, placeholder, false);
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
  // Credential values are not vault tokens: they are never eligible for rehydration.
  let masked = sanitizeCredentialText(input);
  const replace = (pattern: RegExp, kind: string): void => {
    masked = masked.replace(pattern, (value) => {
      const tokenValue = token(kind, tokens.filter((item) => item.token.startsWith(`[${kind}_`)).length + 1);
      tokens.push({ token: tokenValue, value });
      return tokenValue;
    });
  };
  const replaceName = (pattern: RegExp, shouldMask: (name: string) => boolean = () => true): void => {
    masked = masked.replace(pattern, (_value, name: string) => {
      if (!shouldMask(name)) return _value;
      const tokenValue = token('NAME', tokens.filter((item) => item.token.startsWith('[NAME_')).length + 1);
      tokens.push({ token: tokenValue, value: name });
      return tokenValue;
    });
  };
  replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'EMAIL');
  replace(/(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)/g, 'PHONE');
  const nameComponent = String.raw`[\p{L}\d]+(?:['’\-][\p{L}\d]+)*`;
  const nonNameOpeners = new Set(['a', 'an', 'available', 'based', 'building', 'calling', 'contacting', 'exploring', 'from', 'happy', 'here', 'interested', 'looking', 'need', 'new', 'planning', 'ready', 'seeking', 'setting', 'starting', 'the', 'trying', 'unable', 'want']);
  const introductionName = new RegExp(String.raw`\b(?:my name is|i am|i'm)\s+(${nameComponent}(?:\s+(?!(?:and|but|i|i'm|im|need|want|for|from|with|please)\b)${nameComponent}){0,3})(?=\s*(?:[,.!?;]|$|\b(?:and|but|i|i'm|im|need|want|for|from|with|please)\b))`, 'giu');
  replaceName(introductionName, (name) => !nonNameOpeners.has(name.split(/\s+/u)[0]?.toLocaleLowerCase('en-US') ?? ''));
  replace(/\b(?:passport|account|customer|member)[ #:-]*[A-Z0-9-]{4,}\b/gi, 'ID');
  return { masked: sanitizeCredentialText(masked), tokens };
};

/** Credentials are never tokenized: they must not be recoverable by any model-facing path. */
const sanitizeCredentialText = (input: string): string => input
  .replace(/(api[_ -]?key|secret|password|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED_SECRET]')
  .replace(/\b(?:otp|one[- ]time(?: password)?|verification code)\s*(?:is|[:=#-])?\s*\d{4,8}\b/gi, '[REDACTED_OTP]')
  .replace(/\b(?:cvv|cvc|security code)\s*(?:is|[:=#-])?\s*\d{3,4}\b/gi, '[REDACTED_PAYMENT]')
  .replace(/\b(?:card|pan)\s*(?:number|no\.?)?\s*(?:is|[:=#-])?\s*(?:\d[ -]?){12,18}\d\b/gi, '[REDACTED_PAYMENT]')
  .replace(/\b(?:bank\s+account|account)\s*(?:number|no\.?)?\s*(?:is|[:=#-])?\s*\d{8,20}\b/gi, '[REDACTED_PAYMENT]');

export const sanitizeSensitiveText = (input: string): string => sanitizeCredentialText(input)
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
  .replace(/(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)/g, '[REDACTED_PHONE]');

export const sanitizeKnowledgeText = (input: string): string => sanitizeSensitiveText(input);

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
  const placeholders = new Set(text.match(/\[(?:EMAIL|PHONE|NAME|ID)_\d+\]/g) ?? []);
  for (const placeholder of placeholders) {
    const value = vault.resolve(session, placeholder, purpose);
    if (value) result = result.replaceAll(placeholder, value);
  }
  return result;
};

export const opaqueReference = (): string => `lead-${randomUUID()}`;
