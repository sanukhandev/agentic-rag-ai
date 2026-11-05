# Zara Conversation Engine Recovery Design

**Status:** execution authorized by the supplied autonomous recovery task

## Intent

Restore the existing GPT-first ANCFZ customer conversation path so that Node keeps independent authority over customer intent, evidence grounding, question contracts, state, consent, and provider actions while Python remains responsible for natural planning and persona composition.

## Goals

- Preserve the public Chat API, tenant isolation, published persona/catalog pinning, privacy controls, action gates, outbox, callbacks, and provider verification.
- Prevent a rejected optional question or factual draft from erasing a separately valid customer-goal proposal.
- Treat successful authorized read-tool evidence as eligible for claim review and bounded repair without accepting model-invented citations.
- Preserve refusal/correction continuity and explicit goal confirmation.
- Validate the customer-visible five-turn regression through the public API, then measure the remaining journey and external gates honestly.

## Non-goals

- Replacing GPT-first reasoning with a scripted or simple-RAG dialogue engine.
- Removing the response guard, tenant/catalog authorization, consent, idempotency, provider readback, or historical migrations.
- Claiming live Azure, Salesforce, Docker, or seven-stage acceptance without executing those gates.
- Rebinding existing sessions to a new catalog or persona revision.

## Constraints

- Base: `feat/gpt-first-langgraph-unit-only` at `ba1e29f9c79d2ac8214dce0fcd6f95aae7c6563f`.
- Work branch: `fix/zara-conversation-engine-end-to-end-recovery` in the single existing checkout.
- ANCFZ is the acceptance tenant; Zara is used only when the pinned published persona selects her.
- Node is the only business authority; Python cannot perform side effects.
- Consequential claims require source-bound evidence or an independently verified grounding proof.
- All tests use synthetic data; secrets and raw customer content stay out of normal audit records.

## Approaches considered

1. **Targeted boundary correction (selected).** Add independent question/answer decision data at the existing guard boundary, widen trusted evidence only to Node-correlated successful read tools, and preserve planning from the validated candidate response. This is the smallest change that addresses the observed coupling while retaining the current contracts and rollback path.
2. **Coordinator rewrite.** Replace the V2 coordinator and turn controller with a new pipeline. This would increase regression risk, duplicate existing state/action logic, and obscure which trust boundary fixed the defect.
3. **Deterministic/simple RAG fallback.** Bypass GPT/tool/guard behavior for the failing messages. This is explicitly incompatible with the GPT-first, persona-first, tenant-configurable architecture and would not prove the journey.

## Design decisions

- Optional question failures are recorded as a diagnostic reason, then the question is suppressed when the answer independently passes persona, evidence, and policy validation. Required-question identity remains strict.
- Trusted evidence is the union of exact Node prefetch evidence and evidence returned by a successful allowlisted read tool with correlated evidence references. Repair receives only that union.
- Planning is read from the model candidate independently of the final answer verdict and is still accepted only after catalog membership and customer-evidence validation. It never authorizes an action.
- Refusal is interpreted only against an existing pending goal-confirmation record; an unprompted “No, not now” is treated as navigation, not fabricated goal rejection.

## Verification boundary

The implementation must show a red regression test before each production correction, then focused tests, full workspace tests, typecheck/lint/build, Docker health/API/browser checks where available, and separate live Azure/Salesforce evidence. Any unavailable external gate remains `BLOCKED_EXTERNAL_DEPENDENCY` or `NOT_RUN`.

