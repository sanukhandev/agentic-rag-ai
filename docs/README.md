# Documentation — current ANCFZ-focused upgrade

**Single source of current engineering context.** All documents in this section are dated 2026-10-30 and distinguish **TARGET** from **IMPLEMENTED**. The code and migrations remain authoritative for implemented behavior.

| Read order | Document | Purpose |
| --- | --- | --- |
| 1 | [Current state and gaps](current-state.md) | Verified repository inventory, existing architecture, blockers and migration delta |
| 2 | [Current requirements](requirements.md) | Tenant-neutral conversational goal, ANCFZ seven-stage acceptance |
| 3 | [Target architecture](architecture.md) | Node / private Python GPT API / pgvector / catalog / n8n boundaries |
| 4 | [Intent taxonomy](intent-taxonomy.md) | Six categories; business outcome versus knowledge/requirements/CRM actions |
| 5 | [LLM conversation planner](conversation-planner.md) | GPT interprets full summary, weighs goals, chooses next move/question, determines satisfaction |
| 6 | [Intent engine](intent-engine.md) | Catalog-supported candidate weights, goal confirmation and per-turn decisions |
| 7 | [User Intent Document](user-intent-document.md) | Durable per-session/opportunity intent ledger, cache and concurrency semantics |
| 8 | [Python model gateway](model-gateway.md) | Azure OpenAI Responses API, key, strict contracts, retries/rate limits |
| 9 | [Journey orchestration](journey.md) | Exactly ordered stages, grounded response + next question, recovery |
| 10 | [Catalog to n8n](n8n-workflows.md) | Allowlisted tool proposals, action gating, outbox and provider verification |
| — | [Supplied remote n8n inventory](remote-n8n-integration.md) | Four real webhook paths, unverified contracts, security prerequisites and test sequence |
| 11 | [Security/operations](security-operations.md) | Deferred advanced PII work, retained boundaries, deployment and telemetry |
| 12 | [Migration plan](migration-plan.md) | Additive phases, no-code-rewrite shortcuts, safe rollback |
| 13 | [Acceptance](acceptance.md) | One continuous real journey; no 25/200-message quota |

Read root [AGENTS.md](../AGENTS.md) for non-negotiable coding instructions, and root [README](../readme.md) for the entrypoint.

## Current versus target

- **Current:** Node calls a named Microsoft Foundry **Agent** using `@azure/ai-projects` and Azure CLI. It has existing deterministic intent ranking, catalog continuity, read-only v6 candidate functions, durable Foundry conversation binding and an outbox/Redis/n8n execution path.
- **Target:** GPT through private Python model API acts as the **primary conversation planner**, maintaining a catalog-grounded **Business Goal** independently from ephemeral knowledge/requirement/status/execution turn intents. It summarizes context, weighs catalog signals within approved bounds, selects the best question/action, and offers more help after the **customer goal** is actually satisfied. Node validates decisions and executes only explicitly approved workflows.
- **Not yet delivered:** Python inference service, **goal-first intent taxonomy and GPT planner**, new persisted intent ledger, full per-turn structured decisions/adaptive weighting, catalog-defined tool coverage, and provider-verified seven-stage completion.
- **Current first external blocker:** latest focused run did not verify a Salesforce Lead result, and returned `reconcile_required` at Lead Generation. No later stage was completed in that one run.

## Historical evidence (not active requirements)

Dated reports under `verification/`, the original `feature-specs/` proposal artifact, and old code migrations remain traceability only. Do not treat Foundry v4/v6 results, 25/200-message tests, obsolete Codex prompts or historical POC API assumptions as current acceptance requirements. The older active architecture/requirements Markdown files were retired from the documentation root; their content remains available in Git history.

## Model API vendor sources

- [Microsoft: Azure OpenAI Responses API](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses)
- [Microsoft: switch OpenAI and Azure OpenAI endpoints with Python](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/switching-endpoints)
- [Microsoft: Azure OpenAI quota, 429 and retry guidance](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota)
