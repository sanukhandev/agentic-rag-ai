import { createHash } from 'node:crypto';
import type { Express } from 'express';
import { z } from 'zod';
import type { Store, Citation } from '../../types.js';
import { sanitizeKnowledgeText } from '../../privacy.js';
import type { ConversationTurnEngine } from '../turn-engine.js';
import type { SqlPool } from '../adapters/postgres-repository.js';
import { customerActorFromSessionToken } from '../adapters/session-authorizer.js';
import { PostgresScopedPrivacyVault } from '../adapters/p6-session-vault.js';

const requestSchema = z.object({
  sessionId: z.string().uuid(),
  clientMessageId: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(4000),
  type: z.literal('text').optional(),
}).strict();

type CustomerStore = Pick<Store, 'getSession' | 'getTenant' | 'verifySessionAccessToken'>;

/**
 * Resolve only authorized, current citations with one bounded database query.
 * The LLM cannot provide citation metadata, only Node-minted source IDs.
 */
async function resolveCitations(pool: SqlPool, tenantId: string, refs: readonly string[]): Promise<Citation[]> {
  if (refs.length === 0) return [];
  if (refs.length > 8 || new Set(refs).size !== refs.length
    || refs.some(id => !/^[a-f0-9-]{36}$/iu.test(id))) throw new Error('INVALID_CITATION');
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT c.id AS chunk_id, c.source_id, c.version_id, c.locator, s.title
        FROM source_chunks c
        JOIN knowledge_sources s ON s.id = c.source_id
         AND s.version_id = c.version_id AND s.tenant_id = c.tenant_id
       WHERE c.tenant_id = $1 AND c.id = ANY($2::uuid[])
         AND s.tenant_id = $1 AND s.status = 'active' AND s.audience = 'public'
    `, [tenantId, refs]);
    const found = new Map<string, Citation>();
    for (const row of result.rows) {
      if (typeof row.chunk_id !== 'string' || !refs.includes(row.chunk_id)) {
        throw new Error('INVALID_CITATION');
      }
      found.set(row.chunk_id, {
        sourceId: String(row.source_id), versionId: String(row.version_id),
        chunkId: row.chunk_id,
        title: sanitizeKnowledgeText(String(row.title)).slice(0,160),
        locator: sanitizeKnowledgeText(String(row.locator)).slice(0,160),
      });
    }
    if (found.size !== refs.length) throw new Error('REVOKED_CITATION');
    return refs.map(id => found.get(id)!);
  } finally { client.release(); }
}

export interface CustomerTurnRouteDependencies {
  readonly store: CustomerStore;
  readonly pool: SqlPool;
  readonly engine: ConversationTurnEngine;
  readonly vault: PostgresScopedPrivacyVault;
  readonly sessionTtlMs: number;
  readonly nodeEnv: string;
  readonly localOrigin: string;
}

/**
 * Single customer turn endpoint. No compatibility controller or workflow dispatch.
 * Non-factual dialogue and factual replies both go through the same GPT-first engine.
 */
export function registerCustomerTurnRoute(app: Express, deps: CustomerTurnRouteDependencies): void {
  if (!Number.isFinite(deps.sessionTtlMs) || deps.sessionTtlMs <= 0) {
    throw new Error('Invalid session TTL');
  }
  app.post('/api/v1/chat/messages', async (req, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'CHAT_INVALID_INPUT' } }); return;
    }
    const bearer = req.header('x-agentic-session-token');
    if (!bearer || bearer.length < 32 || bearer.length > 8192) {
      res.status(401).json({ error: { code: 'CHAT_SESSION_REQUIRED' } }); return;
    }
    try {
      const { sessionId, clientMessageId, message } = parsed.data;
      const session = await deps.store.getSession(sessionId);
      if (!session || session.closedAt !== null
        || !Number.isFinite(Date.parse(session.lastActivityAt))
        || Date.parse(session.lastActivityAt) + deps.sessionTtlMs <= Date.now()) {
        res.status(404).json({ error: { code: 'CHAT_SESSION_UNAVAILABLE' } }); return;
      }
      const tenant = await deps.store.getTenant(session.tenantId);
      if (!tenant || tenant.status !== 'active' || !tenant.publicChatEnabled) {
        res.status(404).json({ error: { code: 'CHAT_SESSION_UNAVAILABLE' } }); return;
      }
      const origin = req.header('origin');
      const allowed = tenant.publicOrigin ?? (deps.nodeEnv !== 'production' ? deps.localOrigin : null);
      if (!origin || !allowed || origin !== allowed) {
        res.status(403).json({ error: { code: 'CHAT_ORIGIN_FORBIDDEN' } }); return;
      }
      const tokenHash = createHash('sha256').update(bearer, 'utf8').digest('hex');
      if (!await deps.store.verifySessionAccessToken(session.id, tokenHash)) {
        res.status(401).json({ error: { code: 'CHAT_SESSION_INVALID' } }); return;
      }
      const actor = customerActorFromSessionToken({
        tenantId: session.tenantId, sessionId: session.id, sessionAccessToken: bearer,
      });
      const result = await deps.engine.process(actor, { clientMessageId, text: message });
      const citations = await resolveCitations(deps.pool, actor.tenantId, result.response.evidenceRefs);
      const answer = await deps.vault.restoreForCustomer(actor, result.response.message);
      res.setHeader('X-Chat-Engine', 'conversation-core');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        sessionId, clientMessageId, answer, citations,
        grounded: citations.length > 0, conversational: true,
        revision: result.revision,
      });
    } catch {
      res.status(503).json({ error: {
        code: 'CHAT_TURN_UNAVAILABLE',
        message: 'The conversation could not be completed.',
      } });
    }
  });
}
