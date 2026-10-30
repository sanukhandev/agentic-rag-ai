import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ActionGateway } from './actions.js';
import { type CatalogV2Document } from './catalog-v2.js';
import { MemoryStore } from './store-memory.js';
import { proposeV2CatalogAction, validateV2ActionConfirmation, validateV2ActionProposal, v2ActionConsentScope, type V2ActionGateContext } from './v2-action-gate.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')) as CatalogV2Document;
const catalog = structuredClone(fixture);
catalog.sheets.ToolBindings = catalog.sheets.ToolBindings.map((binding) => binding.toolKey === 'account.propose_creation' ? { ...binding, enabled: true } : binding);
catalog.sheets.WorkflowBindings = [...catalog.sheets.WorkflowBindings, { workflowKey: 'crm.account.create', registryKey: 'crm.account.create', providerType: 'sandbox', payloadSchemaRef: 'payload.account.v1', callbackSchemaRef: 'callback.account.v1', evidencePolicyKey: 'provider.account.verified', enabled: true }];

const baseContext = (overrides: Partial<V2ActionGateContext> = {}): V2ActionGateContext => ({
  tenantId: 'tenant-a', sessionId: 'session-a', opportunityId: 'opportunity-a', catalogVersionId: 'catalog-v2-a', currentStageKey: 'account_creation', confirmedGoalKey: 'anc.company_formation', goalConfirmed: true, verifiedRequirementKeys: ['account_confirmation'], expectedActionRevision: 1, purposeConsentScope: v2ActionConsentScope({ catalogVersionId: 'catalog-v2-a' }, 'account.propose_creation'), purposeConsentGranted: true, ...overrides,
});
const proposal = { schemaVersion: 2 as const, toolKey: 'account.propose_creation', goalKey: 'anc.company_formation', stageKey: 'account_creation', actionRevision: 1, arguments: { account_confirmation: 'confirmed' } };

describe('v2 catalog action gate', () => {
  it('accepts a scoped proposal without approving or dispatching it', async () => {
    const store = new MemoryStore();
    const gateway = new ActionGateway(store);
    const decision = await proposeV2CatalogAction(proposal, catalog, baseContext(), { gateway, store });
    expect(decision).toMatchObject({ accepted: true, status: 'created', action: { state: 'awaiting_confirmation', tenantId: 'tenant-a', sessionId: 'session-a', opportunityId: 'opportunity-a', catalogVersionId: 'catalog-v2-a', actionKey: 'account.propose_creation', actionRevision: 1 } });
    expect(await store.listActions('tenant-a')).toHaveLength(1);
    expect((await store.listActions('tenant-a'))[0]?.state).toBe('awaiting_confirmation');
  });

  it('rejects malformed, inactive, wrong-goal, incomplete and unconsented proposals', () => {
    expect(validateV2ActionProposal({ ...proposal, arguments: { unexpected: 'x' } }, catalog, baseContext()).reasons).toContain('arguments_not_catalog_scoped');
    expect(validateV2ActionProposal(proposal, fixture, baseContext()).reasons).toContain('tool_inactive');
    expect(validateV2ActionProposal({ ...proposal, goalKey: 'anc.other_goal' }, catalog, baseContext()).reasons).toContain('goal_mismatch');
    expect(validateV2ActionProposal(proposal, catalog, baseContext({ verifiedRequirementKeys: [] })).reasons).toContain('requirements_missing');
    expect(validateV2ActionProposal(proposal, catalog, baseContext({ purposeConsentGranted: false, purposeConsentScope: null })).reasons).toContain('purpose_consent_required');
    expect(validateV2ActionProposal({ ...proposal, actionRevision: 2 }, catalog, baseContext()).reasons).toContain('action_revision_stale');
  });

  it('requires the exact pending action and trusted identity for confirmation', async () => {
    const store = new MemoryStore();
    const gateway = new ActionGateway(store);
    const created = await proposeV2CatalogAction(proposal, catalog, baseContext(), { gateway, store });
    const action = created.action!;
    expect(validateV2ActionConfirmation(action, { ...baseContext(), pendingActionId: null, expectedActionKey: proposal.toolKey, customerConfirmed: true }).reasons).toContain('confirmation_not_pending');
    expect(validateV2ActionConfirmation(action, { ...baseContext({ opportunityId: 'other-opportunity' }), pendingActionId: action.id, expectedActionKey: proposal.toolKey, customerConfirmed: true }).reasons).toContain('opportunity_mismatch');
    expect(validateV2ActionConfirmation(action, { ...baseContext(), pendingActionId: action.id, expectedActionKey: proposal.toolKey, customerConfirmed: false }).reasons).toContain('customer_confirmation_required');
    const confirmed = validateV2ActionConfirmation(action, { ...baseContext(), pendingActionId: action.id, expectedActionKey: proposal.toolKey, customerConfirmed: true });
    expect(confirmed).toMatchObject({ accepted: true, status: 'confirmed', action: { state: 'awaiting_confirmation' } });
    expect((await store.listActions('tenant-a'))[0]?.state).toBe('awaiting_confirmation');
  });

  it('does not create a second action for the same scoped identity', async () => {
    const store = new MemoryStore();
    const gateway = new ActionGateway(store);
    const first = await proposeV2CatalogAction(proposal, catalog, baseContext(), { gateway, store });
    const second = await proposeV2CatalogAction(proposal, catalog, baseContext(), { gateway, store });
    expect(second.status).toBe('existing');
    expect(second.action?.id).toBe(first.action?.id);
    expect(await store.listActions('tenant-a')).toHaveLength(1);
  });

  it('requires explicit confirmation before the existing gateway can approve', async () => {
    const store = new MemoryStore();
    const gateway = new ActionGateway(store);
    const created = await proposeV2CatalogAction(proposal, catalog, baseContext(), { gateway, store });
    const action = created.action!;
    expect(action.state).toBe('awaiting_confirmation');
    expect((await gateway.confirm(action.id, 'tenant-a')).state).toBe('approved');
  });
});
