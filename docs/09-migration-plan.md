# 09 — Non-destructive implementation and rollout plan

**Status: implementation plan only. This documentation commit must change no application runtime or protected data.**

## Scope and guiding decision
Rebuild the conversation **control plane** for a generic multitenant product. Reuse stable infrastructure wherever possible. Replace complex competing dialogue rules, model envelope assembly, tool registry/adapters and the bounded LangGraph loop only after verifying the relevant current code and behavior. Avoid a wholesale rewrite of PostgreSQL, RAG ingestion, frontend, outbox and n8n.

Do not promote existing file names, schema numbers or historical designs into active product policy. Preserve compatibility until migration gates pass.

## Phase 0 — Inventory and frozen baseline
- Capture current main commit, live provider config (without secrets), public routes, existing tests, schema/tenant boundaries, source counts and protected RAG checksums.
- Map the Node conversation entrypoint, Python model gateway and LangGraph graph; identify duplicate response composition, scripted overrides and misleading guard failures.
- Map existing persona/catalog/read-tool/action/public API contracts, session state, outbox, n8n provider callbacks and UI consumption.
- Record a human-rated Azure GPT-5.4 conversation baseline with knowledge-only, implicit-intent and long-memory scenarios.
- Deliver a reviewed keep/adapt/retire table and safe database compatibility map. **No destructive migration.**

## Phase 1 — Contracts and protections
- Freeze typed TurnEnvelope, ToolDefinition, ToolResult, CandidateResponse, VerifiedFact, ConversationProjection, ActionProposal and ProviderEvidence contracts.
- Implement tenant boundary, service authentication, schema validation, audit and PII rules before relaxing conversation constraints.
- Pin tenant persona/catalog versions; define imported JSON/YAML validation/publish contracts and tenant workflow graph validation.
- Introduce independent feature flags and observability for the candidate path, preserving the running path.

## Phase 2 — Authoritative context and tool registry
- Rebuild the Node context adapter to load recent turns, durable summary, verified facts, pinned persona/catalog and live action status.
- Ensure Python actually receives and uses that summary. Persist corrections and support authenticated continuation.
- Implement a Node-owned, schema-validated and tenant-authorized read-tool registry with call IDs, deadlines, status semantics and source provenance.
- Protect existing RAG tables and embedding settings. No catalog or vector re-seeding.

## Phase 3 — Model adapter and LangGraph loop
- Define one provider-neutral model adapter: Azure GPT-5.4 primary, OpenAI selectable by configuration.
- Build a minimal bounded LangGraph flow: context -> reasoning -> optional trusted reads -> natural composition -> typed candidate output.
- Remove competing planner authority, redundant lexical gating and hardcoded customer prompts from the candidate conversation path.
- Keep a narrow Node response validator for evidence, identity, PII and external-outcome truth. Do not disable existing action gates.

## Phase 4 — Configurable intents and actions
- Implement or adapt the versioned Admin authoring/publishing APIs and JSON/YAML import/export.
- Resolve goal candidates semantically from published tenant descriptions/examples and prior context, without routine goal-confirmation prompts.
- Separate normal fact/requirement collection from authorization of actual actions.
- Adapt business actions to tenant-defined prerequisite graphs and private n8n bindings. Preserve outbox and verified provider callbacks.
- Configure the ANCFZ seven-stage journey **only as tenant data**; test with a second structurally different tenant.

## Phase 5 — Validation and controlled cutover
- Execute full deterministic test suite and the real-provider human-quality matrix in docs/08-testing-and-acceptance.md.
- Verify zero cross-tenant access, ungrounded high-impact claims, unauthorized dispatch and protected-RAG modifications.
- Run simultaneous candidate/current paths on controlled tenants as feasible, with no double-execution of external actions.
- Canary the candidate turn controller behind tenant-level feature flags; compare quality, latency, costs and provider status.
- Only retire obsolete conversation code once the new path passes acceptance and rollback tests. Remove unused logic separately from data/schema cleanup.

## Commit and PR policy
1. **Documentation rebuild PR:** readme.md, AGENTS.md and docs/** only. No runtime writes, DB migration, workflow edits or data changes.
2. **Architecture contracts PR:** isolated types, tests and compatibility adapters.
3. **Memory and read tools PR:** durable context and authorized registry, with security tests.
4. **Model and LangGraph PR:** single dialogue composer with strict tool budgets and provider configurations.
5. **Intent/workflow PR:** tenant-admin catalog and deterministic action graph integration.
6. **Validation/cutover PR:** controlled feature rollout after independent gates; retain rollback.

This sequence may be split into smaller safe changes. Do not merge stages merely because build and mock tests pass.

## Explicit preservation list
Never reset or rewrite existing PostgreSQL volumes/tables, pgvector embeddings, original RAG sources, published tenant records, migration history, user sessions, customer files, audit records, secrets, event outbox or external provider state during this makeover. Any later data transformation requires separate authorization, backup, forward-compatible migration and verified rollback.

## P6 candidate-only integration (not the final cutover)

A new canary API and independent Next.js preview transport are isolated behind three gates: `P6_CANDIDATE_ENABLED=true`, `P6_CANARY_TENANT_IDS` and build-time `NEXT_PUBLIC_P6_PREVIEW_ENABLED=true`. Startup also requires the private read gateway, P4/P5 model flags, a separate enforced P6 claim verifier and session-scoped AES-GCM vault credentials.

**Do not turn on these flags on production tenants.** The new core persists candidate turns but does not currently populate V2 `user_intent_documents` or drive seven-stage action state for fresh conversations. It must not claim to have created/updated Salesforce, generated an invoice or completed a business workflow. P7 acceptance requires an explicit consent and action-authority integration, real Azure UAT, full P6 local tests, tenant-isolation/rollback verification and a side-by-side quality/latency assessment.
