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
export interface CatalogRow { id: string; catalog_json: unknown; }
export interface MessageRow { role: string; masked_content: string; }
export interface ActionRow { id: string; workflow_key: string; state: string; }

function object(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
}
function text(value: unknown, size = 6000): string {
  return typeof value === 'string' ? value.slice(0, size) : '';
}

export interface CoreMemory {
  readonly catalogVersionId?: string;
  readonly provisionalGoalKeys?: readonly string[];
  readonly verifiedFacts?: readonly VerifiedFact[];
  readonly summary?: string;
  readonly summaryRevision?: number;
}

/** The only owner of model-facing conversation memory is conversationCore. */
export function extractCoreMemory(state: unknown): CoreMemory {
  const raw = object(object(state).conversationCore);
  const verifiedFacts = (Array.isArray(raw.verifiedFacts) ? raw.verifiedFacts : [])
    .filter((candidate): candidate is VerifiedFact => {
      const value = object(candidate);
      return typeof value.key === 'string' && value.key.length > 0 && value.key.length <= 100
        && typeof value.value === 'string' && value.value.length <= 4000
        && ['customer','catalog','node','provider'].includes(String(value.source))
        && typeof value.sourceReference === 'string'
        && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0;
    });
  const provisionalGoalKeys = (Array.isArray(raw.provisionalGoalKeys) ? raw.provisionalGoalKeys : [])
    .filter((key): key is string => typeof key === 'string' && /^[a-z][a-z0-9._-]{1,79}$/u.test(key)).slice(0, 8);
  return {
    ...(typeof raw.catalogVersionId === 'string' ? { catalogVersionId: raw.catalogVersionId } : {}),
    provisionalGoalKeys,
    verifiedFacts,
    ...(typeof raw.summary === 'string' ? { summary: raw.summary.slice(0, 6000) } : {}),
    ...(Number.isSafeInteger(raw.summaryRevision) ? { summaryRevision: Number(raw.summaryRevision) } : {}),
  };
}
function activeGoalKeys(catalogJson: unknown): string[] {
  const goals = object(object(catalogJson).sheets).BusinessGoals;
  if (!Array.isArray(goals)) return [];
  return [...new Set(goals.flatMap((row) => {
    const goal = object(row), key = goal.businessGoalKey;
    return goal.active && typeof key === 'string' && /^[a-z][a-z0-9._-]{1,79}$/u.test(key) ? [key] : [];
  }))].slice(0, 100);
}
export function buildSessionSnapshot(input: {
  session: SessionRow;
  principalId: string;
  persona: PersonaRow;
  catalog: CatalogRow | null;
  messagesNewestFirst: readonly MessageRow[];
  actionsNewestFirst: readonly ActionRow[];
  messageLimit?: number;
}): SessionSnapshot {
  const { session, principalId, persona, catalog } = input;
  if (!Number.isSafeInteger(session.state_version) || session.state_version < 0) {
    throw new Error('Invalid session revision');
  }
  const memory = extractCoreMemory(session.conversation_state);
  const goalKeys = activeGoalKeys(catalog?.catalog_json);
  const recentTurns: HistoryTurn[] = [...input.messagesNewestFirst].slice(0, input.messageLimit ?? 16)
    .reverse().flatMap(row => (row.role === 'user' || row.role === 'assistant')
      && typeof row.masked_content === 'string'
      ? [{ role: row.role === 'user' ? 'customer' as const : 'assistant' as const,
        text: row.masked_content.slice(0,4000) }] : []);
  return {
    tenantId: session.tenant_id, sessionId: session.id, ownerPrincipalId: principalId,
    revision: session.state_version,
    personaVersionId: persona.id,
    catalogVersionId: memory.catalogVersionId ?? catalog?.id ?? 'unconfigured',
    personaInstructions: [
      `Name: ${text(persona.name,100)}`,
      `Greeting: ${text(persona.greeting,500)}`,
      `Personality: ${text(persona.personality,1000)}`,
      `Tone: ${text(persona.tone,500)}`,
      `Speaking style: ${text(persona.speaking_style,500)}`,
      `Permitted languages: ${(persona.permitted_languages || ['en']).join(', ').slice(0,100)}`,
    ].join('\n'),
    conversationSummary: memory.summary ?? '',
    recentTurns,
    verifiedFacts: memory.verifiedFacts ?? [],
    publishedGoalKeys: goalKeys,
    provisionalGoalKeys: (memory.provisionalGoalKeys ?? []).filter(key => goalKeys.includes(key)),
    pendingActionStatus: input.actionsNewestFirst.slice(0,32).map(action => {
      const state = action.state.toLowerCase();
      const status: SessionSnapshot['pendingActionStatus'][number]['status'] =
        state === 'proposed' || state === 'pending' ? 'proposed'
          : state === 'awaiting_confirmation' || state === 'awaiting_authorization' ? 'awaiting_authorization'
            : state === 'approved' || state === 'queued' ? 'queued'
              : state === 'processing' || state === 'executing' ? 'executing'
                : state === 'failed' || state === 'rejected' ? 'failed'
                  : 'reconciliation_required';
      // A provider-completed action must carry independent correlated readback;
      // action_requests status alone cannot certify external success.
      return { actionId: action.id, actionKey: action.workflow_key, status };
    }),
  };
}
