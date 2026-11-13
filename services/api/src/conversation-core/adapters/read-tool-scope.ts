import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Store } from '../../types.js';
import { isAuthorizedReadTool } from '../authorization/read-tool-policy.js';
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
const readNames = new Set([
  'search_knowledge', 'get_conversation_summary', 'get_verified_customer_facts', 'list_supported_goals',
]);
const MAX_AGE_MS = 120_000;
const MAX_TOKEN_LENGTH = 4096;
const TOOL_NAME = /^[a-z][a-z0-9_]{1,79}$/u;

export class InvalidReadScopeError extends Error {
  constructor() {
    super('Invalid, expired or unauthorized read-tool scope');
    this.name = 'InvalidReadScopeError';
  }
}

function valid(value: unknown): value is ScopeClaims {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Partial<ScopeClaims>;
  return v.v === 1 && typeof v.tenantId === 'string' && v.tenantId.length > 0
    && typeof v.sessionId === 'string' && v.sessionId.length > 0
    && typeof v.principalId === 'string' && /^[a-f0-9]{64}$/u.test(v.principalId)
    && typeof v.catalogVersionId === 'string' && v.catalogVersionId.length <= 128
    && typeof v.revision === 'number' && Number.isSafeInteger(v.revision) && v.revision >= 0
    && Array.isArray(v.tools) && v.tools.length <= readNames.size
    && new Set(v.tools).size === v.tools.length
    && v.tools.every(x => typeof x === 'string' && readNames.has(x))
    && typeof v.expiresAt === 'number' && Number.isSafeInteger(v.expiresAt) && v.expiresAt > 0
    && typeof v.nonce === 'string' && /^[0-9a-f-]{36}$/u.test(v.nonce);
}

/** Every invocation reauthorizes the session both before and after tool access. */
export class ScopedP3ReadTools implements ReadToolCatalog {
  private readonly key: Buffer;
  constructor(
    secret: string,
    private readonly repository: ConversationRepository,
    private readonly catalogReader: CatalogReader,
    private readonly registry: NodeReadToolRegistry,
    private readonly now: () => number = Date.now,
  ) {
    if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Read scope key must be >= 32 bytes');
    this.key = Buffer.from(secret, 'utf8');
  }
  private mac(text: string): Buffer { return createHmac('sha256', this.key).update(text).digest(); }
  private decode(token: string): ScopeClaims {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) throw new InvalidReadScopeError();
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]
      || !/^[\w-]+$/u.test(parts[0]) || !/^[\w-]+$/u.test(parts[1])) throw new InvalidReadScopeError();
    const calculated = this.mac(parts[0]);
    const given = Buffer.from(parts[1], 'base64url');
    if (given.length !== calculated.length || !timingSafeEqual(given, calculated)) {
      throw new InvalidReadScopeError();
    }
    let value: unknown;
    try { value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
    catch { throw new InvalidReadScopeError(); }
    if (!valid(value) || value.expiresAt <= this.now() || value.expiresAt > this.now() + MAX_AGE_MS) {
      throw new InvalidReadScopeError();
    }
    return value;
  }
  verifiedTenantForScope(token: string): string { return this.decode(token).tenantId; }

  async listFor(actor: TrustedActor, catalogVersionId: string): Promise<readonly ReadToolDefinition[]> {
    const session = await this.repository.loadAuthorizedSnapshot(actor);
    if (actor.role !== 'customer' || session.ownerPrincipalId !== actor.principalId
      || session.tenantId !== actor.tenantId || session.sessionId !== actor.sessionId
      || session.catalogVersionId !== catalogVersionId) throw new InvalidReadScopeError();
    const published = catalogVersionId === 'unconfigured' ? null
      : await this.catalogReader.getIntentCatalogV2Version(actor.tenantId, catalogVersionId);
    if (published && (published.id !== catalogVersionId || published.tenantId !== actor.tenantId
      || published.status !== 'published')) throw new InvalidReadScopeError();
    return this.registry.listDefinitions().filter(def => readNames.has(def.name)
      && isAuthorizedReadTool(published?.catalog ?? null, def.name));
  }

  async issueBoundScope(actor: TrustedActor, catalogVersionId: string,
    tools: readonly ReadToolDefinition[], sessionRevision: number): Promise<string> {
    const session = await this.repository.loadAuthorizedSnapshot(actor);
    if (!Number.isSafeInteger(sessionRevision) || sessionRevision < 0
      || session.revision !== sessionRevision || session.catalogVersionId !== catalogVersionId
      || session.ownerPrincipalId !== actor.principalId || session.tenantId !== actor.tenantId
      || session.sessionId !== actor.sessionId) throw new InvalidReadScopeError();
    const allowed = new Set((await this.listFor(actor, catalogVersionId)).map(t => t.name));
    const names = tools.map(t => t.name);
    if (new Set(names).size !== names.length
      || names.some(name => !allowed.has(name) || !TOOL_NAME.test(name))) {
      throw new InvalidReadScopeError();
    }
    const claims: ScopeClaims = {
      v: 1, tenantId: actor.tenantId, sessionId: actor.sessionId,
      principalId: actor.principalId, catalogVersionId, revision: sessionRevision,
      tools: names, expiresAt: this.now() + MAX_AGE_MS, nonce: randomUUID(),
    };
    const encoded = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    return encoded + '.' + this.mac(encoded).toString('base64url');
  }

  async executeBound(token: string, name: string, input: unknown, signal: AbortSignal):
    Promise<NodeReadToolResult> {
    signal.throwIfAborted();
    const claims = this.decode(token);
    if (!readNames.has(name) || !claims.tools.includes(name)) throw new InvalidReadScopeError();
    const actor: TrustedActor = {
      tenantId: claims.tenantId, sessionId: claims.sessionId,
      principalId: claims.principalId, role: 'customer',
    };
    const before = await this.repository.loadAuthorizedSnapshot(actor);
    if (before.ownerPrincipalId !== claims.principalId || before.revision !== claims.revision
      || before.tenantId !== claims.tenantId || before.sessionId !== claims.sessionId
      || before.catalogVersionId !== claims.catalogVersionId) throw new InvalidReadScopeError();
    const enabled = new Set((await this.listFor(actor, claims.catalogVersionId)).map(d => d.name));
    if (!enabled.has(name)) throw new InvalidReadScopeError();
    const result = await this.registry.invoke(actor, name, input, signal);
    const after = await this.repository.loadAuthorizedSnapshot(actor);
    if (after.revision !== claims.revision || after.ownerPrincipalId !== claims.principalId
      || after.catalogVersionId !== claims.catalogVersionId || this.decode(token).nonce !== claims.nonce) {
      throw new InvalidReadScopeError();
    }
    signal.throwIfAborted();
    return result;
  }
}
