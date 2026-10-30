import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { catalogNextJourneyRequirement, catalogRequirementLabel } from './intent-catalog.js';
import { hasConflictingEvidence, KnowledgeRetrievalError, retrieveApprovedKnowledge } from './knowledge.js';
import { sanitizeKnowledgeText } from './privacy.js';
import type { EmbeddingProvider } from './embedding.js';
import type { Store } from './types.js';

const searchKnowledgeArguments = z.object({ query: z.string().trim().min(1).max(1_000), maxResults: z.coerce.number().int().min(1).max(8).default(4) }).strict();
const emptyArguments = z.object({}).strict();

export const foundryFunctionDefinitions = [
  {
    type: 'function' as const,
    name: 'search_knowledge',
    description: 'Search approved knowledge for the authorized tenant. Use only for factual business answers; abstain when evidence is missing or conflicting.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1, maxLength: 1_000 }, maxResults: { type: 'integer', minimum: 1, maximum: 8, default: 4 } },
      required: ['query', 'maxResults'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    name: 'get_journey_state',
    description: 'Read sanitized journey status for the already authorized customer session. This function takes no arguments.',
    strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function' as const,
    name: 'get_available_packages',
    description: 'Read approved package offerings eligible for the already authorized customer journey. Eligibility is derived by the server.',
    strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function' as const,
    name: 'get_document_requirements',
    description: 'Read the approved document requirements and safe processing status for the already authorized journey. Never returns document contents.',
    strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function' as const,
    name: 'get_action_status',
    description: 'Read the status of the current server-owned business action, including verified provider and reconciliation status. This function takes no identifiers.',
    strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
] as const;

export type FoundryFunctionName = (typeof foundryFunctionDefinitions)[number]['name'];

export interface FoundryExecutionContext {
  tenantId: string;
  sessionId?: string;
  allowInternalSources?: boolean;
  assistantInstructions?: string;
}

export interface FoundryToolDispatchResult {
  name: string;
  ok: boolean;
  data?: Record<string, unknown>;
  errorCode?: 'TOOL_NOT_AVAILABLE' | 'TOOL_INPUT_INVALID' | 'TOOL_SCOPE_DENIED' | 'TOOL_FAILED';
  error?: string;
}

export type FoundryJourneyStateResponse = {
  status: 'available' | 'not_linked';
  currentStage: string | null;
  completedStages: string[];
  nextRequirement: string | null;
  revision?: number;
};
export type FoundrySearchResponse = {
  status: 'grounded' | 'no_evidence';
  answer: string;
  citations: Array<{ sourceId: string; title: string; chunkId: string; locator: string; excerpt: string }>;
};

const redactedText = (value: string, maxLength: number): string => sanitizeKnowledgeText(value).replace(/\[(?:NAME|EMAIL|PHONE|ID)_\d+\]/gu, '[REDACTED_IDENTIFIER]').slice(0, maxLength);
const notLinked = (): FoundryJourneyStateResponse => ({ status: 'not_linked', currentStage: null, completedStages: [], nextRequirement: null });
const catalogStageKeys = (catalog: Awaited<ReturnType<Store['getPublishedIntentCatalog']>>): string[] => [...new Set([...(catalog?.catalog.businessStages ?? [])].filter((stage) => stage.status === 'ACTIVE').sort((left, right) => left.order - right.order).map((stage) => stage.stageKey))];

const boundedKnowledgeResponse = (evidence: Awaited<ReturnType<typeof retrieveApprovedKnowledge>>, maxResults: number, maxBytes: number) => {
  const citations = evidence.slice(0, maxResults).map((item) => ({ sourceId: item.citation.sourceId, title: redactedText(item.citation.title, 200), chunkId: item.citation.chunkId, locator: redactedText(item.citation.locator, 200), excerpt: redactedText(item.content, 1_600) }));
  const response = (status: 'grounded' | 'no_evidence', answer: string) => ({ status, answer: redactedText(answer, 6_000), citations });
  let result = response('grounded', citations.map((citation) => citation.excerpt).filter(Boolean).join('\n\n'));
  while (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes && result.citations.length > 1) result = { ...result, citations: result.citations.slice(0, -1) };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) result = { ...result, answer: result.answer.slice(0, Math.max(100, maxBytes - 1_000)), citations: result.citations.slice(0, 1).map((citation) => ({ ...citation, excerpt: citation.excerpt.slice(0, 600) })) };
  return result;
};

const searchKnowledge = async (store: Store, embedding: EmbeddingProvider, context: FoundryExecutionContext, input: unknown, maxResponseBytes: number) => {
  const parsed = searchKnowledgeArguments.parse(input);
  const evidence = await retrieveApprovedKnowledge(store, embedding, context.tenantId, context.allowInternalSources ? 'internal' : 'public', parsed.query, parsed.maxResults);
  if (evidence.length === 0) return { status: 'no_evidence' as const, answer: 'No approved source evidence was found for this query.', citations: [] };
  if (hasConflictingEvidence(evidence.map((item) => item.content))) return { ...boundedKnowledgeResponse(evidence, parsed.maxResults, maxResponseBytes), status: 'no_evidence' as const, answer: 'Approved sources contain conflicting information, so no single answer is safe.' };
  return boundedKnowledgeResponse(evidence, parsed.maxResults, maxResponseBytes);
};

const journeyState = async (store: Store, context: FoundryExecutionContext): Promise<FoundryJourneyStateResponse> => {
  if (!context.sessionId) return notLinked();
  const session = await store.getSession(context.sessionId);
  if (!session || session.tenantId !== context.tenantId) return notLinked();
  const state = session.conversationState;
  const activeIntentKey = state?.intentProgress?.activeIntentKey ?? state?.activeFollowUpIntentKey ?? state?.selectedIntentKey ?? null;
  const entry = activeIntentKey && state?.intentProgress?.entries[activeIntentKey] ? state.intentProgress.entries[activeIntentKey] : null;
  const lifecycle = entry?.lifecycle;
  const catalog = state?.catalogVersionId ? await store.getIntentCatalogVersion(context.tenantId, state.catalogVersionId) : await store.getPublishedIntentCatalog(context.tenantId);
  const requirement = catalog && activeIntentKey
    ? catalog.catalog.journeyRequirements?.find((candidate) => candidate.requirementKey === entry?.currentRequirementKey && candidate.intentKey === activeIntentKey)
      ?? catalogNextJourneyRequirement(catalog, activeIntentKey, { ...(state?.slotValues ?? {}), ...(entry?.slotValues ?? {}) }, entry?.completedRequirementKeys ?? [])
    : null;
  const authorizedStageKeys = catalogStageKeys(catalog);
  const completedLifecycleStages = new Set(lifecycle ? Object.entries(lifecycle.stages).filter(([, stage]) => stage.status === 'completed').map(([stage]) => stage) : []);
  return {
    status: 'available',
    currentStage: lifecycle && authorizedStageKeys.includes(lifecycle.currentStage) ? lifecycle.currentStage : null,
    completedStages: authorizedStageKeys.filter((stage) => completedLifecycleStages.has(stage)),
    nextRequirement: requirement ? redactedText(catalogRequirementLabel(requirement), 240) : null,
    revision: lifecycle?.revision ?? state?.intentProgress?.journeyRevision ?? 0,
  };
};

const authorizedJourney = async (store: Store, context: FoundryExecutionContext) => {
  if (!context.sessionId) return null;
  const session = await store.getSession(context.sessionId);
  if (!session || session.tenantId !== context.tenantId) return null;
  const state = session.conversationState;
  const intentKey = state?.intentProgress?.activeIntentKey ?? state?.activeFollowUpIntentKey ?? state?.selectedIntentKey ?? null;
  const entry = intentKey && state?.intentProgress?.entries[intentKey] ? state.intentProgress.entries[intentKey] : null;
  return { session, state, intentKey, entry, opportunityId: entry?.journeyId ?? null };
};

const packageOfferings = async (store: Store, context: FoundryExecutionContext): Promise<Record<string, unknown>> => {
  const journey = await authorizedJourney(store, context);
  if (!journey) return { status: 'not_linked', packages: [] };
  const values = journey.entry?.slotValues ?? journey.state?.slotValues ?? {};
  const offerings = await store.listPackageOfferings(context.tenantId, {
    catalogVersionId: journey.state?.catalogVersionId ?? null,
    ...(values.business_activity ? { activity: values.business_activity } : {}),
    ...(values.entity_type ? { entityType: values.entity_type } : {}),
  });
  return {
    status: offerings.length > 0 ? 'available' : 'unavailable',
    packages: offerings.slice(0, 12).map((offering) => ({
      packageKey: offering.packageKey,
      name: redactedText(offering.name, 240),
      includedVisaQuantity: offering.includedVisaQuantity,
      officeRequirement: redactedText(offering.officeRequirement ?? '', 240) || null,
      inclusions: offering.inclusions.map((item) => redactedText(item, 240)).slice(0, 20),
      priceMinor: offering.priceMinor,
      currency: offering.currency,
      pricingEffectiveFrom: offering.pricingEffectiveFrom,
      pricingEffectiveTo: offering.pricingEffectiveTo,
      processingTime: redactedText(offering.processingTime ?? '', 240) || null,
      requiredDocuments: offering.requiredDocuments.map((item) => redactedText(item, 160)).slice(0, 20),
      sourceRefs: offering.sourceRefs.slice(0, 12),
    })),
  };
};

const documentRequirements = async (store: Store, context: FoundryExecutionContext): Promise<Record<string, unknown>> => {
  const journey = await authorizedJourney(store, context);
  if (!journey) return { status: 'not_linked', requirements: [], received: [] };
  const documents = (await store.listSupportingDocuments(context.tenantId, journey.session.id)).filter((document) => !journey.opportunityId || document.opportunityId === journey.opportunityId);
  const selected = journey.opportunityId ? (await store.listPackageSelections(context.tenantId, journey.opportunityId)).find((item) => item.status === 'confirmed' || item.status === 'proposed') : null;
  const offering = selected ? await store.getPackageOffering(selected.packageOfferingId, context.tenantId) : null;
  const catalog = journey.state?.catalogVersionId ? await store.getIntentCatalogVersion(context.tenantId, journey.state.catalogVersionId) : await store.getPublishedIntentCatalog(context.tenantId);
  const catalogRequirements = catalog && journey.intentKey
    ? (catalog.catalog.journeyRequirements ?? []).filter((item) => item.intentKey === journey.intentKey && item.requirementType === 'document').map((item) => ({ requirementKey: item.requirementKey, documentType: item.documentType, promptKey: item.promptKey }))
    : [];
  const packageRequirements = (offering?.requiredDocuments ?? []).map((documentType) => ({ requirementKey: null, documentType: redactedText(documentType, 160), promptKey: null }));
  return {
    status: 'available',
    requirements: [...catalogRequirements, ...packageRequirements].slice(0, 32),
    received: documents.slice(0, 32).map((document) => ({ requirementKey: document.requirementKey ?? null, documentType: document.expectedDocumentType ?? null, status: document.status, ocrAvailable: Boolean(document.summary || document.extractedText), workflowKey: document.workflowKey })),
  };
};

const actionStatus = async (store: Store, context: FoundryExecutionContext): Promise<Record<string, unknown>> => {
  const journey = await authorizedJourney(store, context);
  if (!journey) return { status: 'not_linked', action: null };
  const actions = (await store.listActionsBySession(journey.session.id, context.tenantId)).filter((action) => !journey.opportunityId || action.opportunityId === journey.opportunityId);
  const action = actions[0];
  if (!action) return { status: 'not_started', action: null };
  const execution = await store.getActionExecution(action.id, context.tenantId);
  const providerAcknowledged = Boolean(action.result?.externalReference && execution?.providerStatus === 'completed');
  return {
    status: action.state,
    providerAcknowledged,
    reconciliation: execution?.outcome ?? null,
    providerStatus: execution?.providerStatus ?? null,
    workflowStatus: action.state,
    nextStep: providerAcknowledged ? 'Use the verified provider result and current journey state.' : 'Wait for a verified callback or reconciliation result.',
  };
};

export class FoundryFunctionDispatcher {
  constructor(private readonly dependencies: { store: Store; embedding: EmbeddingProvider; maxResponseBytes?: number }) {}

  async dispatch(context: FoundryExecutionContext, name: string, argumentsValue: unknown): Promise<FoundrySearchResponse | FoundryJourneyStateResponse | Record<string, unknown>> {
    if (name === 'search_knowledge') return searchKnowledge(this.dependencies.store, this.dependencies.embedding, context, argumentsValue, this.dependencies.maxResponseBytes ?? 16_384);
    if (name === 'get_journey_state') { emptyArguments.parse(argumentsValue); return journeyState(this.dependencies.store, context); }
    if (name === 'get_available_packages') { emptyArguments.parse(argumentsValue); return packageOfferings(this.dependencies.store, context); }
    if (name === 'get_document_requirements') { emptyArguments.parse(argumentsValue); return documentRequirements(this.dependencies.store, context); }
    if (name === 'get_action_status') { emptyArguments.parse(argumentsValue); return actionStatus(this.dependencies.store, context); }
    throw new Error('Unsupported Foundry function.');
  }

  async dispatchTool(context: FoundryExecutionContext, name: string, argumentsValue: unknown): Promise<FoundryToolDispatchResult> {
    if (!foundryFunctionDefinitions.some((definition) => definition.name === name)) return { name: name as FoundryFunctionName, ok: false, errorCode: 'TOOL_NOT_AVAILABLE', error: 'The requested function is not approved.' };
    try {
      const data = await this.dispatch(context, name, argumentsValue);
      return { name: name as FoundryFunctionName, ok: true, data: typeof data === 'object' && data !== null ? data as Record<string, unknown> : { value: data } };
    } catch (error) {
      if (error instanceof z.ZodError) return { name: name as FoundryFunctionName, ok: false, errorCode: 'TOOL_INPUT_INVALID', error: 'The function arguments did not match the approved schema.' };
      if (error instanceof KnowledgeRetrievalError) return { name: name as FoundryFunctionName, ok: false, errorCode: 'TOOL_FAILED', error: 'Approved knowledge retrieval was unavailable.' };
      return { name: name as FoundryFunctionName, ok: false, errorCode: 'TOOL_FAILED', error: 'The approved function failed.' };
    }
  }
}

export interface FoundryToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface FoundryToolOutput {
  callId: string;
  output: FoundryToolDispatchResult;
}

export class FoundryToolExecution {
  constructor(private readonly dispatcher: FoundryFunctionDispatcher, private readonly dependencies: { store: Store; timeoutMs?: number; maxCallsPerTurn?: number }) {}

  async execute(context: FoundryExecutionContext, calls: FoundryToolCall[]): Promise<FoundryToolOutput[]> {
    if (calls.length > (this.dependencies.maxCallsPerTurn ?? 5)) throw new Error('Foundry tool-call limit exceeded.');
    return Promise.all(calls.map(async (call) => {
      const started = Date.now();
      const argumentBytes = Buffer.byteLength(call.arguments, 'utf8');
      const callDigest = createHash('sha256').update(call.callId).digest('hex').slice(0, 16);
      const name = call.name as FoundryFunctionName;
      let result: FoundryToolDispatchResult;
      if (argumentBytes > 8_192) result = { name, ok: false, errorCode: 'TOOL_INPUT_INVALID', error: 'Function arguments exceed the approved limit.' };
      else {
        let parsed: unknown;
        try { parsed = JSON.parse(call.arguments); } catch { parsed = undefined; }
        const operation = this.dispatcher.dispatchTool(context, call.name, parsed);
        result = await Promise.race([
          operation,
          new Promise<FoundryToolDispatchResult>((resolve) => setTimeout(() => resolve({ name, ok: false, errorCode: 'TOOL_FAILED', error: 'The approved function timed out.' }), this.dependencies.timeoutMs ?? 5_000)),
        ]);
      }
      await this.dependencies.store.addAudit({ id: randomUUID(), tenantId: context.tenantId, actorId: null, eventName: result.ok ? 'foundry.function_call.completed' : 'foundry.function_call.denied', metadata: { functionName: call.name, callDigest, status: result.ok ? 'ok' : result.errorCode ?? 'failed', durationMs: Date.now() - started }, createdAt: new Date().toISOString() });
      return { callId: call.callId, output: result };
    }));
  }
}

export { KnowledgeRetrievalError };
