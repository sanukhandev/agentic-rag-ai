# Lead Button Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show the existing server-backed Lead confirmation button as soon as contact consent is complete, without requiring typed text for authorization.

**Architecture:** Extend the V2 controller's existing action-proposal decision so a complete, consented Lead journey creates one `awaiting_confirmation` action and returns the existing `actionProposal` response. The existing confirmation endpoint remains the only path that approves the action.

**Tech Stack:** TypeScript, Vitest, Express API, existing ActionGateway and web confirmation card.

**Spec:** `docs/superpowers/specs/2026-11-06-lead-button-confirmation-design.md`

## Global Constraints

- Node remains the sole authority for action eligibility and side effects.
- Arbitrary or ambiguous typed customer text must not authorize a Lead submission; preserve the existing explicit compatibility fallback.
- Preserve action idempotency and fail-closed provider behavior.
- Do not activate n8n or create CRM records directly.

## Review Focus

- Consent completion returns exactly one pending action and a button.
- Repeated/package knowledge turns reuse the pending action instead of creating duplicates.
- The button still uses the existing confirmation endpoint and action gateway.
- Missing contact details or consent cannot create a proposal.
- Provider webhook failures remain `reconcile_required`, never a false CRM success.

### Task 1: V2 controller regression coverage

**Files:**
- Modify: `services/api/src/v2-turn-controller.test.ts`
- Modify: `services/api/src/v2-turn-controller.ts`

**Interfaces:**
- Consume the existing `runGPTFirstChatTurn` and `ActionGateway` interfaces.
- Produce the existing `response.actionProposal` contract and one `awaiting_confirmation` action.

- [ ] Write a failing test proving that the consent-completion turn returns an action proposal and persists one `awaiting_confirmation` Lead action.
- [ ] Write a failing test proving a subsequent knowledge turn does not create a second pending Lead action.
- [ ] Run the targeted controller tests and confirm the new assertions fail because no proposal is emitted after consent.
- [ ] Change only the V2 action-proposal eligibility to cover the consent-complete pending Lead-confirmation state, while reusing existing action lookup/idempotency behavior.
- [ ] Run targeted tests and confirm both new tests pass.

### Task 2: Verification and documentation

**Files:**
- Modify: `docs/current-state.md`

- [ ] Run the full API test suite, typecheck, build, and changed-file lint.
- [ ] Rebuild the API/web Docker images and verify `/api/v1/health/ready`.
- [ ] Record the result and the remaining n8n webhook limitation in `docs/current-state.md`.
- [ ] Run `git diff --check` and inspect the final diff; do not commit or push unless separately requested.
