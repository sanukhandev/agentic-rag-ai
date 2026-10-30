import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { catalogNextFollowUpRequirement, catalogNextJourneyRequirement } from './intent-catalog.js';
import { retrieveApprovedKnowledge } from './knowledge.js';
import { sanitizeKnowledgeText } from './privacy.js';
import { normalizeConversationQuery } from './model.js';
import type { EmbeddingProvider } from './embedding.js';
import type { IntentCatalogVersion, Session, Store } from './types.js';
import { toolRequestSchema, type ToolRequestV2, type ToolResultV2 } from './python-model/v2-contracts.js';
import { HttpError } from './http/errors.js';
import { deriveV2ProviderEvidenceStatus, v2StageCompletionEligible } from './v2-provider-evidence.js';

export const V2_TOOL_NAMES = [
  'get_conversation_context',
  'get_persona',
  'get_intent_catalog',
  'get_missing_requirements',
  'search_knowledge',
  'get_journey_state',
  'get_available_packages',
  'get_document_requirements',
  'get_action_status',
] as const;

export type V2ToolName = (typeof V2_TOOL_NAMES)[number];

const emptyArguments = z.object({}).strict();
const searchArguments = z.object({
  query: z.string().trim().min(1).max(2_000),
  resultCount: z.number().int().min(1).max(5).nullable(),
}).strict();
const argumentSchemas: Record<V2ToolName, z.ZodTypeAny> = {
  get_conversation_context: emptyArguments,
  get_persona: emptyArguments,
  get_intent_catalog: emptyArguments,
  get_missing_requirements: emptyArguments,
  search_knowledge: searchArguments,
  get_journey_state: emptyArguments,
  get_available_packages: emptyArguments,
  get_document_requirements: emptyArguments,
  get_action_status: emptyArguments,
};

type ScopePayload = {
  tenantId: string;
  sessionId: string;
  opportunityId: string | null;
  catalogVersionId: string;
  personaVersionId: string;
  stateRevision: number;
  toolAllowlist: V2ToolName[];
  expiresAt: number;
  nonce: string;
};

export type V2ToolScopeInput = Omit<ScopePayload, 'expiresAt' | 'nonce' | 'toolAllowlist'> & {
  toolAllowlist?: V2ToolName[];
  expiresAt?: number;
};

const scopePart = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');
const unscopePart = (value: string): string => Buffer.from(value, 'base64url').toString('utf8');
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const bounded = (value: string, max: number): string => value.slice(0, max);

export const issueV2Scope = (input: V2ToolScopeInput, secret: string, now = Date.now()): string => {
  if (!secret || secret.length < 16) throw new Error('V2_TOOL_SCOPE_SECRET_REQUIRED');
  const payload: ScopePayload = {
    ...input,
    toolAllowlist: [...new Set(input.toolAllowlist ?? V2_TOOL_NAMES)],
    expiresAt: input.expiresAt ?? now + 5 * 60_000,
    nonce: randomBytes(16).toString('base64url'),
  };
  const encoded = scopePart(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
};

export const verifyV2Scope = (scopeRef: string, secret: string, now = Date.now()): ScopePayload | null => {
  if (!secret || scopeRef.length > 4_096) return null;
  const parts = scopeRef.split('.');
  if (parts.length !== 2) return null;
  const expected = createHmac('sha256', secret).update(parts[0]!).digest();
  const provided = Buffer.from(parts[1]!, 'base64url');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  try {
    const payload = JSON.parse(unscopePart(parts[0]!)) as ScopePayload;
    if (!payload || typeof payload !== 'object' || payload.expiresAt <= now || payload.stateRevision < 0 || !payload.tenantId || !payload.sessionId || !payload.catalogVersionId || !payload.personaVersionId || !Array.isArray(payload.toolAllowlist)) return null;
    if (payload.toolAllowlist.some((name) => !V2_TOOL_NAMES.includes(name))) return null;
    return payload;
  } catch {
    return null;
  }
};

const activeIntent = (session: Session): string | null => {
  const state = session.conversationState;
  return state?.activeFollowUpIntentKey ?? state?.intentProgress?.activeIntentKey ?? state?.selectedIntentKey ?? null;
};

const activeEntry = (session: Session) => {
  const intentKey = activeIntent(session);
  return intentKey ? session.conversationState?.intentProgress?.entries[intentKey] ?? null : null;
};

const result = (request: ToolRequestV2, status: ToolResultV2['status'], value: Record<string, unknown> | null, sourceVersion: string | null, evidenceRefs: string[] = [], stateRevision = request.expectedStateRevision): ToolResultV2 => ({
  schemaVersion: 2,
  toolCallId: request.toolCallId,
  status,
  result: value,
  evidenceRefs: evidenceRefs.slice(0, 32),
  sourceVersion,
  stateRevision,
});

const sanitizedToolError = (request: ToolRequestV2, status: ToolResultV2['status'], code: string, stateRevision = request.expectedStateRevision): ToolResultV2 => result(request, status, { code }, null, [], stateRevision);

const catalogForScope = async (store: Store, scope: ScopePayload): Promise<IntentCatalogVersion | null> => {
  const catalog = await store.getIntentCatalogVersion(scope.tenantId, scope.catalogVersionId);
  return catalog?.status === 'published' ? catalog : null;
};

const catalogProjection = (catalog: IntentCatalogVersion): Record<string, unknown> => ({
  intents: catalog.catalog.intents.filter((intent) => intent.active).map((intent) => ({ key: intent.intentKey, name: intent.displayName, description: intent.description })),
  slots: catalog.catalog.slots.filter((slot) => slot.required).map((slot) => ({ intentKey: slot.intentKey, key: slot.slotKey, promptKey: slot.promptKey, dataType: slot.dataType })),
  journeys: (catalog.catalog.journeyRequirements ?? []).map((requirement) => ({ intentKey: requirement.intentKey, key: requirement.requirementKey, type: requirement.requirementType, required: requirement.required })),
});

const toolResultFor = async (request: ToolRequestV2, scope: ScopePayload, session: Session, catalog: IntentCatalogVersion, store: Store, embedding: EmbeddingProvider): Promise<ToolResultV2> => {
  const state = session.conversationState;
  const intentKey = activeIntent(session);
  const entry = activeEntry(session);
  const values = entry?.slotValues ?? state?.slotValues ?? {};
  const completed = entry?.completedRequirementKeys ?? [];
  const sourceVersion = catalog.id;

  switch (request.toolName as V2ToolName) {
    case 'get_conversation_context':
      return result(request, 'ok', { summary: bounded(state?.rollingSummary ?? '', 4_000), phase: state?.phase ?? 'DISCOVERY', workflowStatus: state?.workflowStatus ?? 'none', activeIntentKey: intentKey, pendingRequirementKey: state?.pendingPrompt?.requirementKey ?? null }, sourceVersion);
    case 'get_persona': {
      const persona = await store.getPersonaVersion(scope.tenantId, scope.personaVersionId);
      if (!persona || persona.status !== 'published') return sanitizedToolError(request, 'temporarily_unavailable', 'PERSONA_UNAVAILABLE');
      return result(request, 'ok', { name: persona.name, tone: persona.tone, speakingStyle: persona.speakingStyle, permittedLanguages: persona.permittedLanguages }, persona.id);
    }
    case 'get_intent_catalog':
      return result(request, 'ok', catalogProjection(catalog), sourceVersion);
    case 'get_missing_requirements': {
      if (!intentKey) return result(request, 'ok', { intentKey: null, requirement: null }, sourceVersion);
      const requirement = catalogNextJourneyRequirement(catalog, intentKey, values, completed) ?? catalogNextFollowUpRequirement(catalog, intentKey, values, completed);
      return result(request, 'ok', { intentKey, requirement: requirement ? { key: requirement.requirementKey, type: requirement.requirementType, promptKey: requirement.promptKey, documentType: requirement.documentType ?? null } : null }, sourceVersion);
    }
    case 'search_knowledge': {
      const args = searchArguments.parse(request.arguments);
      const normalizedQuery = normalizeConversationQuery(args.query);
      const evidence = await retrieveApprovedKnowledge(store, embedding, scope.tenantId, 'public', normalizedQuery, args.resultCount ?? 4);
      const approved = (await Promise.all(evidence.map(async (item) => {
        const source = await store.getSource(item.citation.sourceId);
        return source && source.tenantId === scope.tenantId && source.status === 'active' && source.versionId === item.citation.versionId ? item : null;
      }))).filter((item): item is NonNullable<typeof item> => Boolean(item));
      const evidenceRefs = approved.map((item) => digest(`${item.citation.sourceId}:${item.citation.versionId}:${item.citation.chunkId}`).slice(0, 32));
      return result(request, 'ok', { grounded: approved.length > 0, evidence: approved.map((item, index) => ({ citationId: evidenceRefs[index], text: bounded(sanitizeKnowledgeText(item.content), 1_500), title: bounded(item.citation.title, 200), locator: bounded(item.citation.locator, 200), sourceVersion: item.citation.versionId, approval: 'active', revocation: 'not_revoked' })) }, sourceVersion, evidenceRefs);
    }
    case 'get_journey_state':
      return result(request, 'ok', { activeIntentKey: intentKey, currentStage: state?.phase ?? null, pendingRequirementKey: state?.pendingPrompt?.requirementKey ?? null, contactConsent: state?.contactConsent ?? 'unknown', workflowStatus: state?.workflowStatus ?? 'none', opportunityBound: Boolean(scope.opportunityId && entry?.journeyId === scope.opportunityId) }, sourceVersion);
    case 'get_available_packages': {
      const offerings = await store.listPackageOfferings(scope.tenantId, { catalogVersionId: catalog.id, ...(values.business_activity ? { activity: values.business_activity } : {}), ...(values.entity_type ? { entityType: values.entity_type } : {}) });
      return result(request, 'ok', { packages: offerings.map((offering) => ({ key: offering.packageKey, name: offering.name, visas: offering.includedVisaQuantity, officeRequirement: offering.officeRequirement, inclusions: offering.inclusions, availability: offering.availability, priceMinor: offering.priceMinor, currency: offering.currency, sourceRefs: offering.sourceRefs })) }, sourceVersion);
    }
    case 'get_document_requirements': {
      const offerings = await store.listPackageOfferings(scope.tenantId, { catalogVersionId: catalog.id });
      const documents = offerings.flatMap((offering) => offering.requiredDocuments.map((documentType) => ({ packageKey: offering.packageKey, documentType })));
      return result(request, 'ok', { documents }, sourceVersion);
    }
    case 'get_action_status': {
      const actions = await store.listActionsBySession(scope.sessionId, scope.tenantId);
      const scoped = actions.filter((action) => !scope.opportunityId || action.opportunityId === scope.opportunityId);
      const status = await Promise.all(scoped.map(async (action) => {
        const execution = await store.getActionExecution(action.id, scope.tenantId);
        const evidenceStatus = deriveV2ProviderEvidenceStatus({ actionState: action.state, providerStatus: execution?.providerStatus ?? null, evidenceTier: execution?.outcome?.evidenceTier });
        return { workflowKey: action.workflowKey, state: action.state, actionKey: action.actionKey ?? null, providerAcknowledged: Boolean(action.result?.externalReference), providerStatus: execution?.providerStatus ?? null, evidenceStatus, stageCompletionEligible: v2StageCompletionEligible(evidenceStatus) };
      }));
      return result(request, 'ok', { actions: status }, sourceVersion);
    }
  }
};

export interface V2ToolGatewayDependencies {
  store: Store;
  embedding: EmbeddingProvider;
  serviceKey: string;
}

export const createV2ToolGateway = ({ store, embedding, serviceKey }: V2ToolGatewayDependencies) => {
  const replayCache = new Map<string, { argsDigest: string; value: ToolResultV2 }>();
  const remember = (key: string, argsDigest: string, value: ToolResultV2): void => {
    replayCache.set(key, { argsDigest, value });
    while (replayCache.size > 1_024) replayCache.delete(replayCache.keys().next().value!);
  };
  const execute = async (input: unknown): Promise<ToolResultV2> => {
    const parsed = toolRequestSchema.safeParse(input);
    if (!parsed.success) return sanitizedToolError({ schemaVersion: 2, toolCallId: 'invalid-call', toolName: 'invalid', arguments: {}, scopeRef: 'invalid-scope', expectedStateRevision: 0, deadlineAt: new Date().toISOString() } as ToolRequestV2, 'invalid_args', 'INVALID_TOOL_REQUEST');
    const request = parsed.data;
    const scope = verifyV2Scope(request.scopeRef, serviceKey);
    if (!scope) return sanitizedToolError(request, 'not_authorized', 'SCOPE_INVALID');
    const cacheKey = `${request.scopeRef}:${request.toolCallId}`;
    const argsDigest = digest(JSON.stringify(request.arguments));
    const cached = replayCache.get(cacheKey);
    if (cached) return cached.argsDigest === argsDigest ? cached.value : sanitizedToolError(request, 'not_authorized', 'TOOL_CALL_REUSE_MISMATCH', scope.stateRevision);
    if (!scope.toolAllowlist.includes(request.toolName as V2ToolName) || !V2_TOOL_NAMES.includes(request.toolName as V2ToolName)) return sanitizedToolError(request, 'not_authorized', 'TOOL_NOT_ALLOWED', scope.stateRevision);
    const session = await store.getSession(scope.sessionId);
    if (!session || session.tenantId !== scope.tenantId) return sanitizedToolError(request, 'not_authorized', 'SESSION_SCOPE_DENIED', scope.stateRevision);
    if ((session.stateVersion ?? 0) !== scope.stateRevision || request.expectedStateRevision !== scope.stateRevision) return sanitizedToolError(request, 'stale_state', 'STATE_REVISION_STALE', session.stateVersion ?? 0);
    if (session.personaVersionId !== scope.personaVersionId || session.conversationState?.catalogVersionId !== scope.catalogVersionId) return sanitizedToolError(request, 'stale_state', 'PINNED_CONTEXT_STALE', session.stateVersion ?? 0);
    const entry = activeEntry(session);
    if (scope.opportunityId && entry?.journeyId !== scope.opportunityId) return sanitizedToolError(request, 'not_authorized', 'OPPORTUNITY_SCOPE_DENIED', scope.stateRevision);
    const catalog = await catalogForScope(store, scope);
    if (!catalog) return sanitizedToolError(request, 'temporarily_unavailable', 'CATALOG_UNAVAILABLE', scope.stateRevision);
    try {
      const parsedArguments = argumentSchemas[request.toolName as V2ToolName]?.safeParse(request.arguments);
      if (!parsedArguments?.success) return sanitizedToolError(request, 'invalid_args', 'TOOL_ARGUMENTS_INVALID', scope.stateRevision);
      const value = await toolResultFor(request, scope, session, catalog, store, embedding);
      remember(cacheKey, argsDigest, value);
      await store.addAudit({ id: randomBytes(16).toString('hex'), tenantId: scope.tenantId, actorId: null, eventName: 'v2.tool.read', metadata: { toolName: request.toolName, toolCallDigest: digest(request.toolCallId).slice(0, 16), scopeDigest: digest(request.scopeRef).slice(0, 16), status: value.status, stateRevision: scope.stateRevision }, createdAt: new Date().toISOString() });
      return value;
    } catch {
      const value = sanitizedToolError(request, 'temporarily_unavailable', 'TOOL_UNAVAILABLE', scope.stateRevision);
      remember(cacheKey, argsDigest, value);
      return value;
    }
  };
  return { execute };
};

export const registerV2ToolGateway = (app: Express, dependencies: V2ToolGatewayDependencies): void => {
  const gateway = createV2ToolGateway(dependencies);
  const authenticate = (req: Request, _res: Response, next: NextFunction): void => {
    const expected = Buffer.from(dependencies.serviceKey);
    const provided = Buffer.from(req.header('x-internal-service-key') ?? '');
    if (!dependencies.serviceKey || expected.length !== provided.length || !timingSafeEqual(expected, provided)) { next(new HttpError(401, 'V2_TOOL_GATEWAY_UNAUTHORIZED', 'Internal tool gateway authentication failed.')); return; }
    next();
  };
  app.post('/internal/v2/tools/execute', authenticate, async (req, res, next) => {
    try { res.status(200).json(await gateway.execute(req.body)); } catch (error) { next(error); }
  });
};
