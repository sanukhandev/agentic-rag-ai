import { createHash } from 'node:crypto';
import type { Express } from 'express';
import { z } from 'zod';
import type { Store, Citation } from '../../types.js';
import { sanitizeKnowledgeText } from '../../privacy.js';
import type { ConversationTurnEngine } from '../turn-engine.js';
import type { SqlPool } from './postgres-repository.js';
import { customerActorFromSessionToken } from './session-authorizer.js';
import { PostgresScopedPrivacyVault } from './p6-session-vault.js';

const requestSchema = z.object({
  sessionId: z.string().uuid(),
  clientMessageId: z.string().min(1).max(128),
  message: z.string().trim().min(1).max(4_000),
}).strict();

type CandidateStore = Pick<Store, 'getSession' | 'getTenant' | 'verifySessionAccessToken'>;

/** Bounded indexed citation read, no whole-tenant source/chunk enumeration. */
async function currentCitations(pool: SqlPool, tenantId: string, refs: readonly string[]): Promise<Citation[]> {
  if (refs.length === 0) return [];
  if (refs.length > 24 || new Set(refs).size !== refs.length
    || refs.some(ref => !/^[0-9a-f-]{36}$/iu.test(ref))) throw new Error('P6_INVALID_EVIDENCE');
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT c.id AS chunk_id, c.source_id, c.version_id, c.locator, s.title
        FROM source_chunks c
        JOIN knowledge_sources s ON s.id = c.source_id
         AND s.version_id = c.version_id AND s.tenant_id = c.tenant_id
       WHERE c.tenant_id = $1 AND s.tenant_id = $1
         AND s.status = 'active' AND s.audience = 'public'
         AND c.id = ANY($2::uuid[])
    `, [tenantId, refs]);
    const byId = new Map<string, Citation>();
    for (const row of result.rows) {
      if (typeof row.chunk_id !== 'string' || !refs.includes(row.chunk_id)) throw new Error('P6_INVALID_EVIDENCE');
      byId.set(row.chunk_id, {
        sourceId: String(row.source_id), versionId: String(row.version_id),
        chunkId: row.chunk_id, title: sanitizeKnowledgeText(String(row.title)).slice(0, 160),
        locator: sanitizeKnowledgeText(String(row.locator)).slice(0, 160),
      });
    }
    if (byId.size !== refs.length) throw new Error('P6_EVIDENCE_REVOKED');
    return refs.map(ref => byId.get(ref)!);
  } finally { client.release(); }
}

/**
 * Preview-only endpoint: never aliases the live /api/v1/chat/messages route,
 * accepts only the explicit tenant canary list and mandatory customer session token.
 * No workflow or CRM commands are issued here.
 */
export function registerP6CandidateRoute(app: Express, input: {
  store: CandidateStore;
  pool: SqlPool;
  engine: ConversationTurnEngine;
  vault: PostgresScopedPrivacyVault;
  allowedTenantIds: ReadonlySet<string>;
  sessionTtlMs: number;
  nodeEnv: string;
  localOrigin: string;
}): void {
  if (!input.allowedTenantIds.size || input.sessionTtlMs <= 0) {
    throw new Error('P6 requires a nonempty tenant allowlist and a valid session TTL');
  }
  app.post('/api/v1/chat/candidate/turn', async (req, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'P6_INVALID_INPUT' } }); return;
    }
    const token = req.header('x-agentic-session-token');
    if (!token || token.length < 32 || token.length > 8192) {
      res.status(401).json({ error: { code: 'P6_SESSION_REQUIRED' } }); return;
    }
    try {
      const { sessionId, clientMessageId, message } = parsed.data;
      const session = await input.store.getSession(sessionId);
      if (!session || !input.allowedTenantIds.has(session.tenantId)) {
        res.status(404).json({ error: { code: 'P6_NOT_AVAILABLE' } }); return;
      }
      const tenant = await input.store.getTenant(session.tenantId);
      if (!tenant || tenant.status !== 'active' || !tenant.publicChatEnabled || session.closedAt !== null
        || !Number.isFinite(Date.parse(session.lastActivityAt))
        || Date.parse(session.lastActivityAt) + input.sessionTtlMs <= Date.now()) {
        res.status(404).json({ error: { code: 'P6_NOT_AVAILABLE' } }); return;
      }
      const origin = req.header('origin');
      const allowedOrigin = tenant.publicOrigin ?? (input.nodeEnv !== 'production' ? input.localOrigin : null);
      if (!origin || !allowedOrigin || origin !== allowedOrigin) {
        res.status(403).json({ error: { code: 'P6_ORIGIN_FORBIDDEN' } }); return;
      }
      const hash = createHash('sha256').update(token, 'utf8').digest('hex');
      if (!(await input.store.verifySessionAccessToken(sessionId, hash))) {
        res.status(401).json({ error: { code: 'P6_SESSION_INVALID' } }); return;
      }
      const actor = customerActorFromSessionToken({
        tenantId: session.tenantId, sessionId, sessionAccessToken: token,
      });
      // A session containing a legacy-format user message must never be
      // silently repurposed for P6. Use a fresh session for preview.
      const legacy = await input.pool.connect();
      try {
        const result = await legacy.query(`
          SELECT 1 FROM chat_messages
           WHERE tenant_id = $1 AND session_id = $2 AND role = 'user'
             AND (response IS NULL OR response->>'coreTurnVersion' IS DISTINCT FROM '1')
           LIMIT 1
        `, [actor.tenantId, actor.sessionId]);
        if (result.rows.length > 0) {
          res.status(409).json({ error: { code: 'P6_FRESH_SESSION_REQUIRED' } }); return;
        }
      } finally { legacy.release(); }

      const result = await input.engine.process(actor, { clientMessageId, text: message });
      const citations = await currentCitations(input.pool, actor.tenantId, result.response.evidenceRefs);
      const answer = await input.vault.restoreForCustomer(actor, result.response.message);
      res.setHeader('X-Chat-Engine', 'p6-candidate');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        sessionId, clientMessageId, answer, citations,
        grounded: citations.length > 0, conversational: true,
        engine: 'p6-candidate', revision: result.revision,
        // pendingActionProposal is a persistence-only suggestion; deliberately
        // not surfaced as an executable or confirmed action in the current UI.
      });
    } catch {
      res.status(503).json({ error: { code: 'P6_TURN_UNAVAILABLE',
        message: 'The candidate conversation could not be completed.' } });
    }
  });
}
