import { describe, expect, it } from 'vitest';
import {
  buildSessionSnapshot, extractCoreMemory, type PersonaRow, type SessionRow,
} from '../adapters/context-builder.js';

const persona: PersonaRow = {
  id: 'persona-1', name: 'Zara', greeting: 'Hello', personality: 'curious',
  tone: 'helpful', speaking_style: 'concise', permitted_languages: ['en'],
};
const session: SessionRow = {
  id: 'session-1', tenant_id: 'tenant-1', state_version: 3, tenant_status: 'active',
  persona_version_id: null, closed_at: null,
  conversation_state: { phase: 'DISCOVERY', rollingSummary: 'Original conversation context' },
};
const base = {
  session, persona, principalId: 'verified-session-hash',
  catalog: { id: 'catalog-1', catalog_json: { sheets: { BusinessGoals: [
    { businessGoalKey: 'company_formation', active: true },
    { businessGoalKey: 'disabled_goal', active: false },
  ] } } },
  intentDocument: {
    summary: 'Authoritative intent summary', revision: 4,
    verified_facts: { business_activity: { maskedValue: 'Technology', source: 'visitor' } },
  },
  messagesNewestFirst: [
    { role: 'assistant', masked_content: 'Which activity?' },
    { role: 'user', masked_content: 'I want to start a business.' },
  ],
  actionsNewestFirst: [{ id: 'action-1', workflow_key: 'crm.lead.create', state: 'completed' }],
};

describe('P2 durable conversation projection', () => {
  it('preserves sourced customer facts, immutable catalog keys and prior conversation order', () => {
    const snapshot = buildSessionSnapshot(base);
    expect(snapshot.conversationSummary).toBe('Authoritative intent summary');
    expect(snapshot.verifiedFacts).toEqual([expect.objectContaining({ key: 'business_activity', value: 'Technology', source: 'customer' })]);
    expect(snapshot.publishedGoalKeys).toEqual(['company_formation']);
    expect(snapshot.recentTurns.map(turn => turn.role)).toEqual(['customer', 'assistant']);
    expect(snapshot.revision).toBe(3);
  });

  it('never treats an unverified legacy completion flag as completed provider evidence', () => {
    const snapshot = buildSessionSnapshot(base);
    expect(snapshot.pendingActionStatus[0]?.status).toBe('reconciliation_required');
  });

  it('uses a committed conversation-core summary when available after a restart', () => {
    const snapshot = buildSessionSnapshot({
      ...base,
      session: { ...session, conversation_state: {
        rollingSummary: 'Legacy summary', conversationCore: { summary: 'Core persisted summary', summaryRevision: 2 },
      } },
    });
    expect(snapshot.conversationSummary).toBe('Core persisted summary');
  });

  it('preserves catalog-scoped provisional goal candidates without confirming them', () => {
    const projected = buildSessionSnapshot({
      ...base,
      session: { ...session, conversation_state: {
        conversationCore: { provisionalGoalKeys: ['company_formation', 'unpublished_goal'] },
      } },
    });
    expect(projected.provisionalGoalKeys).toEqual(['company_formation']);
    expect(projected.publishedGoalKeys).toEqual(['company_formation']);
  });

  it('ignores invalid fact rows without inventing new facts', () => {
    expect(extractCoreMemory({ conversationCore: { verifiedFacts: [null, 'junk', { key: '', value: 'x' }] } }).verifiedFacts).toEqual([]);
  });
});
