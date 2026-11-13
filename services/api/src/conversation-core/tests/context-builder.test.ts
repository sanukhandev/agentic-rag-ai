import { describe, expect, it } from 'vitest';
import {
  buildSessionSnapshot, extractCoreMemory, type PersonaRow, type SessionRow,
} from '../adapters/context-builder.js';

const persona: PersonaRow = {
  id: 'persona-1', name: 'Zara', greeting: 'Hello',
  personality: 'curious', tone: 'helpful',
  speaking_style: 'concise', permitted_languages: ['en'],
};
const session: SessionRow = {
  id: 'session-1', tenant_id: 'tenant-1', state_version: 3,
  tenant_status: 'active', persona_version_id: null, closed_at: null,
  conversation_state: { conversationCore: {
    summary: 'The customer wants a company.',
    verifiedFacts: [{
      key: 'business_activity', value: 'Technology', source: 'customer',
      sourceReference: 'customer-turn:1', revision: 2,
    }],
  }},
};
const base = {
  session, persona, principalId: 'verified-session-hash',
  catalog: { id: 'catalog-1', catalog_json: { sheets: { BusinessGoals: [
    { businessGoalKey: 'company_formation', active: true },
    { businessGoalKey: 'disabled_goal', active: false },
  ] } } },
  messagesNewestFirst: [
    { role: 'assistant', masked_content: 'Which activity?' },
    { role: 'user', masked_content: 'I want to start a business.' },
  ],
  actionsNewestFirst: [{ id: 'action-1', workflow_key: 'crm.lead.create', state: 'completed' }],
};

describe('Authoritative conversation-core projection', () => {
  it('loads customer facts, pinned goals and chronological messages', () => {
    const state = buildSessionSnapshot(base);
    expect(state.conversationSummary).toBe('The customer wants a company.');
    expect(state.verifiedFacts).toEqual([expect.objectContaining({
      key: 'business_activity', value: 'Technology', source: 'customer',
    })]);
    expect(state.publishedGoalKeys).toEqual(['company_formation']);
    expect(state.recentTurns.map(t => t.role)).toEqual(['customer','assistant']);
    expect(state.revision).toBe(3);
  });

  it('does not promote completed action records into verified external outcomes', () => {
    expect(buildSessionSnapshot(base).pendingActionStatus[0]?.status).toBe('reconciliation_required');
  });

  it('rejects auxiliary conversation-state content as a fact or summary source', () => {
    const state = buildSessionSnapshot({ ...base, session: {
      ...session, conversation_state: {
        rollingSummary: 'Unverified text',
        verifiedFacts: [{ key: 'fake', value: 'model guess' }],
      },
    } });
    expect(state.conversationSummary).toBe('');
    expect(state.verifiedFacts).toEqual([]);
  });

  it('filters provisional goals to the published catalog', () => {
    const state = buildSessionSnapshot({ ...base, session: {
      ...session, conversation_state: { conversationCore: {
        provisionalGoalKeys: ['company_formation', 'invalid_goal'],
      }},
    } });
    expect(state.provisionalGoalKeys).toEqual(['company_formation']);
  });

  it('drops malformed customer-fact records', () => {
    expect(extractCoreMemory({ conversationCore: {
      verifiedFacts: [null, 'junk', { key: '', value: 'bad' }],
    }}).verifiedFacts).toEqual([]);
  });
});
