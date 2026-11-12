import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthorizedKnowledgeEvidence } from './rag-read-tool.js';

export interface P4EvidenceReceipt { readonly citationId: string; readonly receipt: string }
interface ReceiptPayload {
  readonly v: 1;
  readonly scopeDigest: string;
  readonly tenantId: string;
  readonly sourceId: string;
  readonly versionId: string;
  readonly citationId: string;
  readonly textDigest: string;
  readonly expiresAt: number;
}
const MAX_LENGTH = 6000;

export class P4ReceiptError extends Error {
  constructor() { super('Invalid or expired evidence receipt'); this.name = 'P4ReceiptError'; }
}
export const p4Digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/** HMAC issuer and validator: Python/model must never hold this key. */
export class P4EvidenceSigner {
  private readonly secret: Buffer;
  constructor(secret: string, private readonly now: () => number = Date.now) {
    if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('P4 evidence key must contain at least 32 bytes');
    this.secret = Buffer.from(secret, 'utf8');
  }
  private mac(value: string): Buffer { return createHmac('sha256', this.secret).update(value).digest(); }
  issue(scopeRef: string, tenantId: string, evidence: AuthorizedKnowledgeEvidence): P4EvidenceReceipt {
    const payload: ReceiptPayload = {
      v: 1, scopeDigest: p4Digest(scopeRef), tenantId, sourceId: evidence.sourceId,
      versionId: evidence.versionId, citationId: evidence.citationId,
      textDigest: p4Digest(evidence.untrustedContent), expiresAt: this.now() + 120_000,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { citationId: evidence.citationId, receipt: encoded + '.' + this.mac(encoded).toString('base64url') };
  }
  verify(scopeRef: string, tenantId: string, token: P4EvidenceReceipt): Readonly<ReceiptPayload> {
    if (!token || typeof token.citationId !== 'string' || !token.citationId
      || typeof token.receipt !== 'string' || token.receipt.length > MAX_LENGTH) throw new P4ReceiptError();
    const pieces = token.receipt.split('.');
    if (pieces.length !== 2 || !pieces[0] || !pieces[1]
      || !/^[A-Za-z0-9_-]+$/u.test(pieces[0]) || !/^[A-Za-z0-9_-]+$/u.test(pieces[1])) throw new P4ReceiptError();
    const signature = Buffer.from(pieces[1], 'base64url');
    const expected = this.mac(pieces[0]);
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new P4ReceiptError();
    let data: unknown;
    try { data = JSON.parse(Buffer.from(pieces[0], 'base64url').toString('utf8')); }
    catch { throw new P4ReceiptError(); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new P4ReceiptError();
    const payload = data as Partial<ReceiptPayload>;
    const now = this.now();
    if (payload.v !== 1 || payload.scopeDigest !== p4Digest(scopeRef) || payload.tenantId !== tenantId
      || payload.citationId !== token.citationId || typeof payload.sourceId !== 'string' || !payload.sourceId
      || typeof payload.versionId !== 'string' || !payload.versionId
      || typeof payload.textDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(payload.textDigest)
      || typeof payload.expiresAt !== 'number' || !Number.isSafeInteger(payload.expiresAt)
      || payload.expiresAt <= now || payload.expiresAt > now + 120_000) throw new P4ReceiptError();
    return payload as ReceiptPayload;
  }
}
