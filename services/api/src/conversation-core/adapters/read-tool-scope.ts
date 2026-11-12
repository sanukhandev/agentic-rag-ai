import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Store } from '../../types.js';
import { isV2ReadToolEnabled } from '../../conversation/tool-policy.js';
import type { ConversationRepository, ReadToolCatalog, ReadToolDefinition, TrustedActor } from '../contracts.js';
import { NodeReadToolRegistry, type NodeReadToolResult } from '../read-tool-registry.js';

type CatalogReader = Pick<Store, 'getIntentCatalogV2Version'>;

interface ScopeClaims {
  v: 1;
  tenantId: string;
  sessionId: string;
  principalId: string;
  catalogVersionId: string;
  revision: number;
  tools: string[];
  expiresAt: number;
  nonce: string;
}

export class InvalidReadScopeError extends Error {
  constructor() {
    super('Invalid, expired or unauthorized read-tool scope');
    this.name = 'InvalidReadScopeError';
  }
}

const P3_NAMES = new Set(['search_knowledge', 'get_conversation_summary', 'get_verified_customer_facts', 'list_supported_goals']);
const SCOPE_LIFETIME_MS = 120_000;
const MAX_SCOPE_LENGTH = 4_096;
const NAME = /^[a-z][a-z0-9_]{1,79}$/u;

function isScope(value: unknown): value is ScopeClaims {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Partial<ScopeClaims>;
  return v.v === 1
    && typeof v.tenantId === 'string' && v.tenantId.length > 0 && v.tenantId.length <= 128
    && typeof v.sessionId === 'string' && v.sessionId.length > 0 && v.sessionId.length <= 128
    && typeof v.principalId === 'string' && /^[a-f0-9]{64}$/u.test(v.principalId)
    && typeof v.catalogVersionId === 'string' && v.catalogVersionId.length > 0 && v.catalogVersionId.length <= 128
    && typeof v.revision === 'number' && Number.isSafeInteger(v.revision) && v.revision >= 0
    && Array.isArray(v.tools) && v.tools.length <= P3_NAMES.size && new Set(v.tools).size === v.tools.length
    && v.tools.every(item => typeof item === 'string' && P3_NAMES.has(item))
    && typeof v.expiresAt === 'number' && Number.isSafeInteger(v.expiresAt) && v.expiresAt > 0
    && typeof v.nonce === 'string' && /^[0-9a-f-]{36}$/u.test(v.nonce);
}

/**
 * The signed scope is only a private Node-to-gateway capability. The P4 HTTP
 * adapter MUST authenticate the internal service independently; never expose
 * this executor or token via a public/customer endpoint.
 */
export class ScopedP3ReadTools implements ReadToolCatalog {
  private readonly key: Buffer;

  constructor(
    secret: string,
    private readonly repository: ConversationRepository,
    private readonly catalogReader: CatalogReader,
    private readonly registry: NodeReadToolRegistry,
    private readonly now: () => number = Date.now,
  ) {
    if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Read tool scope secret must be at least 32 bytes');
    this.key = Buffer.from(secret, 'utf8');
  }

  /** Read only after executeBound has authenticated the session and token. */
  verifiedTenantForScope(token: string): string {
    return this.readScope(token).tenantId;
  }

  private mac(payload: string): Buffer {
    return createHmac('sha256', this.key).update(payload).digest();
  }

  async listFor(actor: TrustedActor, catalogVersionId: string): Promise<readonly ReadToolDefinition[]> {
    const snapshot = await this.repository.loadAuthorizedSnapshot(actor);
    if (actor.role !== 'customer' || actor.principalId !== snapshot.ownerPrincipalId
      || snapshot.tenantId !== actor.tenantId || snapshot.sessionId !== actor.sessionId
      || snapshot.catalogVersionId !== catalogVersionId) throw new InvalidReadScopeError();

    const catalog = catalogVersionId === 'unconfigured'
      ? null : await this.catalogReader.getIntentCatalogV2Version(actor.tenantId, catalogVersionId);
    if (catalog && (catalog.id !== catalogVersionId || catalog.tenantId !== actor.tenantId)) {
      throw new InvalidReadScopeError();
    }
    // A session may be pinned to a formerly published revision; published
    // status on the LATEST revision is not required for historic pinned reads.
    const knowledgeEnabled = Boolean(catalog && isV2ReadToolEnabled(catalog.catalog, 'search_knowledge'));
    return this.registry.listDefinitions().filter(def => P3_NAMES.has(def.name)
      && (def.name !== 'search_knowledge' || knowledgeEnabled));
  }

  async issueBoundScope(
    actor: TrustedActor, catalogVersionId: string,
    tools: readonly ReadToolDefinition[], sessionRevision: number,
  ): Promise<string> {
    const snapshot = await this.repository.loadAuthorizedSnapshot(actor);
    if (!Number.isSafeInteger(sessionRevision) || sessionRevision < 0
      || snapshot.revision !== sessionRevision || snapshot.catalogVersionId !== catalogVersionId
      || snapshot.ownerPrincipalId !== actor.principalId || snapshot.tenantId !== actor.tenantId
      || snapshot.sessionId !== actor.sessionId) throw new InvalidReadScopeError();
    const allowed = new Set((await this.listFor(actor, catalogVersionId)).map(t => t.name));
    const names = tools.map(t => t.name);
    if (new Set(names).size !== names.length || names.some(name => !allowed.has(name) || !NAME.test(name))) {
      throw new InvalidReadScopeError();
    }
    const claims: ScopeClaims = {
      v: 1, tenantId: actor.tenantId, sessionId: actor.sessionId,
      principalId: actor.principalId, catalogVersionId, revision: sessionRevision,
      tools: names, expiresAt: this.now() + SCOPE_LIFETIME_MS, nonce: randomUUID(),
    };
    const encoded = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    return encoded + '.' + this.mac(encoded).toString('base64url');
  }

  private readScope(token: string): ScopeClaims {
    if (typeof token !== 'string' || token.length > MAX_SCOPE_LENGTH) throw new InvalidReadScopeError();
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]
      || !/^[a-zA-Z0-9_-]+$/u.test(parts[0]) || !/^[a-zA-Z0-9_-]+$/u.test(parts[1])) {
      throw new InvalidReadScopeError();
    }
    const signature = Buffer.from(parts[1], 'base64url');
    const expected = this.mac(parts[0]);
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
      throw new InvalidReadScopeError();
    }
    let value: unknown;
    try { value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
    catch { throw new InvalidReadScopeError(); }
    if (!isScope(value) || value.expiresAt <= this.now()
      || value.expiresAt > this.now() + SCOPE_LIFETIME_MS) throw new InvalidReadScopeError();
    return value;
  }

  async executeBound(
    token: string, name: string, input: unknown, signal: AbortSignal,
  ): Promise<NodeReadToolResult> {
    signal.throwIfAborted();
    const claims = this.readScope(token);
    if (!P3_NAMES.has(name) || !claims.tools.includes(name)) throw new InvalidReadScopeError();
    const actor: TrustedActor = {
      tenantId: claims.tenantId, sessionId: claims.sessionId,
      principalId: claims.principalId, role: 'customer',
    };
    const snapshot = await this.repository.loadAuthorizedSnapshot(actor);
    if (snapshot.tenantId !== claims.tenantId || snapshot.sessionId !== claims.sessionId
      || snapshot.ownerPrincipalId !== claims.principalId || snapshot.revision !== claims.revision
      || snapshot.catalogVersionId !== claims.catalogVersionId) throw new InvalidReadScopeError();
    const currentNames = new Set((await this.listFor(actor, claims.catalogVersionId)).map(t => t.name));
    if (!currentNames.has(name)) throw new InvalidReadScopeError();
    signal.throwIfAborted();
    const result = await this.registry.invoke(actor, name, input, signal);
    // Revocation, tenant suspension and session revision changes must not
    // authorize already-fetched data. Recheck immediately before returning.
    const after = await this.repository.loadAuthorizedSnapshot(actor);
    if (after.revision !== claims.revision || after.catalogVersionId !== claims.catalogVersionId
      || after.ownerPrincipalId !== claims.principalId) throw new InvalidReadScopeError();
    if (this.readScope(token).nonce !== claims.nonce) throw new InvalidReadScopeError();
    signal.throwIfAborted();
    return result;
  }
}
