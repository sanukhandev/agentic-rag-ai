import { createHash, createPublicKey, randomUUID, timingSafeEqual, type JsonWebKey as NodeJsonWebKey, type KeyObject } from 'node:crypto';
import type { Application, NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { z } from 'zod';
import { hasConflictingEvidence, retrieveApprovedKnowledge } from '../knowledge.js';
import type { EmbeddingProvider } from '../embedding.js';
import { catalogNextJourneyRequirement, catalogRequirementLabel } from '../intent-catalog.js';
import { HttpError, parse } from '../http/errors.js';
import { sanitizeKnowledgeText } from '../privacy.js';
import { lifecycleStages, type Store } from '../types.js';

const searchKnowledgeSchema = z.object({ query: z.string().trim().min(1).max(1_000), maxResults: z.coerce.number().int().min(1).max(8).default(4) }).strict();
const journeyStateSchema = z.object({}).strict();
const bearerPattern = /^Bearer\s+(.+)$/iu;
const maxClockSkewSeconds = 60;

export interface FoundryToolAuthOptions {
  issuer?: string;
  audience?: string;
  jwksUrl?: string;
  allowedAppIds?: readonly string[];
  allowedObjectIds?: readonly string[];
  tenantIdsByAppId?: ReadonlyMap<string, string>;
  defaultTenantId?: string;
  allowedInternalRole?: string;
  apiKey?: string;
  apiKeyTenantId?: string;
  allowApiKey?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface FoundryAuthContext {
  identity: string;
  tenantId: string;
  source: 'entra' | 'api_key';
  allowInternalSources: boolean;
}

export type FoundrySessionBindingResolver = (context: FoundryAuthContext) => Promise<string | null>;

type Jwk = { kty?: unknown; kid?: unknown; n?: unknown; e?: unknown; alg?: unknown };
type CachedKey = { key: KeyObject; expiresAt: number };

const splitEnv = (value: string | undefined): string[] => value?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];

const readTenantMap = (value: string | undefined): ReadonlyMap<string, string> => {
  if (!value) return new Map();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    const entries = Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[0].length > 0 && entry[1].length > 0);
    if (entries.length !== Object.keys(parsed).length) throw new Error('invalid identity map');
    return new Map(entries);
  } catch {
    throw new Error('FOUNDRY_TOOLS_IDENTITY_TENANT_MAP must be a JSON object mapping application IDs to tenant IDs.');
  }
};

export const foundryToolAuthOptionsFromEnv = (nodeEnv: string): FoundryToolAuthOptions => {
  const entraTenantId = process.env.FOUNDRY_TOOLS_ENTRA_TENANT_ID;
  const options: FoundryToolAuthOptions = {
    allowedAppIds: splitEnv(process.env.FOUNDRY_TOOLS_ALLOWED_APP_IDS),
    allowedObjectIds: splitEnv(process.env.FOUNDRY_TOOLS_ALLOWED_OBJECT_IDS),
    tenantIdsByAppId: readTenantMap(process.env.FOUNDRY_TOOLS_IDENTITY_TENANT_MAP),
    allowedInternalRole: process.env.FOUNDRY_TOOLS_INTERNAL_ROLE ?? 'foundry.tools.internal',
    allowApiKey: nodeEnv !== 'production' && process.env.FOUNDRY_TOOLS_ALLOW_API_KEY === 'true',
  };
  const issuer = process.env.FOUNDRY_TOOLS_ISSUER ?? (entraTenantId ? `https://login.microsoftonline.com/${entraTenantId}/v2.0` : undefined);
  const audience = process.env.FOUNDRY_TOOLS_AUDIENCE;
  const jwksUrl = process.env.FOUNDRY_TOOLS_JWKS_URL ?? (entraTenantId ? `https://login.microsoftonline.com/${entraTenantId}/discovery/v2.0/keys` : undefined);
  const defaultTenantId = process.env.FOUNDRY_TOOLS_TENANT_ID;
  const apiKey = process.env.FOUNDRY_TOOLS_API_KEY;
  const apiKeyTenantId = process.env.FOUNDRY_TOOLS_API_KEY_TENANT_ID;
  if (issuer) options.issuer = issuer;
  if (audience) options.audience = audience;
  if (jwksUrl) options.jwksUrl = jwksUrl;
  if (defaultTenantId) options.defaultTenantId = defaultTenantId;
  if (apiKey) options.apiKey = apiKey;
  if (apiKeyTenantId) options.apiKeyTenantId = apiKeyTenantId;
  return options;
};

const unauthorized = (message = 'Foundry tool authentication failed.'): HttpError => new HttpError(401, 'FOUNDRY_UNAUTHORIZED', message);
const unavailable = (message = 'Foundry tool authentication is not configured.'): HttpError => new HttpError(503, 'FOUNDRY_AUTH_UNAVAILABLE', message);

const sameSecret = (expected: string, received: string): boolean => {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
};

const asString = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;

export class FoundryToolAuth {
  private readonly keys = new Map<string, CachedKey>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: FoundryToolAuthOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async authenticate(req: Request): Promise<FoundryAuthContext> {
    const authorization = req.header('authorization');
    const bearer = authorization ? bearerPattern.exec(authorization)?.[1] : undefined;
    if (bearer) return this.authenticateBearer(bearer);
    const apiKey = req.header('x-foundry-api-key');
    if (apiKey) {
      if (!this.options.allowApiKey || !this.options.apiKey || !this.options.apiKeyTenantId) throw unauthorized();
      if (!sameSecret(this.options.apiKey, apiKey)) throw unauthorized();
      return { identity: 'development-api-key', tenantId: this.options.apiKeyTenantId, source: 'api_key', allowInternalSources: false };
    }
    throw unauthorized('A Foundry bearer token is required.');
  }

  private async authenticateBearer(token: string): Promise<FoundryAuthContext> {
    if (!this.options.issuer || !this.options.audience || !this.options.jwksUrl) throw unavailable();
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded !== 'object' || !decoded.header || typeof decoded.header.kid !== 'string' || decoded.header.alg !== 'RS256') throw unauthorized();
    let payload: JwtPayload;
    try {
      const key = await this.getKey(decoded.header.kid);
      const verified = jwt.verify(token, key, { algorithms: ['RS256'], issuer: this.options.issuer, audience: this.options.audience, clockTolerance: maxClockSkewSeconds });
      if (!verified || typeof verified === 'string') throw unauthorized();
      payload = verified;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof jwt.TokenExpiredError || error instanceof jwt.JsonWebTokenError || error instanceof jwt.NotBeforeError) throw unauthorized();
      throw unavailable('Foundry token verification is temporarily unavailable.');
    }
    const applicationId = asString(payload.azp) ?? asString(payload.appid);
    if (!applicationId || !this.options.allowedAppIds?.length || !this.options.allowedAppIds.includes(applicationId)) throw unauthorized();
    const objectId = asString(payload.oid);
    if (this.options.allowedObjectIds?.length && (!objectId || !this.options.allowedObjectIds.includes(objectId))) throw unauthorized();
    const tenantId = this.options.tenantIdsByAppId?.get(applicationId) ?? this.options.defaultTenantId;
    if (!tenantId) throw unauthorized();
    const roles = Array.isArray(payload.roles) ? payload.roles.filter((role): role is string => typeof role === 'string') : [];
    return { identity: applicationId, tenantId, source: 'entra', allowInternalSources: Boolean(this.options.allowedInternalRole && roles.includes(this.options.allowedInternalRole)) };
  }

  private async getKey(kid: string): Promise<KeyObject> {
    const cached = this.keys.get(kid);
    if (cached && cached.expiresAt > this.now()) return cached.key;
    let response: globalThis.Response;
    try {
      response = await this.fetchImpl(this.options.jwksUrl!, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(3_000) });
    } catch {
      throw unavailable('Foundry signing keys are temporarily unavailable.');
    }
    if (!response.ok) throw unavailable('Foundry signing keys are temporarily unavailable.');
    let body: unknown;
    try { body = await response.json(); } catch { throw unavailable('Foundry signing keys are invalid.'); }
    const keys = body && typeof body === 'object' && Array.isArray((body as { keys?: unknown }).keys) ? (body as { keys: Jwk[] }).keys : [];
    const jwk = keys.find((candidate) => candidate.kid === kid && candidate.kty === 'RSA' && typeof candidate.n === 'string' && typeof candidate.e === 'string');
    if (!jwk) throw unauthorized();
    try {
      const key = createPublicKey({ key: jwk as unknown as NodeJsonWebKey, format: 'jwk' });
      this.keys.set(kid, { key, expiresAt: this.now() + 10 * 60_000 });
      return key;
    } catch { throw unavailable('Foundry signing keys are invalid.'); }
  }
}

export interface FoundryToolRouteDependencies {
  store: Store;
  embedding: EmbeddingProvider;
  auth: FoundryToolAuth;
  sessionBinding?: FoundrySessionBindingResolver;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

type RateLimitEntry = { count: number; resetAt: number };

const notLinked = () => ({ status: 'not_linked' as const, currentStage: null, completedStages: [], nextRequirement: null });
const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new HttpError(503, 'FOUNDRY_TOOL_TIMEOUT', 'The Foundry tool timed out.')), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
};

const redactedText = (value: string, maxLength: number): string => sanitizeKnowledgeText(value).replace(/\[(?:NAME|EMAIL|PHONE|ID)_\d+\]/gu, '[REDACTED_IDENTIFIER]').slice(0, maxLength);
const identityHash = (identity: string): string => createHash('sha256').update(identity).digest('hex').slice(0, 16);
const requestId = (req: Request): string => (req as Request & { requestId?: string }).requestId ?? 'unknown';

const audit = async (store: Store, req: Request, context: FoundryAuthContext, operation: string, outcome: string): Promise<void> => {
  try {
    await store.addAudit({ id: randomUUID(), tenantId: context.tenantId, actorId: null, eventName: `foundry.tool.${operation}`, metadata: { identityHash: identityHash(context.identity), outcome, requestId: requestId(req) }, createdAt: new Date().toISOString() });
  } catch { /* Security telemetry must not turn a read into a misleading provider failure. */ }
};

const boundedKnowledgeResponse = (evidence: Awaited<ReturnType<typeof retrieveApprovedKnowledge>>, maxResults: number, maxBytes: number) => {
  const citations = evidence.slice(0, maxResults).map((item) => ({ sourceId: item.citation.sourceId, title: redactedText(item.citation.title, 200), chunkId: item.citation.chunkId, locator: redactedText(item.citation.locator, 200), excerpt: redactedText(item.content, 1_600) }));
  const response = (status: 'grounded' | 'no_evidence', answer: string) => ({ status, answer: redactedText(answer, 6_000), citations });
  let result = response('grounded', citations.map((citation) => citation.excerpt).filter(Boolean).join('\n\n'));
  while (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes && result.citations.length > 1) result = { ...result, citations: result.citations.slice(0, -1) };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) result = { ...result, answer: result.answer.slice(0, Math.max(100, maxBytes - 1_000)), citations: result.citations.slice(0, 1).map((citation) => ({ ...citation, excerpt: citation.excerpt.slice(0, 600) })) };
  return result;
};

export const registerFoundryToolRoutes = (app: Pick<Application, 'post'>, dependencies: FoundryToolRouteDependencies): void => {
  const limits = new Map<string, RateLimitEntry>();
  const rateLimitMax = dependencies.rateLimitMax ?? 60;
  const rateLimitWindowMs = dependencies.rateLimitWindowMs ?? 60_000;
  const timeoutMs = dependencies.timeoutMs ?? 5_000;
  const maxResponseBytes = Math.max(1_024, dependencies.maxResponseBytes ?? 16_384);
  const authenticateAndLimit = async (req: Request, res: Response): Promise<FoundryAuthContext> => {
    const context = await dependencies.auth.authenticate(req);
    const now = Date.now();
    for (const [key, entry] of limits) if (entry.resetAt <= now) limits.delete(key);
    const key = context.identity;
    const current = limits.get(key);
    const entry = !current || current.resetAt <= now ? { count: 1, resetAt: now + rateLimitWindowMs } : { count: current.count + 1, resetAt: current.resetAt };
    limits.set(key, entry);
    if (entry.count > rateLimitMax) {
      res.setHeader('retry-after', Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)));
      throw new HttpError(429, 'FOUNDRY_RATE_LIMITED', 'Too many Foundry tool requests.');
    }
    return context;
  };
  const activeTenant = async (context: FoundryAuthContext) => {
    const tenant = await dependencies.store.getTenant(context.tenantId);
    if (!tenant || tenant.status !== 'active') throw new HttpError(403, 'FOUNDRY_TENANT_FORBIDDEN', 'The Foundry identity is not authorized for this tenant.');
    return tenant;
  };

  app.post('/api/v1/foundry/tools/search-knowledge', async (req: Request, res: Response, next: NextFunction) => {
    let context: FoundryAuthContext | null = null;
    try {
      context = await authenticateAndLimit(req, res);
      await activeTenant(context);
      const input = parse(searchKnowledgeSchema, req.body);
      const evidence = await withTimeout(retrieveApprovedKnowledge(dependencies.store, dependencies.embedding, context.tenantId, context.allowInternalSources ? 'internal' : 'public', input.query, input.maxResults), timeoutMs);
      const response = evidence.length === 0
        ? { status: 'no_evidence' as const, answer: 'No approved source evidence was found for this query.', citations: [] }
        : hasConflictingEvidence(evidence.map((item) => item.content))
          ? { ...boundedKnowledgeResponse(evidence, input.maxResults, maxResponseBytes), status: 'no_evidence' as const, answer: 'Approved sources contain conflicting information, so no single answer is safe.' }
          : boundedKnowledgeResponse(evidence, input.maxResults, maxResponseBytes);
      await audit(dependencies.store, req, context, 'search_knowledge', response.status);
      res.json(response);
    } catch (error) {
      if (context) await audit(dependencies.store, req, context, 'search_knowledge', error instanceof HttpError ? error.code : 'failed');
      next(error instanceof HttpError ? error : new HttpError(503, 'FOUNDRY_KNOWLEDGE_UNAVAILABLE', 'Approved knowledge is temporarily unavailable.'));
    }
  });

  app.post('/api/v1/foundry/tools/get-journey-state', async (req: Request, res: Response, next: NextFunction) => {
    let context: FoundryAuthContext | null = null;
    try {
      context = await authenticateAndLimit(req, res);
      await activeTenant(context);
      parse(journeyStateSchema, req.body);
      if (!dependencies.sessionBinding) { const response = notLinked(); await audit(dependencies.store, req, context, 'get_journey_state', response.status); res.json(response); return; }
      const sessionId = await withTimeout(dependencies.sessionBinding(context), timeoutMs);
      if (!sessionId) { const response = notLinked(); await audit(dependencies.store, req, context, 'get_journey_state', response.status); res.json(response); return; }
      const session = await withTimeout(dependencies.store.getSession(sessionId), timeoutMs);
      if (!session || session.tenantId !== context.tenantId) { const response = notLinked(); await audit(dependencies.store, req, context, 'get_journey_state', response.status); res.json(response); return; }
      const state = session.conversationState;
      const activeIntentKey = state?.intentProgress?.activeIntentKey ?? state?.activeFollowUpIntentKey ?? state?.selectedIntentKey ?? null;
      const entry = activeIntentKey && state?.intentProgress?.entries[activeIntentKey] ? state.intentProgress.entries[activeIntentKey] : null;
      const lifecycle = entry?.lifecycle;
      const catalog = state?.catalogVersionId ? await withTimeout(dependencies.store.getIntentCatalogVersion(context.tenantId, state.catalogVersionId), timeoutMs) : await withTimeout(dependencies.store.getPublishedIntentCatalog(context.tenantId), timeoutMs);
      const requirement = catalog && activeIntentKey
        ? catalog.catalog.journeyRequirements?.find((candidate) => candidate.requirementKey === entry?.currentRequirementKey && candidate.intentKey === activeIntentKey)
          ?? catalogNextJourneyRequirement(catalog, activeIntentKey, { ...(state?.slotValues ?? {}), ...(entry?.slotValues ?? {}) }, entry?.completedRequirementKeys ?? [])
        : null;
      const response = {
        status: 'available' as const,
        currentStage: lifecycle?.currentStage ?? null,
        completedStages: lifecycle ? lifecycleStages.filter((stage) => lifecycle.stages[stage]?.status === 'completed') : [],
        nextRequirement: requirement ? redactedText(catalogRequirementLabel(requirement), 240) : null,
        revision: lifecycle?.revision ?? state?.intentProgress?.journeyRevision ?? 0,
      };
      await audit(dependencies.store, req, context, 'get_journey_state', response.status);
      res.json(response);
    } catch (error) {
      if (context) await audit(dependencies.store, req, context, 'get_journey_state', error instanceof HttpError ? error.code : 'failed');
      next(error instanceof HttpError ? error : new HttpError(503, 'FOUNDRY_JOURNEY_UNAVAILABLE', 'Journey state is temporarily unavailable.'));
    }
  });
};
