import { randomUUID } from 'node:crypto';
import type {
  ConversationRepository, PersistedTurn, SessionSnapshot, TrustedActor, VerifiedFact, VerifiedResponse,
} from '../contracts.js';
import {
  buildSessionSnapshot, extractCoreMemory,
  type ActionRow, type CatalogRow, type MessageRow, type PersonaRow, type SessionRow,
} from './context-builder.js';
import { SessionPermissionError, type AuthorizedSession, type SessionAuthorizer } from './session-authorizer.js';

/** Structurally compatible with node-postgres Pool/PoolClient. */
export interface SqlClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release(): void;
}
export interface SqlPool {
  connect(): Promise<SqlClient>;
}

/** Must be provided by a reviewed privacy adapter; no permissive default. */
export interface MaskedPersistencePolicy {
  assertSafeMaskedText(actor: TrustedActor, value: string, category: 'message' | 'fact' | 'summary'): Promise<void>;
}

export class ConversationPersistenceError extends Error {
  constructor(readonly code: 'STALE_REVISION' | 'REPLAY_CONFLICT' | 'MISSING_CONFIG' | 'INVALID_STATE', message: string) {
    super(message);
    this.name = 'ConversationPersistenceError';
  }
}

interface MessageResultRow {
  role: string;
  response: unknown;
}

function obj(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
}

function expectRow<Row>(rows: readonly Record<string, unknown>[], message: string): Row {
  if (!rows[0]) throw new ConversationPersistenceError('MISSING_CONFIG', message);
  return rows[0] as Row;
}

function maybeStoredTurn(row: MessageResultRow | undefined, actor: TrustedActor, clientMessageId: string, requestDigest: string): PersistedTurn | null {
  if (!row) return null;
  if (row.role !== 'user') throw new ConversationPersistenceError('REPLAY_CONFLICT', 'Existing client message ID is not a customer turn');
  const wrapper = obj(row.response);
  if (wrapper.coreTurnVersion !== 1 || typeof wrapper.requestDigest !== 'string'
      || !Number.isSafeInteger(wrapper.revision) || !wrapper.response) {
    throw new ConversationPersistenceError('REPLAY_CONFLICT', 'Existing turn is not compatible with the candidate engine');
  }
  if (wrapper.requestDigest !== requestDigest) {
    throw new ConversationPersistenceError('REPLAY_CONFLICT', 'Client message ID reused with different input');
  }
  const response = obj(wrapper.response);
  if (typeof response.message !== 'string' || !Array.isArray(response.evidenceRefs)
      || !Array.isArray(response.goalCandidateKeys) || !Array.isArray(response.verifiedFactPatches)
      || !('pendingActionProposal' in response)) {
    throw new ConversationPersistenceError('REPLAY_CONFLICT', 'Malformed stored response');
  }
  return {
    sessionId: actor.sessionId, clientMessageId, requestDigest,
    revision: Number(wrapper.revision), response: response as unknown as VerifiedResponse,
  };
}

async function single(client: SqlClient, sql: string, params: unknown[] = []): Promise<Record<string, unknown> | undefined> {
  return (await client.query(sql, params)).rows[0];
}

/**
 * Uses existing 001/012/017/028/055/056 migration tables. No schema mutation.
 * All public actor information must have been constructed from verified
 * session credentials. Every operation independently checks token validity.
 */
export class PostgresConversationRepository implements ConversationRepository {
  constructor(
    private readonly pool: SqlPool,
    private readonly authorizer: SessionAuthorizer,
    private readonly persistencePolicy: MaskedPersistencePolicy,
  ) {}

  private async activeSession(client: SqlClient, actor: TrustedActor, forUpdate = false): Promise<SessionRow> {
    const row = await single(client, `
      SELECT s.id, s.tenant_id, s.state_version, s.persona_version_id,
             s.conversation_state, s.closed_at, t.status AS tenant_status
        FROM chat_sessions s JOIN tenants t ON t.id = s.tenant_id
       WHERE s.id = $1 AND s.tenant_id = $2
       ${forUpdate ? 'FOR UPDATE OF s' : ''}
    `, [actor.sessionId, actor.tenantId]);
    if (!row) throw new SessionPermissionError();
    const session = row as unknown as SessionRow;
    const authSession: AuthorizedSession = {
      tenantId: session.tenant_id, sessionId: session.id,
      closedAt: session.closed_at === null ? null : String(session.closed_at),
      tenantStatus: session.tenant_status,
    };
    await this.authorizer.assertAuthorized(actor, authSession);
    return session;
  }

  async findExistingTurn(actor: TrustedActor, clientMessageId: string, requestDigest: string): Promise<PersistedTurn | null> {
    const client = await this.pool.connect();
    try {
      await this.activeSession(client, actor);
      const row = await single(client, `
        SELECT role, response FROM chat_messages
         WHERE tenant_id = $1 AND session_id = $2 AND client_message_id = $3
         LIMIT 1
      `, [actor.tenantId, actor.sessionId, clientMessageId]);
      return maybeStoredTurn(row as unknown as MessageResultRow | undefined, actor, clientMessageId, requestDigest);
    } finally { client.release(); }
  }

  async loadAuthorizedSnapshot(actor: TrustedActor): Promise<SessionSnapshot> {
    const client = await this.pool.connect();
    let inTransaction = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      inTransaction = true;
      const session = await this.activeSession(client, actor);
      const memory = extractCoreMemory(session.conversation_state);
      const persona = expectRow<PersonaRow>((await client.query(`
        SELECT id, name, greeting, personality, tone, speaking_style, permitted_languages
          FROM persona_versions
         WHERE tenant_id = $1
           AND (id::text = $2 OR ($2 = '' AND status = 'published'))
         ORDER BY version DESC LIMIT 1
      `, [actor.tenantId, session.persona_version_id ?? ''])).rows, 'No authorized tenant persona');
      const pinnedCatalog = memory.catalogVersionId && memory.catalogVersionId !== 'unconfigured'
        ? memory.catalogVersionId : '';
      const permanentlyUnconfigured = memory.catalogVersionId === 'unconfigured';
      const catalogRow = permanentlyUnconfigured ? undefined : await single(client, `
        SELECT id, catalog_json FROM business_catalog_versions
         WHERE tenant_id = $1
           AND (id::text = $2 OR ($2 = '' AND status = 'published'))
         ORDER BY version DESC LIMIT 1
      `, [actor.tenantId, pinnedCatalog]);
      // A pinned version must never silently shift to another tenant/version.
      if (pinnedCatalog && !catalogRow) throw new ConversationPersistenceError('MISSING_CONFIG', 'Pinned catalog is unavailable');
      const messages = await client.query(`
        SELECT role, masked_content FROM chat_messages
         WHERE tenant_id = $1 AND session_id = $2
         -- now() is transaction-stable: a customer and assistant message
         -- committed in one turn have identical created_at values. Break the
         -- tie by turn role, not random UUID, so reversing newest-first
         -- rows always yields customer -> assistant for each committed turn.
         ORDER BY created_at DESC,
                  CASE role WHEN 'assistant' THEN 1 ELSE 0 END DESC,
                  id DESC LIMIT 16
      `, [actor.tenantId, actor.sessionId]);
      const actions = await client.query(`
        SELECT id, workflow_key, state FROM action_requests
         WHERE tenant_id = $1 AND session_id = $2
         ORDER BY created_at DESC, id DESC LIMIT 32
      `, [actor.tenantId, actor.sessionId]);
      const result = buildSessionSnapshot({
        session, principalId: actor.principalId, persona,
        catalog: catalogRow as unknown as CatalogRow | null ?? null,
        messagesNewestFirst: messages.rows as unknown as MessageRow[],
        actionsNewestFirst: actions.rows as unknown as ActionRow[],
      });
      await client.query('COMMIT');
      inTransaction = false;
      return result;
    } catch (error) {
      if (inTransaction) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async commitTurn(actor: TrustedActor, input: {
    readonly expectedRevision: number;
    readonly clientMessageId: string;
    readonly customerMessage: string;
    readonly requestDigest: string;
    readonly personaVersionId: string;
    readonly catalogVersionId: string;
    readonly response: VerifiedResponse;
  }): Promise<PersistedTurn> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
        || !/^[a-f0-9]{64}$/u.test(input.requestDigest)
        || !input.clientMessageId || input.clientMessageId.length > 128) {
      throw new ConversationPersistenceError('INVALID_STATE', 'Invalid turn persistence contract');
    }
    await Promise.all([
      this.persistencePolicy.assertSafeMaskedText(actor, input.customerMessage, 'message'),
      this.persistencePolicy.assertSafeMaskedText(actor, input.response.message, 'message'),
      ...input.response.verifiedFactPatches.map(f => this.persistencePolicy.assertSafeMaskedText(actor, f.value, 'fact')),
    ]);
    const client = await this.pool.connect();
    let inTransaction = false;
    try {
      await client.query('BEGIN');
      inTransaction = true;
      const session = await this.activeSession(client, actor, true);
      // Recheck idempotency UNDER session row lock; a racing first request must
      // never produce a second assistant message or duplicate fact patches.
      const existing = await single(client, `
        SELECT role, response FROM chat_messages
         WHERE tenant_id = $1 AND session_id = $2 AND client_message_id = $3 LIMIT 1
      `, [actor.tenantId, actor.sessionId, input.clientMessageId]);
      const prior = maybeStoredTurn(existing as unknown as MessageResultRow | undefined, actor, input.clientMessageId, input.requestDigest);
      if (prior) {
        await client.query('COMMIT');
        inTransaction = false;
        return prior;
      }
      if (session.state_version !== input.expectedRevision) {
        throw new ConversationPersistenceError('STALE_REVISION', 'Session was modified by another turn');
      }
      const memory = extractCoreMemory(session.conversation_state);
      if (session.persona_version_id && session.persona_version_id !== input.personaVersionId) {
        throw new ConversationPersistenceError('STALE_REVISION', 'Session persona changed');
      }
      if (memory.catalogVersionId && memory.catalogVersionId !== input.catalogVersionId) {
        throw new ConversationPersistenceError('STALE_REVISION', 'Session catalog changed');
      }
      const nextRevision = input.expectedRevision + 1;
      const facts = new Map<string, VerifiedFact>((memory.verifiedFacts ?? []).map(f => [f.key, f]));
      for (const fact of input.response.verifiedFactPatches) {
        if (!fact.key || fact.key.length > 100 || fact.value.length > 4_000
            || !Number.isSafeInteger(fact.revision) || fact.revision < 0) {
          throw new ConversationPersistenceError('INVALID_STATE', 'Unvalidated customer fact');
        }
        facts.set(fact.key, fact);
      }
      // Patch only the additive `conversationCore` property. Preserve all
      // legacy keys, RAG rows and existing user_intent_documents untouched.
      const corePatch = {
        catalogVersionId: input.catalogVersionId,
        verifiedFacts: [...facts.values()],
        // These are unconfirmed hypotheses, not consent or authorization.
        provisionalGoalKeys: input.response.goalCandidateKeys.length > 0
          ? [...new Set(input.response.goalCandidateKeys)].slice(0, 8)
          : (memory.provisionalGoalKeys ?? []),
        ...(memory.summary !== undefined ? { summary: memory.summary } : {}),
        ...(memory.summaryRevision !== undefined ? { summaryRevision: memory.summaryRevision } : {}),
      };
      const wrapper = {
        coreTurnVersion: 1, requestDigest: input.requestDigest,
        revision: nextRevision, response: input.response,
      };
      await client.query(`
        INSERT INTO chat_messages (id, session_id, tenant_id, role, masked_content, client_message_id, response)
        VALUES ($1, $2, $3, 'user', $4, $5, $6::jsonb)
      `, [randomUUID(), actor.sessionId, actor.tenantId, input.customerMessage, input.clientMessageId, JSON.stringify(wrapper)]);
      await client.query(`
        INSERT INTO chat_messages (id, session_id, tenant_id, role, masked_content, client_message_id)
        VALUES ($1, $2, $3, 'assistant', $4, NULL)
      `, [randomUUID(), actor.sessionId, actor.tenantId, input.response.message]);
      const updated = await client.query(`
        UPDATE chat_sessions
           SET state_version = $3,
               persona_version_id = COALESCE(persona_version_id, $4::uuid),
               last_activity_at = now(),
               conversation_state = jsonb_set(
                 COALESCE(conversation_state, '{}'::jsonb), '{conversationCore}', $5::jsonb, true)
         WHERE id = $1 AND tenant_id = $2 AND state_version = $6
           AND closed_at IS NULL
      `, [actor.sessionId, actor.tenantId, nextRevision, input.personaVersionId, JSON.stringify(corePatch), input.expectedRevision]);
      if (updated.rowCount !== 1) {
        throw new ConversationPersistenceError('STALE_REVISION', 'Concurrent session modification');
      }
      await client.query('COMMIT');
      inTransaction = false;
      return {
        sessionId: actor.sessionId, clientMessageId: input.clientMessageId,
        requestDigest: input.requestDigest, revision: nextRevision, response: input.response,
      };
    } catch (error) {
      if (inTransaction) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  /** Prepared for P4 summarization. Masked, tenant-scoped, CAS and no source mutation. */
  async updateDurableSummary(actor: TrustedActor, input: {
    readonly expectedRevision: number;
    readonly maskedSummary: string;
  }): Promise<number> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
        || input.maskedSummary.length > 6_000) {
      throw new ConversationPersistenceError('INVALID_STATE', 'Invalid summary update');
    }
    await this.persistencePolicy.assertSafeMaskedText(actor, input.maskedSummary, 'summary');
    const client = await this.pool.connect();
    let inTransaction = false;
    try {
      await client.query('BEGIN');
      inTransaction = true;
      const session = await this.activeSession(client, actor, true);
      if (session.state_version !== input.expectedRevision) {
        throw new ConversationPersistenceError('STALE_REVISION', 'Cannot overwrite newer session summary');
      }
      const memory = extractCoreMemory(session.conversation_state);
      const corePatch = {
        ...memory,
        summary: input.maskedSummary,
        summaryRevision: (memory.summaryRevision ?? 0) + 1,
      };
      const result = await client.query(`
        UPDATE chat_sessions SET
          state_version = $3,
          conversation_state = jsonb_set(COALESCE(conversation_state, '{}'::jsonb), '{conversationCore}', $4::jsonb, true)
         WHERE id = $1 AND tenant_id = $2 AND state_version = $5 AND closed_at IS NULL
      `, [actor.sessionId, actor.tenantId, input.expectedRevision + 1, JSON.stringify(corePatch), input.expectedRevision]);
      if (result.rowCount !== 1) throw new ConversationPersistenceError('STALE_REVISION', 'Concurrent summary update');
      await client.query('COMMIT');
      inTransaction = false;
      return input.expectedRevision + 1;
    } catch (error) {
      if (inTransaction) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}
