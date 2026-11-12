# 02 — System architecture

**Status: target component boundaries. Existing integrations must be verified before cutover.**

## High-level data flow

~~~mermaid
flowchart TD
  C["Customer / channel"] --> N["Node Express API"]
  N --> AUTH["Tenant identity, session, policy"]
  N --> PG[("PostgreSQL: durable state")]
  N --> GW["Private Python FastAPI model gateway"]
  GW --> LG["Bounded LangGraph turn loop"]
  LG <--> MODEL["Azure GPT-5.4 / optional OpenAI"]
  LG --> TOOL["Signed Node read-tool gateway"]
  TOOL --> RAG["Authorized tenant RAG / pgvector"]
  TOOL --> CAT["Persona, catalog, facts, provider status"]
  GW --> N
  N --> CHECK["Scoped evidence and action checks"]
  CHECK --> C
  CHECK --> GATE["Authorized action gate"]
  GATE --> OUT[("Transactional PostgreSQL outbox")]
  OUT --> REDIS["Redis Streams / workers"]
  REDIS --> WF["Private n8n workflows"]
  WF --> EXT["External service / CRM / finance"]
  EXT --> VERIFY["Authenticated evidence reconciliation"]
  VERIFY --> PG
~~~

All customer-facing model requests pass through Node. Python and LangGraph are internal. A customer never selects an arbitrary tool URL, tenant scope, workflow identifier or model system instruction.

## Ownership matrix
| Concern | Authoritative owner | Constraint |
| --- | --- | --- |
| Customer message and dialogue strategy | GPT via Python gateway | No privileged writes or invented facts |
| Identity, tenant, permissions, session | Node | Do not trust browser/model assertions |
| Read-tool registry and execution | Node | Static reviewed capability classes + per-tenant allowlists |
| Model-call sequencing | Python LangGraph | Bounded per turn, ephemeral in-process state |
| Persona and catalog source | Published tenant configuration in PostgreSQL | Session pins immutable revisions |
| Memory and verified customer facts | PostgreSQL managed by Node | Model may propose updates, never directly commit them |
| RAG documents and vectors | Existing tenant-controlled knowledge store | Preserve current sources and embeddings |
| Claim and citation validation | Node | Claim-oriented, not lexical phrasing tests |
| Side-effect policy and transaction | Node | Consent, prerequisites, replay protection, outbox |
| Execution | n8n / external providers | Success requires independent provider evidence |
| Event cache/transport | Redis | Not source of truth |

## One authoritative turn
1. Node authenticates or creates a correctly scoped anonymous session; checks message idempotency and rate limits.
2. Node reads the pinned persona/catalog, verified facts, compact summary, recent turn history and outstanding action status from durable state.
3. Node sends a minimal scoped envelope to the private Python gateway. Internal service authentication binds request and tenant scope.
4. LangGraph invokes GPT, optionally requests bounded, permitted Node read tools, then emits one structured candidate answer and proposals.
5. Node verifies referenced evidence, fact provenance, action eligibility and response safety. The model's natural response is retained whenever valid.
6. Node transactionally persists turn result, validated fact changes, updated summary/workflow proposal and audit record. Return the response to the customer.
7. If an action was separately authorized, Node commits it with an idempotency key to the outbox. Workers run it; independently authenticated provider evidence updates the authoritative business state.

## Fault behavior
- No authorized evidence for a consequential business claim: ask for clarification, indicate the gap or abstain. Do not fabricate an excerpt.
- Model unavailable: provide a short tenant-approved availability response, avoid side effects, log an incident-safe trace.
- Read tool timeout: preserve partial authorized evidence, apply bounded retry/backoff and state the limitation.
- Duplicate customer message/action: return its persisted outcome; do not dispatch it again.
- Provider acknowledged but not verified: remain pending or reconciliation-required, never mark success.
- Lost Redis message: replay from the durable outbox; never infer workflow completion from Redis delivery.
- Interrupted conversation: restore from Node/PostgreSQL. In-process LangGraph state is not the durable memory store.

## Deployment
Reuse the current Next.js customer UI, Angular Admin, Node/Express API, Python/FastAPI gateway, ingestion/OCR services, PostgreSQL/pgvector, Redis, n8n and reverse proxy where viable. Changing framework or database technology is not a prerequisite for conversational quality. Confirm production TLS, private network boundaries and current Compose configuration before release.
