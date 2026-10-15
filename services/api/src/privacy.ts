import { randomUUID } from 'node:crypto';
import type { Session } from './types.js';

export interface MaskResult {
  masked: string;
  tokens: Array<{ token: string; value: string }>;
}

const token = (kind: string, index: number): string => `[${kind}_${index}]`;

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
  replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'EMAIL');
  replace(/(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)/g, 'PHONE');
  replace(/\b(?:passport|account|customer|member)[ #:-]*[A-Z0-9-]{4,}\b/gi, 'ID');
  return { masked, tokens };
};

export const sanitizeKnowledgeText = (input: string): string => input
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
  .replace(/(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)/g, '[REDACTED_PHONE]')
  .replace(/(api[_ -]?key|secret|password|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED_SECRET]');

export const assertKnownTokens = (session: Session, text: string): void => {
  const placeholders = text.match(/\[(?:EMAIL|PHONE|ID)_\d+\]/g) ?? [];
  for (const placeholder of placeholders) if (!session.tokenMap.has(placeholder)) throw new Error('Model returned an unknown privacy token.');
};

export const saveTokens = (session: Session, values: MaskResult['tokens']): void => {
  for (const item of values) session.tokenMap.set(item.token, item.value);
};

export const rehydrateForSession = (session: Session, text: string): string => {
  let result = text;
  for (const [placeholder, value] of session.tokenMap.entries()) result = result.replaceAll(placeholder, value);
  return result;
};

export const opaqueReference = (): string => `lead-${randomUUID()}`;
