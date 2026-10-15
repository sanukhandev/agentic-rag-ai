# Decisions, assumptions and open questions

This log explicitly separates accepted requirements from pending architecture choices. Record decisions as ADRs before code depends on them. Do not assume a TBD is already configured.

## Confirmed product constraints (from project brief)
- Monorepo: Next.js/React/Tailwind web; Angular/Tailwind admin; Node/Express/TypeScript API; PostgreSQL; pgvector; Python venv ingestion.
- Source data may arrive in diverse file formats; Python transforms approved extractable content into vector embeddings and stores them in pgvector.
- Azure AI Foundry GPT-4.1-mini handles response generation; Node orchestrates conversation, evidence, identity and n8n actions.
- Start with web; preserve a common Node API for later sales channels.
- Multi-tenant organizations are in initial scope; platform admin provisions tenants, tenant admins manage their workspace, and source/chat/persona/analytics are strictly isolated.
- Angular admin requires authenticated login and Node API-based service/usage dashboards.
- Initial source formats are Word DOCX, Excel XLSX, TXT, text-based PDF and HTTPS link snapshots after safe validation.
- Each tenant configures the agent's name, greeting, tone/style and default/allowed languages; persona never changes permissions or facts.
- Public visitor chat sees only tenant-approved publicly publishable content, never internal tenant material.
- RAG is authoritative for factual company claims; no unsupported assumptions.
- Node masks/tokenizes customer details and is the sole authorized reversible-identity boundary.
- n8n executes approved workflow actions; Node—not the LLM—authorizes invocation.

## Baseline architecture guidance (proposed)
- One PostgreSQL instance with separate schemas/roles for application and pgvector for MVP (not mandatory).
- Model calls use sanitized content. The embedding model is separately chosen; never assume GPT-4.1-mini embeds.
- File adapters are opt-in per MIME, not a literal any-format guarantee.
- Server-side ACL filters precede retrieval and server-side checks precede any workflow.
- User-visible citations and honest "not enough information" fallback.

## Open decisions requiring explicit approval
| ID | Topic | Decision needed |
| --- | --- | --- |
| D-01 | Tenant scope | **Multi-tenant is confirmed**; decide verified public channel binding, domains, invitation flow and tenant ID resolution |
| D-02 | Auth | Anonymous web chat, customer identity, admin SSO/RBAC, channel verification |
| D-03 | Azure | Foundry resource region, endpoint/API, credential mode, exact GPT-4.1-mini deployment |
| D-04 | Embeddings | Approved embedding model/deployment, dimensions, rate limits, re-embed strategy |
| D-05 | Document storage | Blob/object store, quarantine rules, allowed source classes and max size |
| D-06 | Parsers | Minimum supported formats, OCR, spreadsheets/table fidelity, sandbox design |
| D-07 | Privacy | Specific PII classifications, lawful basis, data processing location, retention |
| D-08 | Crypto | KMS/envelope key management, rotation, vault isolation, token TTL and recipients |
| D-09 | Channels | First non-web provider; authentication and message delivery policy |
| D-10 | Workflows | First real n8n integration, write permissions, consent, replay/callback model |
| D-11 | RAG quality | Corpus approval, search strategy, citation standard, confidence/abstention metrics |
| D-12 | Runtime | Package manager, Node/Python versions, queues, migrations, CI/CD, hosting |
| D-13 | Operations | Availability/latency SLOs, backups, audit retention, incident ownership |
| D-14 | Sales | Lead capture fields, consent UI, lead scoring method, escalation policy |

## Initial risk register
- **Critical**: existing n8n Docker Compose exposes HTTP and disables secure cookies; lock down before external use.
- **High**: mask/tokenization can miss indirect identifiers; verification and data-processing review mandatory.
- **High**: LLM-proposed actions could be unsafe without server-side authorization and idempotency.
- **High**: cross-tenant retrieval/expired documents could create false-authoritative responses.
- **Medium**: variable format extraction fidelity, particularly OCR, charts and table units.
- **Medium**: embedding provider/model migration alters dimensions and recall; require versioning/re-index.

## Implementation decisions — local MVP vertical slice

These decisions are scoped to the local implementation and do not approve production rollout.

- **D-12 local implementation**: npm workspaces, Node 22, TypeScript strict mode, Vitest, and Python 3.12 in a containerized venv/test command.
- **D-04 local implementation**: deterministic 8-dimensional embeddings for tests and demo data. A separate embedding adapter boundary is required before selecting a real Azure embedding deployment or changing pgvector dimensions.
- **D-02 local implementation**: signed development JWTs with tenant memberships and roles. Replace with approved SSO/MFA before real users or customer traffic.
- **D-10 local implementation**: one `lead.capture` mock action through an injectable private workflow adapter. It accepts only a masked opaque reference, requires confirmation, is idempotent, and records an audit event.
- **D-05 local implementation**: source text is staged in the application repository boundary for deterministic tests. Production storage must move to approved private object storage with malware scanning and retention controls.

## ADR template
ID / status (proposed|accepted|superseded) / date / context / alternatives / decision / consequences / security-review owner / affected docs/tests. Only mark accepted following an explicit product/engineering decision.
