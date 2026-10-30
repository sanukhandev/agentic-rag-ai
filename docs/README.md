# Documentation index — current context

**Start here for the active codebase.** Root [`AGENTS.md`](../AGENTS.md) contains engineering/security instructions; [`current-requirements.md`](current-requirements.md) is the single current requirements entry point. Runtime code, published catalog data and current provider evidence govern what has actually shipped. Old plans and past test reports are not current instructions.

## Read in this order

| Document | Canonical purpose |
| --- | --- |
| [`current-requirements.md`](current-requirements.md) | Current ANCFZ seven-stage contract, tenant/persona scope, acceptance target |
| [`02-system-architecture.md`](02-system-architecture.md) | Deployed logical boundaries, Foundry function loop, n8n workflow and provider evidence |
| [`06-security-and-privacy.md`](06-security-and-privacy.md) | Trust, PII, source permissions, callback and provider security |
| [`08-model-policy.md`](08-model-policy.md) | Foundry grounding, persona, version selection, application-managed tools |
| [`20-intent-catalog.md`](20-intent-catalog.md) | Published catalog/version rules, resolution, requirements and workflow binding |
| [`21-generic-journey-orchestration.md`](21-generic-journey-orchestration.md) | Opportunity-scoped durable journey reducer |
| [`architecture/ANCFZ_DEDICATED_ARCHITECTURE.md`](architecture/ANCFZ_DEDICATED_ARCHITECTURE.md) | ANCFZ deployment and stage ownership |
| [`foundry-local-development.md`](foundry-local-development.md) | Docker/Azure CLI, v4 stable and isolated v6 candidate |
| [`10-developer-setup.md`](10-developer-setup.md) | Workspace, ingestion, Docker and infrastructure operations |
| [`acceptance.md`](acceptance.md) | One continuous seven-stage journey, function-call and provider-proof release criteria |

## Supporting maintained references

- [`04-ingestion-and-rag.md`](04-ingestion-and-rag.md) — source ingestion, approval and pgvector.
- [`05-api-contracts.md`](05-api-contracts.md) and [`openapi.yaml`](openapi.yaml) — API contracts; compare against actual implemented schemas.
- [`07-n8n-orchestration.md`](07-n8n-orchestration.md) — current transactional outbox/Redis/event-worker execution, callback behavior, and separately identified legacy polling compatibility.
- [`11-quality-and-operations.md`](11-quality-and-operations.md) — redacted telemetry and operational practices.
- [`19-data-model.md`](19-data-model.md) — current Foundry conversation bindings, opportunity facts, action/outbox and seven-stage lifecycle schema map (migrations remain authoritative).
- [`21-omnichannel-connector-api-spec.md`](21-omnichannel-connector-api-spec.md) — additional channel integration.
- [`security/ANCFZ_BOUNDARY_DECISIONS.md`](security/ANCFZ_BOUNDARY_DECISIONS.md) — specific ANCFZ security invariants.

## Verification: dated evidence, not requirements

- [`verification/ancfz-single-journey-tool-calling.md`](verification/ancfz-single-journey-tool-calling.md) — **latest focused** v6 candidate tool-cycle and blocked journey record.
- [`verification/ancfz-stage-verification-matrix.md`](verification/ancfz-stage-verification-matrix.md) — per-stage verified / blocked distinction.
- Other files under `verification/` are historical baselines or distinct runs; read their dates/branch/provider scopes before relying on them.
- Machine-readable local results are under `artifacts/` and may include local-only/uncommitted files.

## Status as of 2026-10-30

- `agentic-rag-core-dev` v4 is the stable serving agent with **no hosted OpenAPI tool**; v6 is an explicitly invoked candidate with five Node-executed read-only functions. Do not promote or activate unreviewed tools implicitly.
- v6 live function calling and existing Chat API compatibility were exercised. The latest single-journey verification is **not** seven-stage acceptance: Salesforce Lead lacked verified remote acknowledgment, so the first stage remained blocked in reconciliation.
- **Current acceptance is one real customer session / opportunity covering seven ordered stages.** The old 25-turn/200-message and artificial commit-count requirements are superseded; targeted security/integration tests remain required.
- No document can authorize production billing/signing or claim remote CRM success without verified provider evidence.

Historical MVP plans, obsolete Codex master prompts, redundant data-model drafts and dated delivery status files have been retired from the active documentation tree. Do not re-add them as source-of-truth.
