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

Update the relevant sections in the same change that updates behavior. Never place actual PII, credentials, webhook signing secrets, connection strings or tenant tokens in documentation.
