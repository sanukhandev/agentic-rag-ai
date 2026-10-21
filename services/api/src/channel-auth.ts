import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Store } from './types.js';

const CHANNEL_HEADER_PREFIX = 'x-agentic-';
const MAX_CLOCK_SKEW_SECONDS = 300;

export interface ChannelContext {
  credentialId: string;
  keyId: string;
  channel: string;
  tenantId: string;
}

export interface StaticChannelAuth {
  apiKey: string;
  tenantId?: string;
  tenantSlug?: string;
  channel: string;
}

export type ChannelRequest = Request & { channel?: ChannelContext; requestId?: string };

const canonicalBody = (body: unknown): string => JSON.stringify(body ?? {});

export const createChannelSignature = (secret: string, method: string, path: string, timestamp: string, nonce: string, body: unknown): string => createHmac('sha256', secret).update([method.toUpperCase(), path, timestamp, nonce, canonicalBody(body)].join('\n')).digest('base64url');

export const generateChannelSecret = (): string => randomBytes(32).toString('base64url');
export const generateChannelKeyId = (): string => `ch_${randomBytes(18).toString('base64url')}`;

export class ChannelSecretVault {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (secret.length < 16) throw new Error('CHANNEL_CREDENTIAL_KEY must be at least 16 characters.');
    this.key = createHmac('sha256', secret).update('agentic-channel-credential-v1').digest();
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, ciphertext, cipher.getAuthTag()].map((part) => part.toString('base64url')).join('.');
  }

  decrypt(value: string): string {
    const [ivText, ciphertextText, tagText] = value.split('.');
    if (!ivText || !ciphertextText || !tagText) throw new Error('Invalid channel credential ciphertext.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
  }
}

export const getChannel = (req: Request): ChannelContext | undefined => (req as ChannelRequest).channel;

const rejectChannel = (req: Request, res: Response, code: string): void => {
  res.status(401).json({ error: { code, message: 'Channel authentication failed.', requestId: (req as ChannelRequest).requestId } });
};

const sameSignature = (expected: string, received: string): boolean => {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
};

const sameSecret = (expected: string, received: string): boolean => {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const channelAuthMiddleware = (store: Store, vault: ChannelSecretVault, staticAuth?: StaticChannelAuth) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const staticApiKey = req.header('x-agentic-api-key');
  if (staticApiKey) {
    if (!staticAuth || !sameSecret(staticAuth.apiKey, staticApiKey) || (staticAuth.tenantId && staticAuth.tenantSlug)) { rejectChannel(req, res, 'CHANNEL_UNAUTHORIZED'); return; }
    const tenant = staticAuth.tenantId ? await store.getTenant(staticAuth.tenantId) : await store.getTenantBySlug(staticAuth.tenantSlug ?? '');
    if (!tenant || tenant.status !== 'active') { rejectChannel(req, res, 'CHANNEL_UNAUTHORIZED'); return; }
    (req as ChannelRequest).channel = { credentialId: 'static-api-key', keyId: 'static-api-key', channel: staticAuth.channel, tenantId: tenant.id };
    next();
    return;
  }
  const keyId = req.header(`${CHANNEL_HEADER_PREFIX}key-id`);
  const timestamp = req.header(`${CHANNEL_HEADER_PREFIX}timestamp`);
  const nonce = req.header(`${CHANNEL_HEADER_PREFIX}nonce`);
  const signature = req.header(`${CHANNEL_HEADER_PREFIX}signature`);
  if (!keyId && !timestamp && !nonce && !signature) { next(); return; }
  if (!keyId || !timestamp || !nonce || !signature || !/^\d{10}$/.test(timestamp) || !/^[A-Za-z0-9._~-]{8,128}$/.test(nonce)) { rejectChannel(req, res, 'CHANNEL_UNAUTHORIZED'); return; }

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) { rejectChannel(req, res, 'CHANNEL_TIMESTAMP_INVALID'); return; }
  const credential = await store.getChannelCredential(keyId);
  if (!credential || !credential.active || credential.revokedAt) { rejectChannel(req, res, 'CHANNEL_UNAUTHORIZED'); return; }
  const tenant = await store.getTenant(credential.tenantId);
  if (!tenant || tenant.status !== 'active') { rejectChannel(req, res, 'CHANNEL_UNAUTHORIZED'); return; }

  let secret: string;
  try { secret = vault.decrypt(credential.secretCiphertext); } catch { rejectChannel(req, res, 'CHANNEL_UNAUTHORIZED'); return; }
  const expected = createChannelSignature(secret, req.method, req.originalUrl, timestamp, nonce, req.body);
  if (!sameSignature(expected, signature)) { rejectChannel(req, res, 'CHANNEL_UNAUTHORIZED'); return; }
  if (!(await store.claimCallbackNonce(`channel:${keyId}:${nonce}`, new Date(Date.now() + MAX_CLOCK_SKEW_SECONDS * 1000).toISOString()))) { rejectChannel(req, res, 'CHANNEL_REPLAYED'); return; }
  (req as ChannelRequest).channel = { credentialId: credential.id, keyId: credential.keyId, channel: credential.channel, tenantId: credential.tenantId };
  next();
};
