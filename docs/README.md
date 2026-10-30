# Documentation — current ANCFZ-focused upgrade

**Single source of current engineering context.** All documents in this section are dated 2026-10-30 and distinguish **TARGET** from **IMPLEMENTED**. The code and migrations remain authoritative for implemented behavior.

| Priority | Document | Purpose |
| --- | --- | --- |
| 1 | [Current state](current-state.md) | Source-verified implementation vs target |
| 2 | [Product requirements](requirements.md) | Tenant-neutral RAG conversation and ANCFZ goal |
| 3 | [**Canonical seven-component architecture**](conversation-engine-architecture.md) | One Python agent and deterministic Node/service responsibilities |
| 4 | [**Typed interface contracts**](conversation-engine-contracts.md) | Turn envelope, planner, tools, persona, guard, state, catalog v2 |
| 5 | [**Delivery roadmap**](conversation-engine-delivery-plan.md) | P0–P7 implementation dependencies, exit gates and rollback |
| 6 | [**Evaluation matrix**](conversation-engine-evaluation.md) | Requirements traceability, negative tests and provider acceptance |
| 7 | [Persona response contract](persona-response-contract.md) | All user-visible replies in published tenant persona |
| 8 | [Pre-response tool loop](agent-tool-loop.md) | Python function calls, private Node read tools and budgets |
| 9 | [Architecture diagram](architecture.md) | End-to-end user turn, trust boundary and event path |
| 10 | [Intent taxonomy](intent-taxonomy.md) | Durable Business Goal vs six supporting turn categories |
| 11 | [Conversation planner](conversation-planner.md) | Evidence-weighting, missing facts, next move and question |
| 12 | [Intent engine](intent-engine.md) | Catalog-supported scoring and explicit confirmation |
| 13 | [User Intent Document](user-intent-document.md) | PostgreSQL authoritative projection and turn ledger |
| 14 | [Python model runtime](model-gateway.md) | Azure model API, retries, structured plan and compose |
| 15 | [Seven-stage journey](journey.md) | ANCFZ ordered stage prerequisites and evidence |
| 16 | [n8n workflows](n8n-workflows.md) | Consent, outbox, Redis worker and provider reconciliation |
| — | [Reported remote webhooks](remote-n8n-integration.md) | Four existing test endpoints; integrations not yet verified |
| 17 | [Security/operations](security-operations.md) | Scoping, privacy, safety and observability |
| 18 | [Legacy migration plan](migration-plan.md) | Historical sequence; superseded by P0–P7 roadmap |
| 19 | [Acceptance](acceptance.md) | Continuous goal and seven stages, truthful verdicts |

Read root [AGENTS.md](../AGENTS.md) for non-negotiable coding instructions, and root [README](../readme.md) for the entrypoint.

## Current versus target

- **Current in merged `main` after PR #80:** the Node API bootstrap can select a private Python GPT model adapter; a new FastAPI model gateway and Compose overlay have been added. The old Foundry Agent source/runtime and Azure CLI Docker stage are retired on this isolated rewrite branch (historical verification remains). The **legacy `app.ts` lead-first conversation logic and deterministic catalog remain operational compatibility code**, so the new goal-first planner does not yet own the session.
- **Target:** GPT through a private Python **Conversation Agent Runtime** plans the dialogue, uses approved Node tools before responding and manages a catalog-grounded Business Goal. **Every reply is composed in the published, session-pinned tenant persona** (ANCFZ: Zara only if selected), with Node grounding/response guards and approved persona-specific offline fallbacks.
- **Not yet delivered:** a full goal-first coordinator, intent ledger, catalog-v2 validation, **Python↔Node tool loop, Persona Response Composer, Node Response Guard, offline persona fallbacks**, provider-verified seven-stage completion and live tests. The gateway/adapter are scaffolding.
- **Current first external blocker:** latest focused run did not verify a Salesforce Lead result, and returned `reconcile_required` at Lead Generation. No later stage was completed in that one run.

## Design authority and implementation boundary

The **P0–P7 [delivery roadmap](conversation-engine-delivery-plan.md)** is the primary forward-looking implementation sequence. The older [migration plan](migration-plan.md) and earlier PR documents are background only where they conflict with the new schema/agent loop. **No stage of the new engine is considered implemented merely because these requirements are written.** Existing Python FastAPI `/plan`/`normalize` and Node adapter are scaffolding; strict catalog v2 import, durable intent ledger, pre-response model/Node tool loop, persona finalizer, guard, provider adapters and seven-stage acceptance are not delivered.

Final technical details and validation requirements: [canonical architecture](conversation-engine-architecture.md), [contracts](conversation-engine-contracts.md), [evaluation matrix](conversation-engine-evaluation.md).

## Historical evidence (not active requirements)

Dated reports under `verification/`, the original `feature-specs/` proposal artifact, and old code migrations remain traceability only. Do not treat Foundry v4/v6 results, 25/200-message tests, obsolete Codex prompts or historical POC API assumptions as current acceptance requirements. The older active architecture/requirements Markdown files were retired from the documentation root; their content remains available in Git history.

## Model API vendor sources

- [Microsoft: Azure OpenAI Responses API](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses)
- [Microsoft: switch OpenAI and Azure OpenAI endpoints with Python](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/switching-endpoints)
- [Microsoft: Azure OpenAI quota, 429 and retry guidance](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota)
