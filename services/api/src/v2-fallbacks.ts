import { createHash } from 'node:crypto';
import { personaComposedResponseSchema, type PersonaComposedResponseV2 } from './python-model/v2-contracts.js';

export const V2_FALLBACK_FAMILIES = [
  'missing_knowledge',
  'invalid_model',
  'rate_limited',
  'tool_unavailable',
  'action_processing',
  'reconciliation',
  'consent_declined',
  'human_handoff',
] as const;

export type V2FallbackFamily = typeof V2_FALLBACK_FAMILIES[number];

export interface V2ApprovedFallbackTemplateSet {
  approved: boolean;
  personaVersionId: string;
  templateVersion: string;
  language: string;
  templates: Partial<Record<V2FallbackFamily, string>>;
}

export interface V2FallbackRequest {
  personaVersionId: string;
  templateVersion: string;
  language: string;
  family: V2FallbackFamily;
}

const forbidden = /(?:tenantId|sessionId|opportunityId|scopeRef|toolCallId|function_call|system prompt|api[_ -]?key|secret|password|payment\s+(?:complete|completed)|contract\s+(?:signed|completed)|(?:account|company)\s+(?:created|registered))/iu;
const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 32);

export const selectV2OfflineFallback = (request: V2FallbackRequest, set: V2ApprovedFallbackTemplateSet | null | undefined): PersonaComposedResponseV2 | null => {
  if (!set?.approved || set.personaVersionId !== request.personaVersionId || set.templateVersion !== request.templateVersion || set.language !== request.language) return null;
  const answer = set.templates[request.family]?.trim();
  if (!answer || answer.length > 12_000 || forbidden.test(answer)) return null;
  const response: PersonaComposedResponseV2 = {
    schemaVersion: 2,
    personaVersionId: request.personaVersionId,
    language: request.language,
    answer,
    citationIds: [],
    nextQuestion: null,
    nextQuestionKey: null,
    reasonNoQuestion: request.family,
    decisionRef: `offline-${digest(`${request.templateVersion}:${request.family}:${answer}`)}`,
  };
  return personaComposedResponseSchema.parse(response);
};
