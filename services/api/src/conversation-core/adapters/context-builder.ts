import type { HistoryTurn, SessionSnapshot, VerifiedFact } from '../contracts.js';

export interface SessionRow {
  id: string;
  tenant_id: string;
  tenant_status: string;
  state_version: number;
  persona_version_id: string | null;
  conversation_state: unknown;
  closed_at: Date | string | null;
}
export interface PersonaRow {
  id: string;
  name: string;
  greeting: string;
  personality: string;
  tone: string;
  speaking_style: string;
  permitted_languages: string[];
}
export interface CatalogRow {
  id: string;
  catalog_json: unknown;
}
export interface IntentDocumentRow {
  summary: string;
  verified_facts: unknown;
  revision: number;
}
export interface MessageRow {
  role: string;
  masked_content: string;
}
export interface ActionRow {
  id: string;
  workflow_key: string;
  state: string;
}

function record(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
}

function safeString(value: unknown, limit = 6_000): string {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

export interface CoreMemory {
  readonly catalogVersionId?: string;
  readonly verifiedFacts?: readonly VerifiedFact[];
  readonly summary?: string;
  readonly summaryRevision?: number;
}

export function extractCoreMemory(conversationState: unknown): CoreMemory {
  const raw = record(record(conversationState).conversationCore);
  const values = Array.isArray(raw.verifiedFacts) ? raw.verifiedFacts : [];
  const verifiedFacts = values.filter((candidate): candidate is VerifiedFact => {
    const fact = record(candidate);
    return typeof fact.key === 'string' && fact.key.length > 0 && fact.key.length <= 100
      && typeof fact.value === 'string' && fact.value.length <= 4_000
      && ['customer', 'catalog', 'node', 'provider'].includes(String(fact.source))
      && typeof fact.sourceReference === 'string'
      && Number.isSafeInteger(fact.revision) && Number(fact.revision) >= 0;
  });
  return {
    ...(typeof raw.catalogVersionId === 'string' ? { catalogVersionId: raw.catalogVersionId } : {}),
    verifiedFacts,
    ...(typeof raw.summary === 'string' ? { summary: raw.summary } : {}),
    ...(Number.isSafeInteger(raw.summaryRevision) ? { summaryRevision: Number(raw.summaryRevision) } : {}),
  };
}

function documentFacts(raw: unknown, revision: number): VerifiedFact[] {
  return Object.entries(record(raw)).flatMap(([key, item]) => {
    const value = record(item);
    const masked = value.maskedValue;
    if (!key || key.length > 100 || typeof masked !== 'string' || masked.length > 4_000) return [];
    const source = value.source === 'visitor' ? 'customer' : value.source;
    if (source !== 'customer' && source !== 'catalog' && source !== 'node' && source !== 'provider') return [];
    return [{ key, value: masked, source, sourceReference: `intent-document:${revision}:${key}`, revision }];
  });
}

function goalKeys(raw: unknown): string[] {
  const goals = record(record(raw).sheets).BusinessGoals;
  if (!Array.isArray(goals)) return [];
  return [...new Set(goals.flatMap(item => {
    const candidate = record(item);
    const goalKey = candidate.businessGoalKey;
    return candidate.active === true && typeof goalKey === 'string' && /^[a-z][a-z0-9._-]{1,79}$/u.test(goalKey)
      ? [goalKey] : [];
  }))].slice(0, 100);
}

/** Pure projection. Never promotes assistant text to a verified customer fact. */
export function buildSessionSnapshot(input: {
  session: SessionRow;
  principalId: string;
  persona: PersonaRow;
  catalog: CatalogRow | null;
  intentDocument: IntentDocumentRow | null;
  messagesNewestFirst: readonly MessageRow[];
  actionsNewestFirst: readonly ActionRow[];
  messageLimit?: number;
}): SessionSnapshot {
  const { session, principalId, persona, catalog, intentDocument } = input;
  if (!Number.isSafeInteger(session.state_version) || session.state_version < 0) {
    throw new Error('Invalid persistent session revision');
  }
  const state = record(session.conversation_state);
  const core = extractCoreMemory(session.conversation_state);
  const facts = new Map<string, VerifiedFact>();
  for (const value of documentFacts(intentDocument?.verified_facts, intentDocument?.revision ?? 0)) facts.set(value.key, value);
  for (const value of core.verifiedFacts ?? []) facts.set(value.key, value);
  const summary = safeString(core.summary || intentDocument?.summary || state.rollingSummary || '');
  const recentTurns: HistoryTurn[] = [...input.messagesNewestFirst]
    .slice(0, input.messageLimit ?? 16).reverse()
    .flatMap(msg => (msg.role === 'user' || msg.role === 'assistant') && typeof msg.masked_content === 'string'
      ? [{ role: msg.role === 'user' ? 'customer' as const : 'assistant' as const, text: msg.masked_content.slice(0, 4_000) }]
      : []);
  const pendingActionStatus = input.actionsNewestFirst.slice(0, 32).map(action => {
    const state = action.state.toLowerCase();
    // A completed status in action_requests alone does not establish verified
    // provider execution. P5 must provide a separate trustworthy readback.
    const status: SessionSnapshot['pendingActionStatus'][number]['status'] =
      state === 'proposed' || state === 'pending' ? 'proposed'
        : state === 'awaiting_confirmation' || state === 'awaiting_authorization' ? 'awaiting_authorization'
          : state === 'approved' || state === 'queued' ? 'queued'
            : state === 'processing' || state === 'executing' ? 'executing'
              : state === 'failed' || state === 'rejected' ? 'failed' : 'reconciliation_required';
    return { actionId: action.id, actionKey: action.workflow_key, status };
  });
  return {
    tenantId: session.tenant_id,
    sessionId: session.id,
    ownerPrincipalId: principalId, // Derived only AFTER session-token verification.
    revision: session.state_version,
    personaVersionId: persona.id,
    catalogVersionId: core.catalogVersionId || catalog?.id || 'unconfigured',
    personaInstructions: [
      `Name: ${safeString(persona.name, 100)}`,
      `Greeting: ${safeString(persona.greeting, 500)}`,
      `Personality: ${safeString(persona.personality, 1000)}`,
      `Tone: ${safeString(persona.tone, 500)}`,
      `Speaking style: ${safeString(persona.speaking_style, 500)}`,
      `Permitted languages: ${(persona.permitted_languages || ['en']).join(', ').slice(0, 100)}`,
    ].join('\n'),
    conversationSummary: summary,
    recentTurns,
    verifiedFacts: [...facts.values()],
    publishedGoalKeys: goalKeys(catalog?.catalog_json),
    pendingActionStatus,
  };
}
