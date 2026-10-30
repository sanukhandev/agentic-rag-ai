# Conversation Engine v2 — canonical component architecture

**Status: APPROVED DESIGN CANDIDATE / NOT IMPLEMENTED.** This document is the single architectural reference for the proposed Python-driven, tenant-configurable Agentic RAG conversation engine. Do not treat existing FastAPI scaffolding as delivery of the engine. See [contracts](conversation-engine-contracts.md), [delivery plan](conversation-engine-delivery-plan.md) and [evaluation](conversation-engine-evaluation.md).

## Customer outcome and invariant

A customer interacts with **one named, published tenant AI persona** that understands their conversation, answers factual questions from approved RAG or provider/catalog data, uses trusted tools before responding when needed, and guides them toward their **confirmed business goal**, without asking repetitive questions or prematurely creating a CRM Lead.

For the ANCFZ acceptance tenant, the business goal is **new company formation**. A visitor may ask knowledge-only questions before goal confirmation. After confirmation, fulfillment follows exactly: **1 Lead Generation → 2 Lead Qualification → 3 Account Creation → 4 Package Selection → 5 Document Upload/SF-02 → 6 Payment Details & Invoice → 7 Contract**. An external stage is complete only when its published, verifiable provider evidence is present; internal LLM narrative is never evidence.

**The customer-facing assistant is one persona, not seven separate customer agents.** The seven components below are logical responsibilities and may share processes. Do not create seven independently planning LLM workers.

## Seven components, ownership and boundaries

| # | Logical component | Owner and public/private boundary | Core responsibilities | Never responsible for |
| --- | --- | --- | --- | --- |
| 1 | **Conversation Agent / Orchestrator** | Python private service | Runs one bounded model/tool cycle for a turn; coordinates reasoning and final composition, keeps persona and instructions stable | Customer auth, raw DB writes, n8n credentials, side-effect execution |
| 2 | **Planning & Intent Engine** | Python GPT for candidate reasoning, Node deterministic policy acceptance | Recognize category/goal, interpret summary and corrections, suggest bounded evidence weights, choose next action/question, assess ambiguity | Authoritatively confirming goals, stage advancement, storing unverified facts |
| 3 | **Natural Persona Composer** | Python GPT, final *generative* step | Natural, concise, named-persona reply using approved evidence, correct language, and one relevant question if applicable | Fabricating facts or making side-effect guarantees |
| 4 | **Response Guard Engine** | Node deterministic validation + allowed verified-fact checks | Validate persona version, language, cited evidence refs, claim type, policy/consent/status truth, question contract, metadata leakage; fail closed | Claim to prove arbitrary semantic truth by citation-ID presence alone |
| 5 | **Session & Conversation Manager** | Node + PostgreSQL (Redis only acceleration) | Tenant/session/opportunity identity, pinned catalog/persona versions, User Intent Document, CAS, turn ledger, replay/idempotency and current-stage record | Letting model memory or Redis alone become system of record |
| 6 | **Trusted Tool Gateway** | Node, private authenticated endpoints | Read-only RAG, published catalog/persona, requirements, journey, package/pricing and provider status; structured sourced results, scoped call-ID correlation | Executing arbitrary model-provided URLs, shell commands, direct financial/CRM writes |
| 7 | **Workflow & Event Engine** | Node Action Gateway + PostgreSQL outbox → Redis Streams → n8n + provider callbacks | Consent/confirmation, stable idempotency keys, async work, retries/reconciliation, terminal verified evidence and stage transitions | Letting GPT or a webhook HTTP 200 advance stages |

**Four layers, not four competing decision makers:** Python decides conversation direction; tenant-published catalog defines business capabilities; Node deterministically validates/executes; providers and persisted state establish facts. The Persona Composer's final prose may be revised/blocked by the Node guard; that does not delegate creative conversation planning back to Node.

## Turn lifecycle (authoritative sequence)

```mermaid
sequenceDiagram
    participant U as Customer
    participant N as Node API / Session Manager
    participant DB as PostgreSQL
    participant PY as Python Conversation Agent
    participant GPT as GPT deployment
    participant TOOL as Node Trusted Tool Gateway
    participant G as Node Response Guard
    participant E as Redis / n8n / Provider
    U->>N: message with clientMessageId
    N->>DB: authorize tenant/session; dedupe; read pinned catalog+persona+intent
    alt identical message already committed
        DB-->>N: previously accepted response
        N-->>U: identical response, zero model/action calls
    else new turn
        N->>PY: authenticated scoped TurnEnvelope + persona + verified summary
        PY->>GPT: plan business goal, turn intent and missing context
        opt additional knowledge/requirements/status needed
            GPT-->>PY: approved function call(s)
            PY->>TOOL: typed call(s), correlated and budgeted
            TOOL-->>PY: authorized evidence + source/version refs
            PY->>GPT: matched function result(s)
        end
        GPT-->>PY: structured plan and evidence references
        PY->>GPT: final persona composition on validated context
        GPT-->>PY: candidate answer, citations, next question
        PY-->>N: structured proposal + candidate answer (not customer-facing yet)
        N->>G: policy, persona, citations, claims, question, stage checks
        alt accepted
            G-->>N: accepted reply and decision
            N->>DB: atomic accepted assessment, response and session revision
            N-->>U: one natural named-persona reply
        else invalid or timeout
            G-->>N: typed failure reason
            N->>DB: record failed assessment without mutating verified facts/stage
            N-->>U: approved tenant-persona fallback / safe transport error
        end
        opt customer later confirms an eligible catalog action
            N->>DB: action+outbox transaction with consent, CAS and idempotency
            DB-->>E: outbox relay -> Redis -> n8n
            E-->>N: authenticated correlated callback
            N->>DB: reconcile provider result and advance eligible stage only
        end
    end
```

**Important:** avoid two parallel sources of action truth. The model can return an *action proposal* and the public reply may ask for confirmation; only a subsequent correctly bound customer confirmation starts the authorized action through Node. A pending action may be discussed, never reported as completed until independently verified.

## Pre-journey discovery and multi-turn interruption

- **Discovery** is not a business stage: answer knowledge-only RAG questions with optional help, no mandatory name/email/phone.
- **Goal candidate** is not confirmed: if two goals are plausible, ask one disambiguation question; do not mutate CRM.
- **Goal confirmation** is distinct from action-specific consent and customer confirmation for every write.
- **Confirmed journey** progresses through exactly the published stages. A visa pricing question at Document Upload is handled as a supporting knowledge turn, and pending document requirement remains in state.
- **Corrections** override earlier facts only through provenance-checked state revisions and invalidate stale proposals/quotes/documents where appropriate. A generic "yes" does not confirm an arbitrary action.
- **User declines/pauses/stops**: respect navigation and privacy, do not force a next question or CRM submission.
- **One relevant follow-up** is the default for an active cooperative journey, not a requirement to question customers during errors, farewells or opt-outs.

## Grounding and response guarantees

RAG is a source-backed *information tool*, not a ritual mandatory citation on every greeting. Claims about prices, activities, visa eligibility, legal policies, payment, and documents require allowed evidence, versioning and citations or structured provider proof. Verified session facts can be paraphrased without RAG citation. Intent clarification and consent prompts do not need fake citations.

The Node Response Guard **can deterministically validate citation membership, ACL, source freshness, allowed numeric/structured claims, persona/language, status and response schema**. It **cannot mathematically guarantee that arbitrary prose is entailed by a source**. For higher-risk claims use claim-level evidence mapping and approved factual rendering; escalate or abstain when evidence is weak. Do not conflate "has citations" with "fully grounded".

## Python deployment and agent limits

Use the private FastAPI model service (Azure OpenAI GPT model deployment + API key). Python calls **only** a private Node tool API using service authentication and bound opaque session context. No arbitrary Python/code execution tool: "ChatGPT-like capability" here means model-managed reasoning with bounded function calling, not exposing a general code interpreter to untrusted customers.

- Preload verified essential context once per turn; request tools only for gaps.
- Cap per-turn model requests, tool rounds, token budget, request concurrency, time and costs. Apply initial call + **up to three retries per transient model request**, but enforce a smaller shared *turn* deadline and total attempt budget so planning + composition cannot multiply retries without limit.
- Python never gets Salesforce OAuth tokens, n8n credentials, payment secrets, OTPs or customer identity documents. Node tool outputs are redacted, schema-validated and scoped.
- Use an approved persona-versioned **offline fallback** for model/tool outage; the last *generative* step is Persona Composer during healthy operation, but deterministic fallback legitimately bypasses the unavailable model and still passes the Node guard.
- Historical migrations, current CRM state, public API compatibility, Admin and web apps stay intact until replacements are independently proven.

## Canonical decisions / non-goals

**Freeze for implementation:** one logical Python agent, seven internal components, published tenant-specific persona, strict Node trust boundary, durable PostgreSQL state, Redis event processing, catalog-driven 7-stage fulfillment and verified provider evidence. Do not invent new LLM agents for each business stage or hardcode ANCFZ tenant values in shared code.

**Not a design goal:** exposing private LLM chain-of-thought, guaranteeing a model never makes mistakes, making every sentence cite RAG, forcing every user into Lead capture, using arbitrary Python tool execution, treating n8n success as Salesforce success or auto-merging scaffolding to production.

## Companion specifications

- [Interfaces and state machine](conversation-engine-contracts.md)
- [Tenant persona contract](persona-response-contract.md)
- [Tool loop and allowlist](agent-tool-loop.md)
- [Catalog and intent scoring](intent-engine.md)
- [Durable User Intent Document](user-intent-document.md)
- [Seven-stage provider journey](journey.md)
- [Delivery gates and rollback](conversation-engine-delivery-plan.md)
- [Test scenario matrix](conversation-engine-evaluation.md)
