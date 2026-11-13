import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresStore } from './store-postgres.js';
import type { UserIntentDocument } from './types.js';

describe('Postgres V2 intent update NULL-safe confirmed-goal guard (isolated unit)', () => {
  it('updates a non-confirmed turn with JSON null confirmation and NULL business goal', async () => {
    const now = new Date().toISOString();
    const document: UserIntentDocument = {
      id: randomUUID(), tenantId: randomUUID(), sessionId: randomUUID(),
      opportunityId: null, catalogSource: 'published', catalogVersionRef: 'v2-catalog-version-123456',
      personaVersionId: randomUUID(), businessGoalKey: null, turnIntentKey: null,
      currentStageKey: null, stageRevision: 0, goalConfirmed: false, goalConfirmation: null,
      verifiedFacts: {}, pendingRequirementKey: null, lastQuestion: null,
      approvedResponse: { answer: 'How can I help?', grounded: false, citationRefs: [], pendingRequirementKey: null },
      toolRefs: [], sourceRefs: [], summary: 'Customer asked about formation', summaryRevision: 2,
      revision: 1, createdAt: now, updatedAt: now,
    };
    const row = {
      id: document.id, tenant_id: document.tenantId, session_id: document.sessionId,
      opportunity_id: null, catalog_source: 'published', catalog_version_ref: document.catalogVersionRef,
      persona_version_id: document.personaVersionId, business_goal_key: null, turn_intent_key: null,
      current_stage_key: null, stage_revision: 0, goal_confirmed: false, goal_confirmation: null,
      verified_facts: {}, pending_requirement_key: null, last_question: null,
      approved_response: document.approvedResponse, tool_refs: [], source_refs: [],
      summary: document.summary, summary_revision: document.summaryRevision, revision: 1,
      created_at: now, updated_at: now,
    };
    const query = vi.fn(async (_sql: string, _args: unknown[]) => ({ rows: [row], rowCount: 1 }));
    const store = new PostgresStore({ query } as unknown as Pool);
    const updated = await store.updateUserIntentDocument({ document, expectedRevision: 0 });
    expect(updated?.revision).toBe(1);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, args] = query.mock.calls[0]!;
    expect(sql).toContain('revision=$22');
    expect(sql).toContain("goal_confirmation->>'status' IS DISTINCT FROM 'confirmed'");
    expect(sql).toContain('goal_confirmation IS NOT DISTINCT FROM $23::jsonb');
    expect(sql).toContain('goal_confirmed IS NOT DISTINCT FROM $12');
    expect(sql).toContain('business_goal_key IS NOT DISTINCT FROM $8');
    expect(sql).not.toContain("goal_confirmation->>'status' <> 'confirmed'");
    expect(args[21]).toBe(0);
    expect(args[22]).toBe('null');
    expect(args[7]).toBeNull();
    expect(args[11]).toBe(false);
  });

  it('retains the strict confirmed-goal identity check in the same revision-guarded update', async () => {
    const now = new Date().toISOString();
    const document: UserIntentDocument = {
      id: randomUUID(), tenantId: randomUUID(), sessionId: randomUUID(),
      opportunityId: randomUUID(), catalogSource: 'published', catalogVersionRef: 'v2-version-ref',
      personaVersionId: randomUUID(), businessGoalKey: 'anc.company_formation',
      turnIntentKey: 'formation', currentStageKey: 'lead_generation', stageRevision: 1,
      goalConfirmed: true, goalConfirmation: {
        status: 'confirmed', promptId: randomUUID(), proposalMessageId: randomUUID(),
        goalKey: 'anc.company_formation', catalogVersionRef: 'v2-version-ref',
        personaVersionId: randomUUID(), sessionRevision: 1, intentRevision: 1,
        issuedAt: now, customerMessageId: randomUUID(), customerClientMessageId: randomUUID(), decidedAt: now,
      },
      verifiedFacts: {}, pendingRequirementKey: null, lastQuestion: null,
      approvedResponse: null, toolRefs: [], sourceRefs: [], summary: '', summaryRevision: 2,
      revision: 2, createdAt: now, updatedAt: now,
    };
    const query = vi.fn(async (_sql: string, _args: unknown[]) => ({ rows: [], rowCount: 0 }));
    const store = new PostgresStore({ query } as unknown as Pool);
    expect(await store.updateUserIntentDocument({ document, expectedRevision: 1 })).toBeNull();
    const [sql, args] = query.mock.calls[0]!;
    expect(sql).toContain('goal_confirmation IS NOT DISTINCT FROM $23::jsonb');
    expect(sql).toContain('goal_confirmed IS NOT DISTINCT FROM $12');
    expect(sql).toContain('business_goal_key IS NOT DISTINCT FROM $8');
    expect(args[21]).toBe(1);
    expect(args[11]).toBe(true);
    expect(args[7]).toBe(document.businessGoalKey);
  });
});
