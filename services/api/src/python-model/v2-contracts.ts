import { v2PlanningProposalSchema } from '../v2-planning.js';
import { z } from 'zod';

export const V2_SCHEMA_VERSION = 2 as const;

const boundedKey = z.string().trim().regex(/^[a-z][a-z0-9._:-]{0,127}$/u);
const opaqueRef = z.string().trim().regex(/^[A-Za-z0-9._:-]{8,256}$/u);
const decisionRef = z.string().trim().regex(/^[A-Za-z0-9._:+-]{1,256}$/u);
const scopeRef = z.string().trim().regex(/^[A-Za-z0-9._:-]{8,2048}$/u);
const boundedText = z.string().trim().max(5_000);

const persona = z.object({
  personaVersionId: opaqueRef,
  assistantName: z.string().trim().min(1).max(150),
  assistantRole: z.string().trim().min(1).max(300),
  permittedLanguages: z.array(z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/u)).min(1).max(8),
  tone: z.array(z.string().trim().min(1).max(80)).max(12),
  speakingStyle: z.string().trim().max(500),
  fallbackTemplateVersion: opaqueRef,
}).strict();

const latestTurn = z.object({
  role: z.enum(['customer', 'assistant']),
  content: z.string().trim().max(2_000),
}).strict();

const intentProjection = z.object({
  primaryGoalKey: boundedKey.nullable(),
  goalConfirmed: z.boolean(),
  currentStageKey: boundedKey.nullable(),
  pendingRequirementKey: boundedKey.nullable(),
  /** Server-validated, non-PII customer facts only; not pricing or provider claims. */
  confirmedCustomerFacts: z.object({
    business_activity: z.string().trim().min(1).max(180).optional(),
    entity_type: z.string().trim().min(1).max(80).optional(),
    visa_count: z.string().trim().min(1).max(12).optional(),
    timeline: z.string().trim().min(1).max(100).optional(),
  }).strict().optional(),
}).strict();

const budgets = z.object({
  maxModelRequests: z.number().int().min(1).max(8),
  maxToolCalls: z.number().int().min(0).max(12),
  maxToolRounds: z.number().int().min(0).max(6),
  deadlineAt: z.string().datetime({ offset: true }),
}).strict();

export const turnEnvelopeSchema = z.object({
  schemaVersion: z.literal(V2_SCHEMA_VERSION),
  requestId: opaqueRef,
  clientMessageId: opaqueRef,
  scopeRef,
  sessionRevision: z.number().int().nonnegative(),
  intentRevision: z.number().int().nonnegative(),
  catalogVersionId: opaqueRef,
  personaVersionId: opaqueRef,
  customerMessageMasked: boundedText,
  latestTurns: z.array(latestTurn).max(8),
  conversationSummary: z.string().trim().max(6_000).optional(),
  persona,
  catalogDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  /** Server-retrieved and version-checked public RAG snippets, not user text. */
  approvedKnowledge: z.array(z.object({
    citationId: opaqueRef, sourceRef: opaqueRef, sourceVersion: opaqueRef,
    text: z.string().trim().min(1).max(1_500),
  }).strict()).max(4).optional(),
  /** A one-shot Node-initiated repair after rejecting an unsupported knowledge claim. */
  knowledgeRepair: z.object({
    reason: z.literal('unsupported_claim'),
    strategy: z.literal('source_close'),
  }).strict().optional(),
  catalogV2: z.object({
    versionRef: z.string().trim().min(8).max(240),
    businessGoals: z.array(z.object({ key: boundedKey, name: z.string().max(120), confirmationRequired: z.boolean() }).strict()).max(100),
    turnIntents: z.array(z.object({ key: boundedKey, categoryKey: boundedKey, businessGoalKey: boundedKey.nullable() }).strict()).max(200),
    signals: z.array(z.object({ signalId: boundedKey, value: z.string().max(500), targetKey: boundedKey, aliases: z.array(z.string().trim().max(500)).max(12).optional() }).strict()).max(500),
    knowledgeTopics: z.array(z.object({ topicKey: boundedKey, goalKey: boundedKey.nullable(), citationRequired: z.boolean() }).strict()).max(500).default([]),
    requirementKeys: z.array(boundedKey).max(500),
    enabledReadToolKeys: z.array(boundedKey).max(32),
    enabledActionToolKeys: z.array(boundedKey).max(32).default([]),
  }).strict().nullable().optional(),
  intentProjection,
  toolAllowlist: z.array(boundedKey).max(32),
  budgets,
}).strict().superRefine((value, ctx) => {
  if (value.persona.personaVersionId !== value.personaVersionId) {
    ctx.addIssue({ code: 'custom', path: ['personaVersionId'], message: 'Persona pin mismatch.' });
  }
  if (value.personaVersionId.length === 0 || value.catalogVersionId.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['catalogVersionId'], message: 'Version pins are required.' });
  }
});

const forbiddenScopeKeys = new Set(['tenantId', 'sessionId', 'opportunityId', 'scopeRef']);
const safeArguments = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  for (const key of Object.keys(value)) {
    if (forbiddenScopeKeys.has(key)) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'Identity scope is server-derived.' });
    }
  }
});

export const toolRequestSchema = z.object({
  schemaVersion: z.literal(V2_SCHEMA_VERSION),
  toolCallId: opaqueRef,
  toolName: boundedKey,
  arguments: safeArguments,
  scopeRef,
  expectedStateRevision: z.number().int().nonnegative(),
  deadlineAt: z.string().datetime({ offset: true }),
}).strict();

export const toolResultSchema = z.object({
  schemaVersion: z.literal(V2_SCHEMA_VERSION),
  toolCallId: opaqueRef,
  status: z.enum(['ok', 'temporarily_unavailable', 'not_authorized', 'invalid_args', 'stale_state']),
  result: z.record(z.string(), z.unknown()).nullable(),
  evidenceRefs: z.array(opaqueRef).max(32),
  sourceVersion: opaqueRef.nullable(),
  stateRevision: z.number().int().nonnegative(),
}).strict();

export const personaComposedResponseSchema = z.object({
  schemaVersion: z.literal(V2_SCHEMA_VERSION),
  personaVersionId: opaqueRef,
  language: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/u),
  answer: z.string().trim().min(1).max(12_000),
  citationIds: z.array(opaqueRef).max(32),
  nextQuestion: z.string().trim().max(1_000).nullable(),
  nextQuestionKey: boundedKey.nullable(),
  reasonNoQuestion: z.string().trim().max(300).nullable(),
  decisionRef,
  planning: v2PlanningProposalSchema.nullable().optional(),
}).strict();

export const responseGuardVerdictSchema = z.object({
  schemaVersion: z.literal(V2_SCHEMA_VERSION),
  accepted: z.boolean(),
  reasonCode: z.enum(['accepted', 'persona_mismatch', 'invalid_citation', 'unsupported_claim', 'invalid_question', 'metadata_leak', 'stale_state', 'policy_denied']),
  response: personaComposedResponseSchema.nullable(),
}).strict();

const toolTraceSchema = z.object({
  toolCallId: opaqueRef,
  toolName: boundedKey,
  status: z.enum(['ok', 'temporarily_unavailable', 'not_authorized', 'invalid_args', 'stale_state']),
  resultDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  elapsedMs: z.number().int().nonnegative().max(180_000),
  evidenceRefs: z.array(opaqueRef).max(32).default([]),
}).strict();

const approvedEvidenceSchema = z.object({
  citationId: opaqueRef,
  text: z.string().trim().min(1).max(1_500),
  sourceVersion: opaqueRef,
  approved: z.literal(true),
  revoked: z.literal(false),
  sourceRef: opaqueRef,
}).strict();

export const agentTurnResultSchema = z.object({
  response: personaComposedResponseSchema,
  toolTrace: z.array(toolTraceSchema).max(12),
  approvedEvidence: z.array(approvedEvidenceSchema).max(32).default([]),
  modelRequestCount: z.number().int().min(1).max(8),
  toolCallCount: z.number().int().nonnegative().max(12),
  diagnosticCandidate: z.string().max(2_000).nullable().optional(),
}).strict();

export type TurnEnvelopeV2 = z.infer<typeof turnEnvelopeSchema>;
export type ToolRequestV2 = z.infer<typeof toolRequestSchema>;
export type ToolResultV2 = z.infer<typeof toolResultSchema>;
export type PersonaComposedResponseV2 = z.infer<typeof personaComposedResponseSchema>;
export type ResponseGuardVerdictV2 = z.infer<typeof responseGuardVerdictSchema>;
export type AgentTurnResultV2 = z.infer<typeof agentTurnResultSchema>;
export type V2ApprovedEvidence = z.infer<typeof approvedEvidenceSchema>;

export function validateToolRequest(
  input: unknown,
  trusted: Pick<TurnEnvelopeV2, 'scopeRef' | 'sessionRevision' | 'toolAllowlist'>,
): ToolRequestV2 {
  const request = toolRequestSchema.parse(input);
  if (request.scopeRef !== trusted.scopeRef) throw new Error('TOOL_SCOPE_MISMATCH');
  if (!trusted.toolAllowlist.includes(request.toolName)) throw new Error('TOOL_NOT_ALLOWED');
  if (request.expectedStateRevision !== trusted.sessionRevision) throw new Error('STALE_CONTEXT');
  return request;
}
