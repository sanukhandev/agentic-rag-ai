# Documentation — current ANCFZ-focused upgrade

**Single source of current engineering context.** All documents in this section are dated 2026-10-30 and distinguish **TARGET** from **IMPLEMENTED**. The code and migrations remain authoritative for implemented behavior.

| Read order | Document | Purpose |
| --- | --- | --- |
| 1 | [Current state and gaps](current-state.md) | Verified repository inventory, existing architecture, blockers and migration delta |
| 2 | [Current requirements](requirements.md) | Tenant-neutral conversational goal, ANCFZ seven-stage acceptance |
| 3 | [Target architecture](architecture.md) | Node / private Python GPT API / pgvector / catalog / n8n boundaries |
| 4 | [Intent engine](intent-engine.md) | Phrase/keyword candidate scoring, structured AI interpretation, user confirmation |
| 5 | [User Intent Document](user-intent-document.md) | Durable per-session/opportunity intent ledger, cache and concurrency semantics |
| 6 | [Python model gateway](model-gateway.md) | Azure OpenAI Responses API, key, strict contracts, retries/rate limits |
| 7 | [Journey orchestration](journey.md) | Exactly ordered stages, grounded response + next question, recovery |
| 8 | [Catalog to n8n](n8n-workflows.md) | Allowlisted tool proposals, action gating, outbox and provider verification |
| 9 | [Security/operations](security-operations.md) | Deferred advanced PII work, retained boundaries, deployment and telemetry |
| 10 | [Migration plan](migration-plan.md) | Additive phases, no-code-rewrite shortcuts, safe rollback |
| 11 | [Acceptance](acceptance.md) | One continuous real journey; no 25/200-message quota |

Read root [AGENTS.md](../AGENTS.md) for non-negotiable coding instructions, and root [README](../readme.md) for the entrypoint.

## Current versus target

- **Current:** Node calls a named Microsoft Foundry **Agent** using `@azure/ai-projects` and Azure CLI. It has existing deterministic intent ranking, catalog continuity, read-only v6 candidate functions, durable Foundry conversation binding and an outbox/Redis/n8n execution path.
- **Target:** Node calls a **private Python inference API**; Python invokes a GPT **model deployment** through Azure OpenAI Responses API with API key. Node remains business orchestrator and maintains a persistent **User Intent Document** plus per-turn scoring/cache and explicit intent confirmation.
- **Not yet delivered:** Python inference service, new persisted intent ledger, full per-turn AI classification, catalog-defined end-to-end flow coverage, and provider-verified seven-stage completion.
- **Current first external blocker:** latest focused run did not verify a Salesforce Lead result, and returned `reconcile_required` at Lead Generation. No later stage was completed in that one run.

## Historical evidence (not active requirements)

Dated reports under `verification/`, the original `feature-specs/` proposal artifact, and old code migrations remain traceability only. Do not treat Foundry v4/v6 results, 25/200-message tests, obsolete Codex prompts or historical POC API assumptions as current acceptance requirements. The older active architecture/requirements Markdown files were retired from the documentation root; their content remains available in Git history.

## Model API vendor sources

- [Microsoft: Azure OpenAI Responses API](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses)
- [Microsoft: switch OpenAI and Azure OpenAI endpoints with Python](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/switching-endpoints)
- [Microsoft: Azure OpenAI quota, 429 and retry guidance](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota)
