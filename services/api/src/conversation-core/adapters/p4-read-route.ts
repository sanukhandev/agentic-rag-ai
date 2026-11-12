import { timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { P4EvidenceSigner } from './evidence-receipt.js';
import { InvalidReadScopeError, ScopedP3ReadTools } from './read-tool-scope.js';
import type { AuthorizedKnowledgeEvidence } from './rag-read-tool.js';

const requestSchema = z.object({
  toolCallId: z.string().min(1).max(128),
  toolName: z.enum(['search_knowledge', 'get_conversation_summary', 'get_verified_customer_facts', 'list_supported_goals']),
  arguments: z.record(z.string(), z.unknown()),
  scopeRef: z.string().min(40).max(4096),
}).strict();

function isKnowledgeEvidence(input: unknown): input is AuthorizedKnowledgeEvidence {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const e = input as Partial<AuthorizedKnowledgeEvidence>;
  return typeof e.citationId === 'string' && !!e.citationId
    && typeof e.sourceId === 'string' && !!e.sourceId
    && typeof e.versionId === 'string' && !!e.versionId
    && typeof e.untrustedContent === 'string' && !!e.untrustedContent
    && e.chunkId === e.citationId;
}

/**
 * Internal Node-to-Python callback only. No public /api route is registered.
 * Trust derives from independent service authentication AND the P3 HMAC scope;
 * request JSON contains no model-provided tenant or session identifier.
 */
export function registerP4ReadRoute(
  app: Express,
  tools: ScopedP3ReadTools,
  signer: P4EvidenceSigner,
  serviceKey: string,
): void {
  if (Buffer.byteLength(serviceKey, 'utf8') < 32) throw new Error('P4 internal service key must be at least 32 bytes');
  const expected = Buffer.from(serviceKey, 'utf8');
  const authenticate = (req: Request, res: Response, next: NextFunction): void => {
    const provided = Buffer.from(req.header('x-internal-service-key') ?? '', 'utf8');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      res.status(401).json({ error: { code: 'P4_UNAUTHORIZED' } }); return;
    }
    next();
  };
  app.post('/internal/p4/tools/execute', authenticate, async (req, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: { code: 'INVALID_READ_INPUT' } }); return; }
    const { scopeRef, toolName, arguments: args, toolCallId } = parsed.data;
    try {
      const controller = AbortSignal.timeout(30_000);
      const result = await tools.executeBound(scopeRef, toolName, args, controller);
      // get the tenant *only* from the verified scope; the signer API requires a
      // tenant identity, which must not be read from untrusted request arguments.
      const tenantId = tools.verifiedTenantForScope(scopeRef);
      const rows = toolName === 'search_knowledge' && result.status === 'ok'
        && result.data && typeof result.data === 'object' && 'evidence' in result.data
        && Array.isArray(result.data.evidence) ? result.data.evidence : [];
      const receiptRows = rows.filter(isKnowledgeEvidence).slice(0, 5)
        .map(row => signer.issue(scopeRef, tenantId, row));
      if (rows.length !== receiptRows.length) {
        res.status(503).json({ error: { code: 'INVALID_KNOWLEDGE_OUTPUT' } }); return;
      }
      res.status(200).json({ toolCallId, status: result.status, data: result.data, evidenceReceipts: receiptRows });
    } catch (error) {
      const status = error instanceof InvalidReadScopeError ? 403 : 503;
      res.status(status).json({ error: { code: status === 403 ? 'P4_SCOPE_REJECTED' : 'P4_TOOL_UNAVAILABLE' } });
    }
  });
}
