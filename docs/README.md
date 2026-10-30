# Documentation — current ANCFZ-focused upgrade

**Single source of current engineering context.** All documents in this section are dated 2026-10-30 and distinguish **TARGET** from **IMPLEMENTED**. The code and migrations remain authoritative for implemented behavior.

| Read order | Document | Purpose |
| --- | --- | --- |
| 1 | [Current state and gaps](current-state.md) | Existing code vs target contracts |
| 2 | [Requirements](requirements.md) | ANCFZ and generic tenant behavior |
| 3 | [Tenant persona response contract](persona-response-contract.md) | **Mandatory** natural named-persona voice on all replies and offline fallbacks |
| 4 | [Python↔Node tool loop](agent-tool-loop.md) | Trusted pre-response Node tools and model continuation |
| 5 | [Target architecture](architecture.md) | Python agent, RAG/tools, Node guard and n8n boundaries |
| 6 | [Intent taxonomy](intent-taxonomy.md) | Business Goal vs supporting turn intents |
| 7 | [Conversation planner](conversation-planner.md) | LLM decides goal, tool retrieval and next question |
| 8 | [Intent engine](intent-engine.md) | Catalog-supported goal weighting and confirmation |
| 9 | [User Intent Document](user-intent-document.md) | Durable intent facts and pinned persona |
| 10 | [Python model runtime](model-gateway.md) | Azure GPT calls, persona composition, retries |
| 11 | [Journey orchestration](journey.md) | Seven stages, natural dialogue, recovery |
| 12 | [Catalog to n8n](n8n-workflows.md) | Action gating and verified provider callbacks |
| — | [Remote n8n inventory](remote-n8n-integration.md) | Supplied but unverified webhook mappings |
| 13 | [Security](security-operations.md) | Tenant isolation, prompt/tool boundaries |
| 14 | [Migration plan](migration-plan.md) | Phased build and persona release gate |
| 15 | [Acceptance](acceptance.md) | One journey and cross-tenant persona QA |

Read root [AGENTS.md](../AGENTS.md) for non-negotiable coding instructions, and root [README](../readme.md) for the entrypoint.

## Current versus target

- **Current on `refactor/python-conversation-core-v2`:** the Node API bootstrap can select a private Python GPT model adapter; a new FastAPI model gateway and Compose overlay have been added. The old Foundry Agent source/runtime and Azure CLI Docker stage are retired on this isolated rewrite branch (historical verification remains). The **legacy `app.ts` lead-first conversation logic and deterministic catalog remain operational compatibility code**, so the new goal-first planner does not yet own the session.
- **Target:** GPT through a private Python **Conversation Agent Runtime** plans the dialogue, uses approved Node tools before responding and manages a catalog-grounded Business Goal. **Every reply is composed in the published, session-pinned tenant persona** (ANCFZ: Zara only if selected), with Node grounding/response guards and approved persona-specific offline fallbacks.
- **Not yet delivered:** a full goal-first coordinator, intent ledger, catalog-v2 validation, **Python↔Node tool loop, Persona Response Composer, Node Response Guard, offline persona fallbacks**, provider-verified seven-stage completion and live tests. The gateway/adapter are scaffolding.
- **Current first external blocker:** latest focused run did not verify a Salesforce Lead result, and returned `reconcile_required` at Lead Generation. No later stage was completed in that one run.

## Historical evidence (not active requirements)

Dated reports under `verification/`, the original `feature-specs/` proposal artifact, and old code migrations remain traceability only. Do not treat Foundry v4/v6 results, 25/200-message tests, obsolete Codex prompts or historical POC API assumptions as current acceptance requirements. The older active architecture/requirements Markdown files were retired from the documentation root; their content remains available in Git history.

## Model API vendor sources

- [Microsoft: Azure OpenAI Responses API](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses)
- [Microsoft: switch OpenAI and Azure OpenAI endpoints with Python](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/switching-endpoints)
- [Microsoft: Azure OpenAI quota, 429 and retry guidance](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota)
