import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { catalogNextFollowUpRequirement, catalogNextJourneyRequirement } from '../intent-catalog.js';
import { retrieveApprovedKnowledge } from '../knowledge.js';
import { toV2KnowledgeEvidence } from './knowledge-preflight.js';
import { normalizeConversationQuery } from '../model.js';
import type { EmbeddingProvider } from '../embedding.js';
import type { IntentCatalogVersion, IntentCatalogV2Version, PackageOffering, Session, Store } from '../types.js';
import { validatePublishedCatalogV2 } from './catalog-runtime.js';
import { isV2ReadToolEnabled } from './tool-policy.js';
import { toolRequestSchema, type ToolRequestV2, type ToolResultV2 } from './../python-model/contracts.js';
import { HttpError } from '../http/errors.js';
import { deriveV2ProviderEvidenceStatus, v2StageCompletionEligible } from './provider-evidence.js';
import type { V2ApprovedEvidence } from './evidence.js';

export const V2_TOOL_NAMES = [
  'get_conversation_context',
  'get_conversation_history_summary',
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
  get_conversation_history_summary: emptyArguments,
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

const scopePayloadSchema = z.object({
  tenantId: z.string().min(1).max(256),
  sessionId: z.string().min(1).max(256),
  opportunityId: z.string().min(1).max(256).nullable(),
  catalogVersionId: z.string().min(1).max(256),
  personaVersionId: z.string().min(1).max(256),
  stateRevision: z.number().int().nonnegative().safe(),
  toolAllowlist: z.array(z.enum(V2_TOOL_NAMES)).max(V2_TOOL_NAMES.length),
  expiresAt: z.number().int().positive().safe(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
}).strict();
const SCOPE_MAX_LIFETIME_MS = 5 * 60_000;
const TOOL_MAX_DEADLINE_MS = 90_000;
const MAX_SCOPE_REF_LENGTH = 2_048;
const scopePart = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');
const unscopePart = (value: string): string => Buffer.from(value, 'base64url').toString('utf8');
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const bounded = (value: string, max: number): string => value.slice(0, max);
export const packageEvidenceText = (offering: Pick<PackageOffering, 'name' | 'includedVisaQuantity' | 'officeRequirement' | 'inclusions' | 'availability' | 'priceMinor' | 'currency'>, prefix: string, priceLabel: string): string => [
  `${prefix} ${bounded(offering.name, 160)} includes ${offering.includedVisaQuantity} visa${offering.includedVisaQuantity === 1 ? '' : 's'}.`,
  ...(offering.officeRequirement ? [`It requires ${bounded(offering.officeRequirement, 120)}.`] : []),
  ...(offering.inclusions.length > 0 ? [`It includes ${offering.inclusions.slice(0, 6).map(value => bounded(value, 180)).join(', ')}.`] : []),
  `It has availability ${offering.availability}.`,
  ...(offering.priceMinor !== null && offering.currency ? [`Its ${priceLabel} price is ${offering.currency} ${(offering.priceMinor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}.`] : []),
].join('\n');

const listApprovedPackageOfferings = async (store: Pick<Store, 'listPackageOfferings'>, tenantId: string, catalogVersionRef: string): Promise<PackageOffering[]> => {
  const offerings = await store.listPackageOfferings(tenantId, { catalogVersionRef });
  const now = Date.now();
  return offerings
    .filter(offering => offering.tenantId === tenantId && offering.catalogVersionRef === catalogVersionRef && offering.approvalStatus === 'approved'
      && (!offering.pricingEffectiveFrom || Date.parse(offering.pricingEffectiveFrom) <= now)
      && (!offering.pricingEffectiveTo || Date.parse(offering.pricingEffectiveTo) > now))
    .slice(0, 20);
};

export type V2PackageOption = Pick<PackageOffering, 'packageKey' | 'name' | 'includedVisaQuantity' | 'officeRequirement' | 'inclusions' | 'availability' | 'priceMinor' | 'currency' | 'processingTime'>;

export const listApprovedV2PackageOptions = async (store: Pick<Store, 'listPackageOfferings'>, tenantId: string, catalogVersionRef: string): Promise<V2PackageOption[]> =>
  (await listApprovedPackageOfferings(store, tenantId, catalogVersionRef)).map(({ packageKey, name, includedVisaQuantity, officeRequirement, inclusions, availability, priceMinor, currency, processingTime }) => ({
    packageKey, name, includedVisaQuantity, officeRequirement, inclusions: inclusions.slice(0, 6), availability, priceMinor, currency, processingTime,
  }));

export const listApprovedV2PackageEvidence = async (store: Pick<Store, 'listPackageOfferings'>, tenantId: string, catalogVersionRef: string): Promise<V2ApprovedEvidence[]> => {
  const offerings = await listApprovedPackageOfferings(store, tenantId, catalogVersionRef);
  return offerings
    .map(offering => {
      const text = packageEvidenceText(offering, 'The published approved package', 'listed');
      return { citationId: `tool-${digest(`${catalogVersionRef}:${offering.id}:${text}`).slice(0, 32)}`, sourceVersion: catalogVersionRef, sourceRef: 'tool-get_available_packages', text, approved: true, revoked: false };
    });
};

export const issueV2Scope = (input: V2ToolScopeInput, secret: string, now = Date.now()): string => {
  if (!secret || secret.length < 16) throw new Error('V2_TOOL_SCOPE_SECRET_REQUIRED');
  const payload = scopePayloadSchema.parse({
    ...input,
    toolAllowlist: [...new Set(input.toolAllowlist ?? V2_TOOL_NAMES)],
    expiresAt: input.expiresAt ?? now + SCOPE_MAX_LIFETIME_MS,
    nonce: randomBytes(16).toString('base64url'),
  });
  if (payload.expiresAt <= now || payload.expiresAt > now + SCOPE_MAX_LIFETIME_MS) throw new Error('V2_TOOL_SCOPE_EXPIRY_INVALID');
  const encoded = scopePart(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  const scopeRef = `${encoded}.${signature}`;
  if (scopeRef.length > MAX_SCOPE_REF_LENGTH) throw new Error('V2_TOOL_SCOPE_TOO_LARGE');
  return scopeRef;
};

export const verifyV2Scope = (scopeRef: string, secret: string, now = Date.now()): ScopePayload | null => {
  if (!secret || secret.length < 16 || scopeRef.length > MAX_SCOPE_REF_LENGTH) return null;
  const parts = scopeRef.split('.');
  if (parts.length !== 2) return null;
  const expected = createHmac('sha256', secret).update(parts[0]!).digest();
  const provided = Buffer.from(parts[1]!, 'base64url');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  try {
    const parsed = scopePayloadSchema.safeParse(JSON.parse(unscopePart(parts[0]!)));
    if (!parsed.success) return null;
    const payload: ScopePayload = parsed.data;
    if (payload.expiresAt <= now || payload.expiresAt > now + SCOPE_MAX_LIFETIME_MS) return null;
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

const toolEvidence = (toolName: V2ToolName, sourceVersion: string, claims: string[]) => {
  const evidence = claims.filter((claim) => claim.trim()).slice(0, 16).map((text, index) => ({
    citationId: `tool-${digest(`${toolName}:${sourceVersion}:${index}:${text}`).slice(0, 32)}`,
    text: bounded(text, 1_500),
    sourceVersion,
    approved: true as const,
    revoked: false as const,
    sourceRef: `tool-${toolName}`,
  }));
  return { evidence, evidenceRefs: evidence.map((item) => item.citationId) };
};

const resultWithToolEvidence = (request: ToolRequestV2, value: Record<string, unknown>, toolName: V2ToolName, sourceVersion: string, claims: string[], stateRevision = request.expectedStateRevision): ToolResultV2 => {
  const generated = toolEvidence(toolName, sourceVersion, claims);
  return result(request, 'ok', { ...value, evidence: generated.evidence }, sourceVersion, generated.evidenceRefs, stateRevision);
};

const actionLabel = (workflowKey: string, actionKey: string | null): string => {
  if (/account/iu.test(workflowKey) || /account/iu.test(actionKey ?? '')) return 'Account creation';
  if (/lead/iu.test(workflowKey) || /lead/iu.test(actionKey ?? '')) return 'Lead registration';
  if (/document/iu.test(workflowKey) || /document/iu.test(actionKey ?? '')) return 'Document processing';
  return 'The authorized business action';
};

const sanitizedToolError = (request: ToolRequestV2, status: ToolResultV2['status'], code: string, stateRevision = request.expectedStateRevision): ToolResultV2 => result(request, status, { code }, null, [], stateRevision);

type TrustedCatalog = { kind: 'legacy'; version: IntentCatalogVersion } | { kind: 'v2'; version: IntentCatalogV2Version };
const catalogForScope = async (store: Store, scope: ScopePayload): Promise<TrustedCatalog | null> => {
  const legacy = await store.getIntentCatalogVersion(scope.tenantId, scope.catalogVersionId);
  if (legacy) return legacy.status === 'published' ? { kind: 'legacy', version: legacy } : null;
  const v2 = await store.getIntentCatalogV2Version(scope.tenantId, scope.catalogVersionId);
  if (!v2 || v2.status !== 'published') return null;
  const tenant = await store.getTenant(scope.tenantId);
  if (!tenant || !validatePublishedCatalogV2(v2.catalog, {
    published: true, tenantScope: tenant.slug, pinnedVersionRef: v2.catalogVersionRef,
  }).ok) return null;
  return { kind: 'v2', version: v2 };
};

const catalogProjection = (catalog: IntentCatalogVersion): Record<string, unknown> => ({
  intents: catalog.catalog.intents.filter((intent) => intent.active).map((intent) => ({ key: intent.intentKey, name: intent.displayName, description: intent.description })),
  slots: catalog.catalog.slots.filter((slot) => slot.required).map((slot) => ({ intentKey: slot.intentKey, key: slot.slotKey, promptKey: slot.promptKey, dataType: slot.dataType })),
  journeys: (catalog.catalog.journeyRequirements ?? []).map((requirement) => ({ intentKey: requirement.intentKey, key: requirement.requirementKey, type: requirement.requirementType, required: requirement.required })),
});

const toolResultFor = async (request: ToolRequestV2, scope: ScopePayload, session: Session, catalog: TrustedCatalog, store: Store, embedding: EmbeddingProvider): Promise<ToolResultV2> => {
  const legacyCatalog = catalog.kind === 'legacy' ? catalog.version : null;
  const v2Catalog = catalog.kind === 'v2' ? catalog.version : null;
  const state = session.conversationState;
  const intentKey = activeIntent(session);
  const entry = activeEntry(session);
  const values = entry?.slotValues ?? state?.slotValues ?? {};
  const completed = entry?.completedRequirementKeys ?? [];
  const sourceVersion = v2Catalog?.catalogVersionRef ?? legacyCatalog!.id;
  // Session-bound evidence revisions must change when the authoritative state changes.
  const stateSourceVersion = `${sourceVersion}:state:${scope.sessionId}:${scope.stateRevision}`;

  switch (request.toolName as V2ToolName) {
    case 'get_conversation_context': {
      const phase = state?.phase ?? 'DISCOVERY';
      const workflowStatus = state?.workflowStatus ?? 'none';
      const pendingRequirementKey = state?.pendingPrompt?.requirementKey ?? null;
      const document = await store.getUserIntentDocument(scope.tenantId, scope.sessionId);
      const allowedFacts = new Set(['business_activity', 'entity_type', 'visa_count', 'timeline']);
      const verifiedFacts = document && document.catalogVersionRef === sourceVersion && document.personaVersionId === scope.personaVersionId
        ? Object.fromEntries(Object.entries(document.verifiedFacts).filter(([key, fact]) =>
            allowedFacts.has(key) && (fact.source === 'visitor' || fact.source === 'node') && fact.maskedValue.length <= 180
            && !/[\r\n<>@]/u.test(fact.maskedValue) && !/https?:\/\//iu.test(fact.maskedValue))
          .map(([key, fact]) => [key, fact.maskedValue]))
        : {};
      const recentTurns = (await store.listMessages(scope.sessionId, scope.tenantId, 6))
        .map((message) => ({ role: message.role, content: bounded(message.maskedContent, 600) }));
      return resultWithToolEvidence(request, { summary: bounded(state?.rollingSummary ?? '', 4_000), phase, workflowStatus, activeIntentKey: intentKey, pendingRequirementKey, verifiedFacts, recentTurns }, request.toolName as V2ToolName, stateSourceVersion, [
        `The current conversation phase is ${phase} and the workflow status is ${workflowStatus}.`,
        intentKey ? `The active business goal is ${intentKey}.` : 'No business goal is currently active.',
        pendingRequirementKey ? `The next server-authorized requirement is ${pendingRequirementKey}.` : 'No server-authorized requirement is currently pending.',
      ]);
    }
    case 'get_conversation_history_summary': {
      const recentTurns = (await store.listMessages(scope.sessionId, scope.tenantId, 20))
        .map((message) => ({ role: message.role, content: bounded(message.maskedContent, 600) }));
      const summary = bounded(state?.rollingSummary ?? '', 6_000);
      return resultWithToolEvidence(request, {
        summary: summary || 'No stored conversation summary is available.',
        recentTurns,
        turnCount: recentTurns.length,
      }, request.toolName as V2ToolName, stateSourceVersion, [
        summary ? 'The server returned the current bounded conversation summary.' : 'The server has no stored conversation summary yet.',
        `The server returned ${recentTurns.length} recent conversation turns for context.`
      ]);
    }
    case 'get_persona': {
      const persona = await store.getPersonaVersion(scope.tenantId, scope.personaVersionId);
      if (!persona || persona.status !== 'published') return sanitizedToolError(request, 'temporarily_unavailable', 'PERSONA_UNAVAILABLE');
      return result(request, 'ok', { name: persona.name, tone: persona.tone, speakingStyle: persona.speakingStyle, permittedLanguages: persona.permittedLanguages }, persona.id);
    }
    case 'get_intent_catalog': {
      // Expose the current published V2 contract alongside the rollback V1
      // projection. A legacy intent catalog is never represented as Catalog V2.
      const document = await store.getUserIntentDocument(scope.tenantId, scope.sessionId);
      const publishedV2 = v2Catalog ?? (legacyCatalog
        ? (await store.listIntentCatalogV2Versions(scope.tenantId))
          .find(version => version.status === 'published') ?? null
        : null);
      if (document?.catalogSource === 'v2' && (!publishedV2 || document.catalogVersionRef !== publishedV2.catalogVersionRef)) {
        return sanitizedToolError(request, 'stale_state', 'V2_CATALOG_PIN_STALE', scope.stateRevision);
      }
      const v2Projection = publishedV2 && (!document || document.catalogSource === 'v2')
        ? {
            versionRef: publishedV2.catalogVersionRef,
            businessGoals: publishedV2.catalog.sheets.BusinessGoals.filter(goal => goal.active)
              .slice(0, 40).map(goal => ({ key: goal.businessGoalKey, name: bounded(goal.name, 120), description: bounded(goal.description, 4_000),
                keywords: goal.keywords.slice(0, 64), customerExpressions: goal.customerExpressions.slice(0, 24),
                requiredInformation: goal.requiredInformation.slice(0, 24), requiredDocuments: goal.requiredDocuments.slice(0, 24),
                orderedSteps: goal.orderedSteps.slice(0, 16), packageReferences: goal.packageReferences.slice(0, 24),
                productReferences: goal.productReferences.slice(0, 24), authorizedToolKeys: goal.authorizedToolKeys.slice(0, 32),
                completionConditions: goal.completionConditions.slice(0, 24), confirmationRequired: goal.confirmationRequired })),
            turnIntents: publishedV2.catalog.sheets.TurnIntents.filter(turn => turn.active)
              .slice(0, 80).map(turn => ({ key: turn.turnIntentKey, categoryKey: turn.categoryKey, businessGoalKey: turn.businessGoalKey })),
            requirements: publishedV2.catalog.sheets.RequirementPolicies.filter(req => req.required)
              .slice(0, 80).map(req => ({ key: req.requirementKey, goalKey: req.goalKey, stageKey: req.stageKey, type: req.type })),
          }
        : null;
      const projection = legacyCatalog ? catalogProjection(legacyCatalog) : { intents: [], slots: [], journeys: [] };
      const activeIntentCount = legacyCatalog?.catalog.intents.filter((intent) => intent.active).length ?? 0;
      return resultWithToolEvidence(request, { ...projection, catalogV2: v2Projection }, request.toolName as V2ToolName, v2Projection?.versionRef ?? sourceVersion, [
        v2Projection
          ? `The published V2 catalog ${v2Projection.versionRef} defines ${v2Projection.businessGoals.length} active business goals.`
          : `The published legacy catalog version ${sourceVersion} contains ${activeIntentCount} active intent definitions.`,
        ...(legacyCatalog?.catalog.journeyRequirements ?? []).slice(0, 6).map(journey =>
          `The legacy catalog defines ${journey.requirementKey} as a ${journey.requirementType} requirement for ${journey.intentKey}.`),
      ]);
    }
    case 'get_missing_requirements': {
      if (!intentKey) return result(request, 'ok', { intentKey: null, requirement: null }, sourceVersion);
      if (!legacyCatalog) {
        const document = await store.getUserIntentDocument(scope.tenantId, scope.sessionId);
        const pending = document?.pendingRequirementKey ?? state?.pendingPrompt?.requirementKey ?? entry?.currentRequirementKey ?? null;
        return resultWithToolEvidence(request, { intentKey, requirement: pending ? { key: pending, type: 'pending', promptKey: null, documentType: null } : null }, request.toolName as V2ToolName, stateSourceVersion,
          [pending ? 'A server-authorized requirement is currently pending.' : 'No server-authorized requirement is currently pending.']);
      }
      const requirement = catalogNextJourneyRequirement(legacyCatalog, intentKey, values, completed) ?? catalogNextFollowUpRequirement(legacyCatalog, intentKey, values, completed);
      return resultWithToolEvidence(request, { intentKey, requirement: requirement ? { key: requirement.requirementKey, type: requirement.requirementType, promptKey: requirement.promptKey, documentType: requirement.documentType ?? null } : null }, request.toolName as V2ToolName, stateSourceVersion, [
        requirement ? 'A server-authorized requirement is ready to collect.' : 'No server-authorized requirement is currently pending.',
      ]);
    }
    case 'search_knowledge': {
      const args = searchArguments.parse(request.arguments);
      const normalizedQuery = normalizeConversationQuery(args.query);
      const evidence = await retrieveApprovedKnowledge(store, embedding, scope.tenantId, 'public', normalizedQuery, args.resultCount ?? 4);
      const approved = (await Promise.all(evidence.map(async (item) => {
        const source = await store.getSource(item.citation.sourceId);
        return source && source.tenantId === scope.tenantId && source.status === 'active' && source.versionId === item.citation.versionId ? item : null;
      }))).filter((item): item is NonNullable<typeof item> => Boolean(item));
      const evidenceRefs = approved.map(item => item.citation.chunkId);
      const sourceVersions = [...new Set(approved.map((item) => item.citation.versionId))];
      // A mixed-version retrieval has per-citation provenance, not a single source version.
      return result(request, 'ok', { grounded: approved.length > 0, evidence: approved.map(item => toV2KnowledgeEvidence(item, normalizedQuery)) }, sourceVersions.length === 1 ? sourceVersions[0]! : null, evidenceRefs);
    }
    case 'get_journey_state': {
      const lifecycle = entry?.lifecycle ?? null;
      const scopedLifecycle = Boolean(scope.opportunityId && entry?.journeyId === scope.opportunityId);
      const value = {
        activeIntentKey: intentKey,
        currentStage: scopedLifecycle ? lifecycle?.currentStage ?? null : null,
        stageStatuses: scopedLifecycle && lifecycle ? Object.fromEntries(Object.entries(lifecycle.stages).map(([key, value]) => [key, value.status])) : {},
        pendingRequirementKey: state?.pendingPrompt?.requirementKey ?? entry?.currentRequirementKey ?? null,
        contactConsent: state?.contactConsent ?? 'unknown',
        workflowStatus: state?.workflowStatus ?? 'none',
        opportunityBound: scopedLifecycle,
      };
      return resultWithToolEvidence(request, value, request.toolName as V2ToolName, stateSourceVersion, [
        scopedLifecycle && lifecycle?.currentStage ? `The authoritative journey is currently at ${lifecycle.currentStage}.` : 'No opportunity is currently bound to the requested journey state.',
        value.pendingRequirementKey ? `The next server-authorized requirement is ${value.pendingRequirementKey}.` : 'No server-authorized requirement is currently pending.',
        `Contact consent is ${value.contactConsent}.`,
        `The current workflow status is ${value.workflowStatus}.`,
      ]);
    }
    case 'get_available_packages': {
      if (v2Catalog) {
        const approvedGoalKeys = new Set(v2Catalog.catalog.sheets.BusinessGoals
          .filter(goal => goal.active).map(goal => goal.businessGoalKey));
        const all = await store.listPackageOfferings(scope.tenantId, { catalogVersionRef: v2Catalog.catalogVersionRef });
        const now = Date.now();
        const approved = all.filter(offering => offering.tenantId === scope.tenantId
          && offering.catalogVersionRef === v2Catalog.catalogVersionRef && offering.approvalStatus === 'approved'
          && (!offering.pricingEffectiveFrom || Date.parse(offering.pricingEffectiveFrom) <= now)
          && (!offering.pricingEffectiveTo || Date.parse(offering.pricingEffectiveTo) > now));
        const selected = approved.slice(0, 20);
        const packages = selected.map(offering => ({
          key: offering.packageKey, name: bounded(offering.name, 160),
          visas: offering.includedVisaQuantity, availability: offering.availability,
          officeRequirement: offering.officeRequirement,
          inclusions: offering.inclusions.slice(0, 12).map(text => bounded(text, 240)),
          priceMinor: offering.priceMinor, currency: offering.currency,
          sourceRefs: offering.sourceRefs.slice(0, 12),
        }));
        const status = selected.length > 0 ? 'available' : 'not_published';
        // Never reinterpret a legacy offering as approved pricing for V2.
        return resultWithToolEvidence(request,
          { status, catalogVersionRef: v2Catalog.catalogVersionRef,
            packages, truncated: approved.length > selected.length,
            availableGoals: [...approvedGoalKeys].slice(0, 20) },
          request.toolName as V2ToolName, sourceVersion,
          selected.length > 0 ? selected.map(offering => packageEvidenceText(offering, 'The published approved package', 'listed'))
            : ['No approved package offerings are published under this pinned Catalog V2 version.']);
      }
      if (!legacyCatalog) return sanitizedToolError(request, 'temporarily_unavailable', 'PACKAGE_CATALOG_UNAVAILABLE', scope.stateRevision);
      const offerings = await store.listPackageOfferings(scope.tenantId, { catalogVersionId: legacyCatalog.id, ...(values.business_activity ? { activity: values.business_activity } : {}), ...(values.entity_type ? { entityType: values.entity_type } : {}) });
      // Keep tool responses bounded even when a tenant has a large published catalog.
      const selected = offerings.slice(0, 20);
      const packages = selected.map((offering) => ({ key: offering.packageKey, name: bounded(offering.name, 160), visas: offering.includedVisaQuantity, officeRequirement: offering.officeRequirement, inclusions: offering.inclusions.slice(0, 12).map(value => bounded(value, 240)), availability: offering.availability, priceMinor: offering.priceMinor, currency: offering.currency, sourceRefs: offering.sourceRefs.slice(0, 12) }));
      return resultWithToolEvidence(request, { packages, truncated: offerings.length > selected.length }, request.toolName as V2ToolName, sourceVersion, selected.length > 0
        ? selected.map((offering) => packageEvidenceText(offering, 'The approved package', 'verified'))
        : ['No approved package is currently available for this setup.']);
    }
    case 'get_document_requirements': {
      if (v2Catalog) {
        const document = await store.getUserIntentDocument(scope.tenantId, scope.sessionId);
        const confirmedGoal = document?.catalogSource === 'v2' && document.goalConfirmed
          && document.catalogVersionRef === v2Catalog.catalogVersionRef
          ? document.businessGoalKey : null;
        const activeGoals = v2Catalog.catalog.sheets.BusinessGoals.filter(goal => goal.active);
        const goalKey = confirmedGoal ?? (activeGoals.length === 1 ? activeGoals[0]!.businessGoalKey : null);
        if (!goalKey) return result(request, 'ok', {
          selectionStatus: 'goal_selection_required', documents: [], packageSpecific: false,
        }, sourceVersion);
        const policies = v2Catalog.catalog.sheets.DocumentPolicies
          .filter(policy => policy.enabled && policy.goalKey === goalKey);
        const documents = policies.slice(0, 30).map(policy => ({
          documentType: policy.docType, stageKey: policy.stageKey,
          required: policy.required, mimeTypes: policy.mimeTypes.slice(0, 8),
          reviewPolicy: policy.reviewPolicy, policyKey: policy.policyKey,
        }));
        return resultWithToolEvidence(request, {
          selectionStatus: documents.length ? 'published_general_policy' : 'no_published_policy',
          goalKey, documents, packageSpecific: false, truncated: policies.length > documents.length,
        }, request.toolName as V2ToolName, sourceVersion,
        documents.length ? documents.map(policy =>
          `The published ${goalKey} policy lists ${policy.documentType} as ${policy.required ? 'a required' : 'an optional'} document at ${policy.stageKey}.`)
          : [`No general document requirements are published for ${goalKey} in this catalog version.`]);
      }
      if (!legacyCatalog) return sanitizedToolError(request, 'temporarily_unavailable', 'DOCUMENT_CATALOG_UNAVAILABLE', scope.stateRevision);
      // Read only documents for the confirmed package and approved quotation in this opportunity.
      if (!scope.opportunityId) return resultWithToolEvidence(request, { selectionStatus: 'opportunity_required', documents: [] }, request.toolName as V2ToolName, sourceVersion, ['An opportunity is required before document requirements can be verified.']);
      const selections = await store.listPackageSelections(scope.tenantId, scope.opportunityId);
      const selected = selections.find((s) => s.status === 'confirmed' && s.tenantId === scope.tenantId && s.sessionId === scope.sessionId && s.opportunityId === scope.opportunityId && s.quoteId);
      if (!selected || !selected.quoteId) return resultWithToolEvidence(request, { selectionStatus: 'package_not_confirmed', documents: [] }, request.toolName as V2ToolName, sourceVersion, ['No confirmed package is available for document requirements.']);
      const [offering, quote] = await Promise.all([
        store.getPackageOffering(selected.packageOfferingId, scope.tenantId),
        store.getQuote(selected.quoteId, scope.tenantId),
      ]);
      if (!offering || !quote || offering.tenantId !== scope.tenantId || offering.catalogVersionId !== legacyCatalog.id || offering.approvalStatus !== 'approved' || quote.status !== 'approved' || quote.tenantId !== scope.tenantId || quote.opportunityId !== scope.opportunityId || quote.packageOfferingId !== offering.id || Date.parse(quote.validUntil) <= Date.now()) {
        return resultWithToolEvidence(request, { selectionStatus: 'package_or_quote_unverified', documents: [] }, request.toolName as V2ToolName, sourceVersion, ['The package or quotation is not currently verified for document collection.']);
      }
      const documents = offering.requiredDocuments.map((documentType) => ({ packageKey: offering.packageKey, documentType }));
      return resultWithToolEvidence(request, {
        selectionStatus: 'confirmed',
        packageKey: offering.packageKey,
        documents,
      }, request.toolName as V2ToolName, sourceVersion, [`The confirmed package ${offering.packageKey} requires ${offering.requiredDocuments.join(', ')}.`]);
    }
    case 'get_action_status': {
      if (!scope.opportunityId) return result(request, 'ok', { actions: [] }, sourceVersion);
      const actions = await store.listActionsBySession(scope.sessionId, scope.tenantId);
      const scoped = actions.filter((action) => action.opportunityId === scope.opportunityId);
      const status = await Promise.all(scoped.map(async (action) => {
        const execution = await store.getActionExecution(action.id, scope.tenantId);
        const evidenceStatus = deriveV2ProviderEvidenceStatus({ actionState: action.state, providerStatus: execution?.providerStatus ?? null, evidenceTier: execution?.outcome?.evidenceTier });
        return { workflowKey: action.workflowKey, state: action.state, actionKey: action.actionKey ?? null, providerAcknowledged: Boolean(action.result?.externalReference), providerOutcome: action.result?.providerOutcome ?? null, artifactAvailable: Boolean(action.result?.artifactSha256), artifactFileName: action.result?.artifactFileName ?? null, providerStatus: execution?.providerStatus ?? null, evidenceStatus, stageCompletionEligible: v2StageCompletionEligible(evidenceStatus) };
      }));
      const claims = status.length > 0
        ? status.map((item) => {
          const label = actionLabel(item.workflowKey, item.actionKey);
          if (item.stageCompletionEligible) return `The verified provider outcome for ${label} is complete.`;
          if (item.providerOutcome === 'pdf_generated') return `The quotation artifact for ${label} was generated and is awaiting provider verification.`;
          if (item.providerOutcome === 'success' || item.providerOutcome === 'updated') return `The ${label} workflow returned ${item.providerOutcome}; independent provider verification is still pending.`;
          if (item.state === 'awaiting_confirmation') return `${label} is awaiting customer confirmation.`;
          return `${label} is awaiting verified provider evidence.`;
        })
        : ['No authorized business action is currently recorded for this opportunity.'];
      return resultWithToolEvidence(request, { actions: status.slice(0, 20), truncated: status.length > 20 }, request.toolName as V2ToolName, stateSourceVersion, claims.slice(0, 20));
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
    if (!parsed.success) {
      console.error(JSON.stringify({ event: 'v2.tool.invalid_request', issues: parsed.error.issues.map((issue) => ({ code: issue.code, path: issue.path })) }));
      return sanitizedToolError({ schemaVersion: 2, toolCallId: 'invalid-call', toolName: 'invalid', arguments: {}, scopeRef: 'invalid-scope', expectedStateRevision: 0, deadlineAt: new Date().toISOString() } as ToolRequestV2, 'invalid_args', 'INVALID_TOOL_REQUEST');
    }
    const request = parsed.data;
    const requestDeadline = Date.parse(request.deadlineAt);
    if (!Number.isFinite(requestDeadline) || requestDeadline <= Date.now() || requestDeadline > Date.now() + TOOL_MAX_DEADLINE_MS) return sanitizedToolError(request, 'temporarily_unavailable', 'TOOL_DEADLINE_EXCEEDED');
    const scope = verifyV2Scope(request.scopeRef, serviceKey);
    if (!scope) return sanitizedToolError(request, 'not_authorized', 'SCOPE_INVALID');
    if (requestDeadline > scope.expiresAt) return sanitizedToolError(request, 'not_authorized', 'TOOL_DEADLINE_OUTSIDE_SCOPE', scope.stateRevision);
    if (!scope.toolAllowlist.includes(request.toolName as V2ToolName) || !V2_TOOL_NAMES.includes(request.toolName as V2ToolName)) return sanitizedToolError(request, 'not_authorized', 'TOOL_NOT_ALLOWED', scope.stateRevision);
    const session = await store.getSession(scope.sessionId);
    if (!session || session.tenantId !== scope.tenantId) return sanitizedToolError(request, 'not_authorized', 'SESSION_SCOPE_DENIED', scope.stateRevision);
    if ((session.stateVersion ?? 0) !== scope.stateRevision || request.expectedStateRevision !== scope.stateRevision) return sanitizedToolError(request, 'stale_state', 'STATE_REVISION_STALE', session.stateVersion ?? 0);
    if (session.personaVersionId !== scope.personaVersionId || session.conversationState?.catalogVersionId !== scope.catalogVersionId) return sanitizedToolError(request, 'stale_state', 'PINNED_CONTEXT_STALE', session.stateVersion ?? 0);
    const entry = activeEntry(session);
    if (scope.opportunityId && entry?.journeyId !== scope.opportunityId) return sanitizedToolError(request, 'not_authorized', 'OPPORTUNITY_SCOPE_DENIED', scope.stateRevision);
    const catalog = await catalogForScope(store, scope);
    if (!catalog) return sanitizedToolError(request, 'temporarily_unavailable', 'CATALOG_UNAVAILABLE', scope.stateRevision);
    // Signed model scope and current published tenant policy must BOTH permit the read.
    // Publication revocation or permission changes cannot be bypassed by replay.
    if (catalog.kind === 'v2' && !isV2ReadToolEnabled(catalog.version.catalog, request.toolName as V2ToolName)) {
      return sanitizedToolError(request, 'not_authorized', 'V2_READ_TOOL_NOT_PUBLISHED', scope.stateRevision);
    }
    // Replay data is safe only AFTER the current state, persona, opportunity and catalog
    // are re-authorized. Otherwise an old cached success can survive a revocation.
    const cacheKey = `${request.scopeRef}:${request.toolCallId}`;
    const argsDigest = digest(JSON.stringify(request.arguments));
    const cached = replayCache.get(cacheKey);
    if (cached && cached.argsDigest !== argsDigest) return sanitizedToolError(request, 'not_authorized', 'TOOL_CALL_REUSE_MISMATCH', scope.stateRevision);
    // Immutable pinned versions can be replayed. Dynamic reads (especially RAG and
    // provider status) must be refreshed: source revocation, package availability
    // and provider outcomes can change without a session revision increment.
    // Published catalog and persona records can be revoked without a session
    // revision change; always refresh them, including on repeated call IDs.
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const parsedArguments = argumentSchemas[request.toolName as V2ToolName]?.safeParse(request.arguments);
      if (!parsedArguments?.success) return sanitizedToolError(request, 'invalid_args', 'TOOL_ARGUMENTS_INVALID', scope.stateRevision);
      const remainingMs = Math.min(requestDeadline, scope.expiresAt) - Date.now();
      if (remainingMs <= 0) return sanitizedToolError(request, 'temporarily_unavailable', 'TOOL_DEADLINE_EXCEEDED', scope.stateRevision);
      // Hard upper bound on the HTTP-visible read result. The underlying store
      // adapter may finish later, but no late result is ever published to the model.
      const deadline = new Promise<never>((_resolve, reject) => {
        deadlineTimer = setTimeout(() => reject(new Error('V2_TOOL_EXECUTION_DEADLINE')), remainingMs);
      });
      const value = await Promise.race([toolResultFor(request, scope, session, catalog, store, embedding), deadline]);
      if (Date.now() > requestDeadline) return sanitizedToolError(request, 'temporarily_unavailable', 'TOOL_DEADLINE_EXCEEDED', scope.stateRevision);
      remember(cacheKey, argsDigest, value);
      await store.addAudit({ id: randomBytes(16).toString('hex'), tenantId: scope.tenantId, actorId: null, eventName: 'v2.tool.read', metadata: { sessionId: scope.sessionId, toolName: request.toolName, toolCallDigest: digest(request.toolCallId).slice(0, 16), scopeDigest: digest(request.scopeRef).slice(0, 16), status: value.status, stateRevision: scope.stateRevision }, createdAt: new Date().toISOString() });
      return value;
    } catch (error) {
      const code = error instanceof Error && error.message === 'V2_TOOL_EXECUTION_DEADLINE'
        ? 'TOOL_DEADLINE_EXCEEDED' : 'TOOL_UNAVAILABLE';
      const value = sanitizedToolError(request, 'temporarily_unavailable', code, scope.stateRevision);
      remember(cacheKey, argsDigest, value);
      return value;
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
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
