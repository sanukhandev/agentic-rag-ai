import type { Session } from '../../types.js';
import { TokenVault, maskPiiForSession, rehydrateForSession, sanitizeSensitiveText } from '../../privacy.js';
import type { TrustedActor } from '../contracts.js';
import type { SqlClient, SqlPool } from './postgres-repository.js';
import type { SessionAuthorizer } from './session-authorizer.js';
import type { ScopedPrivacyVault } from './privacy-adapter.js';

const PLACEHOLDERS = /\[(?:EMAIL|PHONE|NAME|ID)_\d+\]/gu;
const TOKEN_KEY = /^\[(?:EMAIL|PHONE|NAME|ID)_\d+\]$/u;

export class P6PrivacyError extends Error {
  constructor() { super('Conversation privacy scope unavailable'); this.name = 'P6PrivacyError'; }
}

/**
 * Durable, tenant/session-scoped AES-GCM vault using existing session_tokens
 * and the existing TokenVault ciphertext format; no new schema or raw PII writes.
 *
 * Locking chat_sessions serializes placeholder assignment across workers.
 * The lock is compatible with P2 commitTurn, which also locks chat_sessions.
 * It deliberately does NOT bump chat_sessions.state_version.
 */
export class PostgresScopedPrivacyVault implements ScopedPrivacyVault {
  private readonly crypto: TokenVault;
  constructor(private readonly pool: SqlPool, private readonly authorizer: SessionAuthorizer,
    key: string, private readonly maxTokens = 512) {
    if (key.length < 32 || /^(?:replace-with|local-development|change-me)/iu.test(key)) {
      throw new Error('P6 requires an independent production-grade PII vault key');
    }
    this.crypto = new TokenVault(key);
  }

  private async access<T>(actor: TrustedActor, lock: boolean,
    handler: (client: SqlClient, session: Session) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let started = false;
    try {
      await client.query('BEGIN');
      started = true;
      const rows = await client.query(`
        SELECT s.id, s.tenant_id, s.closed_at, t.status AS tenant_status
          FROM chat_sessions s JOIN tenants t ON t.id = s.tenant_id
         WHERE s.id = $1 AND s.tenant_id = $2
         ${lock ? 'FOR UPDATE OF s' : ''}
      `, [actor.sessionId, actor.tenantId]);
      const row = rows.rows[0];
      if (!row) throw new P6PrivacyError();
      await this.authorizer.assertAuthorized(actor, {
        tenantId: String(row.tenant_id), sessionId: String(row.id),
        closedAt: row.closed_at === null ? null : String(row.closed_at),
        tenantStatus: String(row.tenant_status),
      });
      const persisted = await client.query('SELECT token, ciphertext FROM session_tokens WHERE session_id = $1',
        [actor.sessionId]);
      if (persisted.rows.length > this.maxTokens) throw new P6PrivacyError();
      const tokens = new Map<string, string>();
      for (const item of persisted.rows) {
        if (typeof item.token !== 'string' || !TOKEN_KEY.test(item.token)
          || typeof item.ciphertext !== 'string' || tokens.has(item.token)) throw new P6PrivacyError();
        tokens.set(item.token, item.ciphertext);
      }
      const session = { id: actor.sessionId, tenantId: actor.tenantId, tokenMap: tokens } as Session;
      const value = await handler(client, session);
      await client.query('COMMIT');
      started = false;
      return value;
    } catch (error) {
      if (started) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async maskAndPersist(actor: TrustedActor, rawText: string): Promise<string> {
    if (typeof rawText !== 'string' || rawText.length > 4_000) throw new P6PrivacyError();
    return this.access(actor, true, async (client, session) => {
      const previous = new Set(session.tokenMap.keys());
      const masked = sanitizeSensitiveText(maskPiiForSession(session, rawText, this.crypto));
      if (session.tokenMap.size > this.maxTokens) throw new P6PrivacyError();
      for (const [token, ciphertext] of session.tokenMap) {
        if (!previous.has(token)) {
          await client.query('INSERT INTO session_tokens (session_id, token, ciphertext) VALUES ($1, $2, $3)',
            [actor.sessionId, token, ciphertext]);
        }
      }
      return masked;
    });
  }

  async assertMaskedAndKnown(actor: TrustedActor, text: string): Promise<void> {
    if (typeof text !== 'string' || text.length > 20_000 || sanitizeSensitiveText(text) !== text) {
      throw new P6PrivacyError();
    }
    await this.access(actor, false, async (_client, session) => {
      for (const token of new Set(text.match(PLACEHOLDERS) ?? [])) {
        if (!this.crypto.has(session, token)) throw new P6PrivacyError();
      }
    });
  }

  /** Only an independently authenticated customer may request scoped rehydration. */
  async restoreForCustomer(actor: TrustedActor, masked: string): Promise<string> {
    await this.assertMaskedAndKnown(actor, masked);
    return this.access(actor, false, async (_client, session) => rehydrateForSession(session, masked, this.crypto));
  }
}
