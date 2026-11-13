import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { registerP6CandidateRoute } from '../adapters/p6-candidate-route.js';
import type { ConversationTurnEngine } from '../turn-engine.js';
import type { SqlPool, SqlClient } from '../adapters/postgres-repository.js';
import type { PostgresScopedPrivacyVault } from '../adapters/p6-session-vault.js';
import type { Store } from '../../types.js';

const sessionId = '743024bc-3b9a-4e48-91d9-2e1adbc042fb';
const tenantId = '7a835f55-f78d-499f-8493-e80d116b2eb1';
const token = 'verified-p6-session-token-with-at-least-thirty-two-characters';
const hash = createHash('sha256').update(token).digest('hex');
const input = { sessionId, clientMessageId: 'p6-turn-1', message: 'Hello' };
const origin = 'http://canary.example.test';

function fixture(options: { legacy?: boolean; active?: boolean; tokenValid?: boolean; cited?: boolean } = {}) {
  let calls = 0;
  const pool = {
    async connect(): Promise<SqlClient> {
      return {
        async query(sql: string) {
          if (sql.includes('FROM chat_messages')) return {
            rows: options.legacy ? [{ '?column?': 1 }] : [], rowCount: options.legacy ? 1 : 0,
          };
          if (sql.includes('FROM source_chunks')) return {
            rows: [], rowCount: 0,
          };
          throw new Error('Unexpected query');
        },
        release() {},
      };
    },
  } as SqlPool;
  const store = {
    async getSession(id: string) {
      return id === sessionId
        ? { id, tenantId, closedAt: null, lastActivityAt: new Date().toISOString() } : null;
    },
    async getTenant(id: string) {
      return id === tenantId ? {
        id, status: options.active === false ? 'suspended' : 'active',
        publicChatEnabled: true, publicOrigin: origin,
      } : null;
    },
    async verifySessionAccessToken(id: string, candidateHash: string) {
      return options.tokenValid !== false && id === sessionId && candidateHash === hash;
    },
  } as unknown as Pick<Store, 'getSession' | 'getTenant' | 'verifySessionAccessToken'>;
  const engine = {
    async process() {
      calls++;
      return {
        revision: 1, response: {
          message: 'I can help you.', evidenceRefs: options.cited ? [sessionId] : [],
          goalCandidateKeys: [], verifiedFactPatches: [], pendingActionProposal: null,
        },
      };
    },
  } as unknown as ConversationTurnEngine;
  const vault = { async restoreForCustomer(_a: unknown, text: string) { return text; } } as PostgresScopedPrivacyVault;
  const app = express();
  app.use(express.json());
  registerP6CandidateRoute(app, {
    store, pool, engine, vault, allowedTenantIds: new Set([tenantId]),
    sessionTtlMs: 600_000, nodeEnv: 'production', localOrigin: 'http://unused',
  });
  return { app, get calls() { return calls; } };
}

describe('P6 isolated customer-facing canary route', () => {
  it('authenticates a fresh canary customer session and returns compatible chat fields', async () => {
    const f = fixture();
    const response = await request(f.app).post('/api/v1/chat/candidate/turn')
      .set('origin', origin).set('x-agentic-session-token', token).send(input);
    expect(response.status).toBe(200);
    expect(response.headers['x-chat-engine']).toBe('p6-candidate');
    expect(response.body).toMatchObject({
      answer: 'I can help you.', sessionId, citations: [], grounded: false, engine: 'p6-candidate',
    });
    expect(f.calls).toBe(1);
  });

  it('rejects absent/invalid session token before invoking a model', async () => {
    const f = fixture();
    const a = await request(f.app).post('/api/v1/chat/candidate/turn').set('origin', origin).send(input);
    const b = await request(f.app).post('/api/v1/chat/candidate/turn')
      .set('origin', origin).set('x-agentic-session-token', 'x'.repeat(40)).send(input);
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(f.calls).toBe(0);
  });

  it('rejects unapproved origins and legacy-format user turns', async () => {
    const wrongOrigin = fixture();
    const a = await request(wrongOrigin.app).post('/api/v1/chat/candidate/turn')
      .set('origin', 'http://evil.test').set('x-agentic-session-token', token).send(input);
    expect(a.status).toBe(403);
    const legacy = fixture({ legacy: true });
    const b = await request(legacy.app).post('/api/v1/chat/candidate/turn')
      .set('origin', origin).set('x-agentic-session-token', token).send(input);
    expect(b.status).toBe(409);
    expect(legacy.calls).toBe(0);
  });

  it('rejects suspended tenants and revoked citations', async () => {
    const disabled = fixture({ active: false });
    const a = await request(disabled.app).post('/api/v1/chat/candidate/turn')
      .set('origin', origin).set('x-agentic-session-token', token).send(input);
    expect(a.status).toBe(404);
    const cited = fixture({ cited: true });
    const b = await request(cited.app).post('/api/v1/chat/candidate/turn')
      .set('origin', origin).set('x-agentic-session-token', token).send(input);
    expect(b.status).toBe(503); // no current authorized chunk for claimed citation
  });
});
