# 05 — Protected RAG knowledge and grounding

**Status: target policy. Existing documents, chunks, embeddings and tenant-source mappings are protected data.**

## Non-destructive rule
The conversation rebuild must **not** modify existing ingestion sources, vector dimensions, embeddings, chunk contents, tenant ownership, published source revisions or the knowledge database. No truncate/re-seed/re-embed shortcut is permitted. Any later knowledge migration must have independent approval, backup, compatibility tests and a rollback strategy.

## Authorized retrieval
1. Node determines the tenant, principal, session and permitted knowledge scopes from trusted identity/context.
2. The model may call search_knowledge through the Node read-tool registry with a search query and bounded filters.
3. Node enforces tenant and content ACLs before retrieval and, where necessary, validates them again on returned rows.
4. Retrieval selects relevant approved chunks plus source ID, source version, access scope, document status, snippet/location and retrieval diagnostics.
5. The tool returns a small, provenance-bearing evidence set; it does not return arbitrary raw tenant documents or secrets.
6. The model uses that evidence to answer or abstain. Node validates that consequential claims are supported by matching authorized evidence.

## Evidence contract
A usable evidence reference must resolve to the same tenant, published/approved source revision, accessible document or provider record, and a supporting excerpt or structured field. Revoked, expired, foreign-tenant and unrelated sources are not valid support. Relevance scores and model confidence alone are not truth guarantees.

| Claim category | Evidence rule |
| --- | --- |
| Greeting, empathy, transition or clarification | Natural uncited text allowed |
| General service explanation specific to tenant | Authorized, relevant RAG/catalog source required |
| Price, package availability, required documents or eligibility | Current approved catalog and/or RAG evidence, with revision |
| Account/CRM, payment, document, quote or contract status | Verified provider-backed state required |
| Missing or contradictory source information | Explain the limitation, ask one focused question or abstain |

Do not enforce raw word overlap between GPT's phrasing and retrieved text. Paraphrases are permitted when the underlying claim is entailed by authorized evidence; unsupported semantic additions are not.

## Retrieval quality
- Build search queries from current question plus relevant established context, while enforcing tenant and source filters.
- Use semantic retrieval and appropriate metadata filtering; lexical retrieval or reranking can improve recall but must not become a customer-response acceptance gate.
- Detect stale pricing or conflicting source revisions. Ask for confirmation or abstain instead of silently choosing.
- Require attribution to specific source excerpts for consequential claims; a citation ID attached to an unrelated claim is not sufficient.
- Never allow retrieved text to instruct the agent to ignore permissions, reveal prompts, invoke actions or change persona.
- Include negative tests for unrelated citations, revoked sources, mixed-tenant chunks, partial excerpts, prompt injection and missing retrieval results.

## Diagnostics
Record tenant-safe query digest, retrieval/tool latency, source/version IDs, answerability, claim-check result and reason codes. Keep content excerpts, access tokens and PII out of routine logs. Evaluate factual accuracy and abstention separately from natural-conversation quality.

## Acceptance
Preserve a snapshot/checksum inventory of protected source and embedding tables before implementation. Confirm no unauthorized writes in conversation-only code paths, zero cross-tenant evidence leakage and correct abstention on unsupported business claims.

## P3 — Implemented, isolated tenant-authorized read tools

**Implementation commit:** signed, server-side scoped read tools under `services/api/src/conversation-core/adapters/`. The existing `conversation/` route is unchanged.

### Supported model-readable operations

| Tool | Input | Permission | Result |
| --- | --- | --- | --- |
| `search_knowledge` | `{ "query": "...", "resultCount": 1..5 }` | Authenticated customer session **and enabled pinned `knowledge.search` read-only catalog binding** | Redacted, bounded public RAG excerpts with immutable source-version/chunk citation IDs |
| `get_conversation_summary` | `{}` | Authenticated customer session | Redacted durable session summary |
| `get_verified_customer_facts` | `{}` | Authenticated customer session | Session-scoped verified facts; not raw PII vault values |
| `list_supported_goals` | `{}` | Authenticated customer session | Enabled business-goal keys for the session-pinned catalog |

### Trust boundary

1. P2 repository validates the customer session token and derives the authoritative tenant.
2. Registry lists reviewed executable tool definitions only.
3. Node signs a **120-second HMAC-SHA256** scope for exactly the authenticated tenant, session, token hash, pinned catalog ID, current revision and allowed tool names. Never put the signing key in Python, a browser, or a model prompt.
4. A private, independently service-authenticated adapter (P4) will call `executeBound(scope, name, input, signal)`; it must not expose this method as a public route. Scope authorization is checked again before and after a read.
5. RAG retrieval calls the existing `retrieveApprovedKnowledge` with **public audience** and the verified tenant. Every returned hit is rechecked against the current source and chunk tenant, active status, public scope and source version before exposing redacted, length-bounded source text.
6. No read tool authorizes a CRM/quote/provider write, promotes retrieved text to an instruction, or treats retrieval success as claim-level entailment.

### Limitations and rollout gates

- The P3 implementation is **not connected to Python/LangGraph or to the live chat route**. Wiring the private gateway, observed read-tool-call budgets, evidence ledger and response claim verifier is P4 work.
- Revocation is rechecked before returning the result; an atomic source-revocation/read transaction is not yet supplied by the existing Store read interface. Revalidate evidence again when accepting factual claims in P4.
- Neither `source_chunks`, `knowledge_sources`, embeddings, ingestion, catalogs nor historical customer data are modified. No SQL migration is introduced.
- P2 encrypted session-vault production integration is still pending and remains a cutover blocker.
- Run `npm run typecheck`, `npm run lint` and `npm run test:unit`, then add adversarial multi-tenant and live PostgreSQL evidence revocation/ACL tests before runtime activation.
