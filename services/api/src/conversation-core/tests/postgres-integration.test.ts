import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresConversationRepository } from '../adapters/postgres-repository.js';
import { ExistingSessionTokenAuthorizer, customerActorFromSessionToken } from '../adapters/session-authorizer.js';

/**
 * Optional REAL PostgreSQL test. Requires fully migrated, disposable local
 * database. Never connect this suite to an existing customer/production DB.
 * Example: P2_TEST_DATABASE_URL=postgres://.../agentic_rag_p2_test
 */
const url = process.env.P2_TEST_DATABASE_URL;
const dbSuite = url ? describe : describe.skip;

// Distinct UUIDs and a unique tenant name ensure tests can be safely cleaned.
const tenantId = randomUUID();
const sessionId = randomUUID();
const personaId = randomUUID();
const catalogId = randomUUID();
const token = 'candidate-test-session-token';
const actor = customerActorFromSessionToken({ tenantId, sessionId, sessionAccessToken: token });
const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const response = {
  message: 'I can help you explore the process.', evidenceRefs: [], goalCandidateKeys: ['company_formation'],
  verifiedFactPatches: [], pendingActionProposal: null,
};

let pool: Pool | undefined;

dbSuite('P2 disposable PostgreSQL integration', () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
    if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)
      || !/(?:^|[_-])test(?:$|[_-])/iu.test(database)) {
      throw new Error('P2_TEST_DATABASE_URL must point to a local disposable database with test in its name');
    }
    pool = new Pool({ connectionString: url!, max: 3 });
    await pool.query('SELECT 1 FROM chat_sessions LIMIT 0'); // schema preflight
    await pool.query('SELECT 1 FROM intent_catalog_v2_versions LIMIT 0');
    await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1, $2, $3, 'active')`,
      [tenantId, 'P2 isolated test tenant', `p2-${tenantId.slice(0, 8)}`]);
    await pool.query(`
      INSERT INTO persona_versions (id, tenant_id, version, status, name, greeting, personality,
        tone, speaking_style, permitted_languages)
      VALUES ($1, $2, 1, 'published', 'Test Assistant', 'Hello', 'Helpful', 'Neutral', 'Concise', ARRAY['en'])
    `, [personaId, tenantId]);
    await pool.query(`
      INSERT INTO intent_catalog_v2_versions (id, tenant_id, version, status, source_file_name,
        source_hash, parser_version, catalog_json, catalog_version_ref)
      VALUES ($1,$2,1,'published','test.json',$3,'p2-test',$4::jsonb,$5)
    `, [catalogId, tenantId, 'a'.repeat(64), JSON.stringify({ sheets: { BusinessGoals: [
      { businessGoalKey: 'company_formation', active: true },
    ] } }), `p2-test-${catalogId}`]);
    await pool.query('INSERT INTO chat_sessions (id, tenant_id) VALUES ($1, $2)', [sessionId, tenantId]);
  });

  afterAll(async () => {
    if (pool) {
      try { await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]); }
      finally { await pool.end(); }
    }
  });

  it('commits/reloads a turn and preserves state after a new repository instance', async () => {
    const assertMasked = {
      async assertSafeMaskedText(_actor: unknown, text: string) {
        if (text.includes('@')) throw new Error('Unmasked private content');
      },
    };
    const authorizer = new ExistingSessionTokenAuthorizer({
      async verifySessionAccessToken(id, tokenHash) { return id === sessionId && tokenHash === actor.principalId; },
    });
    const repo = new PostgresConversationRepository(pool!, authorizer, assertMasked);
    const snapshot = await repo.loadAuthorizedSnapshot(actor);
    expect(snapshot.revision).toBe(0);
    expect(snapshot.publishedGoalKeys).toEqual(['company_formation']);

    const params = {
      expectedRevision: 0, clientMessageId: 'p2-db-turn-1', customerMessage: 'Start a business',
      requestDigest: digest('Start a business'), personaVersionId: personaId,
      catalogVersionId: catalogId, response,
    };
    const result = await repo.commitTurn(actor, params);
    expect(result.revision).toBe(1);
    const replay = await new PostgresConversationRepository(pool!, authorizer, assertMasked).commitTurn(actor, params);
    expect(replay).toEqual(result);
    // Both rows use DEFAULT now() inside the SAME transaction. PostgreSQL
    // assigns them an identical timestamp, so random UUID sorting alone
    // must never determine their conversational order.
    const stored = await pool!.query<{ role: string; created_at: Date }>(
      `SELECT role, created_at FROM chat_messages WHERE tenant_id = $1 AND session_id = $2
        AND (client_message_id = $3 OR (role = 'assistant' AND masked_content = $4))`,
      [tenantId, sessionId, params.clientMessageId, response.message],
    );
    expect(stored.rows).toHaveLength(2);
    expect(new Set(stored.rows.map(row => row.created_at.getTime())).size).toBe(1);

    const loaded = await repo.loadAuthorizedSnapshot(actor);
    expect(loaded.recentTurns.map(row => row.role)).toEqual(['customer', 'assistant']);
    expect(loaded.recentTurns.map(row => row.text)).toEqual([
      'Start a business', response.message,
    ]);
    expect(loaded.catalogVersionId).toBe(catalogId);
    expect(loaded.personaVersionId).toBe(personaId);
    await expect(repo.commitTurn(actor, {
      ...params, clientMessageId: 'p2-db-stale-turn', requestDigest: digest('Other turn'),
    })).rejects.toMatchObject({ code: 'STALE_REVISION' });
  });
});
