# Documentation map

These documents describe the **target system**, not a completed implementation. The canonical engineering policy is root [AGENTS.md](../AGENTS.md). Where documents and code disagree, inspect real code, record the gap, and escalate an architectural or security discrepancy rather than pretending a capability exists.

| File | Purpose |
| --- | --- |
| [01-product-scope](01-product-scope.md) | Product intent, personas, in/out of scope, MVP success |
| [02-system-architecture](02-system-architecture.md) | Trust boundaries, request and data paths, sequencing |
| [03-monorepo-conventions](03-monorepo-conventions.md) | Proposed folder layout, cross-app contracts, coding |
| [04-ingestion-and-rag](04-ingestion-and-rag.md) | Source adapters, ingestion lifecycle, pgvector retrieval |
| [05-api-contracts](05-api-contracts.md) | Draft endpoints, response shapes, validation/errors |
| [06-security-and-privacy](06-security-and-privacy.md) | Masking/tokenization, AI isolation, n8n hardening, threats |
| [07-n8n-orchestration](07-n8n-orchestration.md) | Deterministic action gateway and workflow conventions |
| [08-model-policy](08-model-policy.md) | Grounding, prompting, intent boundaries, no-invention tests |
| [09-data-model](09-data-model.md) | Conceptual schema, PII boundaries, indexing, deletion |
| [10-developer-setup](10-developer-setup.md) | Local tooling, existing Compose, env contract, deployment |
| [11-quality-and-operations](11-quality-and-operations.md) | Testing, telemetry, observability, incident handling |
| [12-delivery-roadmap](12-delivery-roadmap.md) | Phase gates and implementation acceptance |
| [13-decisions-and-open-questions](13-decisions-and-open-questions.md) | ADR-style baseline and explicit TBDs |
| [14-feature-request-template](14-feature-request-template.md) | Reusable prompt for future scoped feature work |

| [15-complete-feature-brief](15-complete-feature-brief.md) | Canonical multi-tenant admin, agent, sources and chat feature requirements |
| [16-autonomous-codex-execution-plan](16-autonomous-codex-execution-plan.md) | Implementable P00–P10 phases and gates |
| [17-acceptance-test-matrix](17-acceptance-test-matrix.md) | Required test scenarios and proof of completion |
| [openapi](openapi.yaml) | Implemented local API endpoint contract |
| [19-data-model](19-data-model.md) | Local tenant/source/chat/workflow ER model and invariants |
| [18-codex-master-prompt](18-codex-master-prompt.md) | Ready-to-copy implementation directive |
| [20-intent-catalog](20-intent-catalog.md) | Excel catalog import, publish, resolution and n8n action contract |
| [21-omnichannel-connector-api-spec](21-omnichannel-connector-api-spec.md) | Server URI, channel credentials, signed connector requests and async omnichannel usage |

**Requirements precedence:** AGENTS.md security invariants + docs/15 feature brief govern new feature requirements; docs/16–18 govern execution/acceptance. Existing numbered docs describe background architecture. Resolve contradictions by tightening isolation, not by relaxing it, and update all affected documentation.

Update the relevant sections in the same change that updates behavior. Never place actual PII, credentials, webhook signing secrets, connection strings or tenant tokens in documentation.
