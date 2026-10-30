# Tenant persona response contract — mandatory customer-facing boundary

**Status: TARGET ARCHITECTURE, NOT IMPLEMENTED.** This contract applies to every customer-visible message, including questions, RAG answers, verification prompts, queued/pending actions, errors, opt-outs, interruptions and completion. It must never be disabled to make a QA run pass. ANCFZ's acceptance persona is **Zara** only when Zara is the tenant's *published, selected persona version*; other tenants use their own approved names and identities.

**Component alignment:** Persona Composer is logical **component 3** inside one Python Conversation Agent; Node Response Guard is **component 4**, a separate deterministic policy gate. The Session Manager (component 5) pins the persona version; Node's read-only tool gateway (component 6) provides approved context. See [canonical architecture](conversation-engine-architecture.md), [interfaces](conversation-engine-contracts.md) and [evaluation scenarios](conversation-engine-evaluation.md).

The Node guard can enforce provenance/citation membership, verified structured claims and many policy invariants; **citation presence is not a proof that arbitrary generated prose is accurate**. High-impact business claims require claim-level evidence or safe approved factual templates. If uncertain, the assistant abstains in persona voice rather than fabricating.

## Goal

Customers talk naturally with a consistent **named tenant assistant**, not with a classifier or workflow engine. The assistant understands the prior conversation, acknowledges known details, answers grounded questions as a helpful advisor, and chooses one useful next question. A natural conversational style does not imply human identity, private feelings, inaccessible reasoning or knowledge of facts/actions that have not been verified.

**Final customer-visible reply = tenant persona voice + approved facts + current customer intent + one catalog-relevant next question when appropriate + truthful action state.**

## Non-negotiable boundaries

- Node resolves the authenticated tenant, active session and **published personaVersionId**; it pins the effective version to the session or explicitly version-migrates at a controlled boundary. The model cannot choose a different persona from customer text, tools or RAG.
- Python agent receives a compact, authorized **persona envelope before planning**, not only after composition: assistant display name, role as an AI assistant, greeting/introduction style, tone, personality traits, communication style, permitted languages, verbosity, examples of approved phrases, disallowed claims, and escalation/fallback policy. Avoid placing raw secrets or privileged tenant configuration in the model context.
- Python retains the persona through **planning, all model/tool continuation rounds, and final response composition**. The **last customer-facing generation step** is the Persona Response Composer; no raw planner JSON, tool payload, RAG excerpt, confidence score, catalog key, Node exception, n8n/Salesforce result or provider status value is forwarded as customer prose.
- Node runs a deterministic **Response Guard** after composition: verify persona/tenant/version, evidence citations and factual support, response/consent/stage accuracy, one relevant question (or an explicitly documented exception), prohibited metadata leakage, bounded length, language, and suitability to the active intent. Reject/regenerate or return an approved persona-specific template; do not silently emit an unsafe raw result.
- The assistant must not claim to be a human employee, conceal being an AI if asked, invent personal memories/feelings, or claim that a CRM Lead, account, payment, uploaded document, contract or signature is complete without authoritative evidence. Natural phrasing is encouraged; fabricated personal thoughts or provider outcomes are not.
- For **knowledge-only visits**, provide a grounded answer and helpful optional continuation; never force CRM Lead creation. For **confirmed new-company-formation journeys**, maintain the confirmed business goal and ask the one highest-value pending catalog requirement. Do not repeat answered facts or extract unnecessary personal information.
- If knowledge is missing: politely explain that a specific detail cannot be verified; keep the context and offer a meaningful next step. **Do not** automatically redirect to collecting contact information or misleadingly promise an adviser response.
- If the model or RAG is unavailable: Node returns an **approved tenant-persona fallback** from a versioned, deterministic template, accurately reflecting the known state and without fabricated citations/actions. Do not recursively invoke an unavailable model to render the fallback. Fallback is the only allowed bypass of model generation and is still guarded and logged.

## Proposed persona envelope (internal-only, illustrative)

```json
{
  "tenantScopeRef": "server-authorized-scope",
  "personaVersionId": "published-version-id",
  "assistantName": "Zara",
  "assistantRole": "AI company formation advisor",
  "identityDisclosure": "AI assistant",
  "tone": ["warm", "engaging", "clear", "confident", "professional"],
  "speakingStyle": "natural, concise, empathetic, context-aware",
  "permittedLanguages": ["en"],
  "preferredGreeting": "brief greeting on first contact only",
  "responseRules": {
    "maxPrimaryQuestions": 1,
    "repeatKnownFacts": false,
    "exposeInternalMetadata": false,
    "inventFactsOrProviderCompletion": false,
    "customerVisibleToolOutput": false
  },
  "fallbackTemplateVersion": "published-template-version"
}
```

This is a **proposed** contract, not a claim that these exact keys exist in the current Admin persona schema. The example persona name is tenant data, **never hardcode Zara in shared Node/Python runtime**. Use the tenant's published persona and customer-specific session version.

## Customer response pipeline

```mermaid
sequenceDiagram
  participant C as Customer
  participant N as Node authorized API
  participant P as Python Conversation Agent
  participant T as Node tools / RAG
  participant M as GPT model
  C->>N: message
  N->>P: persona envelope + authorized catalog + intent document + turn
  P->>M: interpret goal and plan using persona
  opt More trusted facts needed
    M-->>P: tool request
    P->>N: approved typed tool request
    N->>T: verify scope and execute
    T-->>N: sanitized typed result + evidence refs
    N-->>P: tool result correlated to call ID
    P->>M: continue with tool result and persona
  end
  P->>M: final persona response compose with grounded context
  M-->>P: answer + citations + next question + structured decision
  P->>N: candidate response and decision; NO direct customer delivery
  N->>N: validate citations, persona, language, state, one question and action truth
  N-->>C: natural named-persona reply
```

## Dialogue quality rules

1. Address the customer's actual question before seeking additional requirements, unless there is no safe factual answer.
2. Refer naturally to already supplied details only when helpful: e.g. **"For the three visas you mentioned..."**. Never replay the entire contact form or structured profile.
3. The assistant's identity and voice are consistent throughout the session; **do not prefix every message with "I'm Zara"**. Introduce once where appropriate; identify by name when asked.
4. Use easy-to-understand business language, not `intentKey`, `confidenceBand`, `event_outbox`, webhook path, `reconcile_required`, "Node", "LLM", tool IDs, UUIDs or payload fragments. Explain state truthfully in ordinary language.
5. One relevant, natural follow-up question if a next step is applicable. No multi-question pressure, scripted loops or generic "What would you like to focus on?" when a pending requirement is known.
6. The single question can seek clarification, required business details, customer consent, document upload or optional help after a finished goal. **User opt-out, farewell, unrecoverable error, unavailable action or closed state can legitimately have zero questions**.
7. Do not imply a document is approved merely because it was uploaded, a payment is completed because an invoice was generated, or a Lead exists because an n8n webhook returned 200.
8. When business sources conflict, do not assert either version as fact; request clarification or a verified adviser review.
9. Never expose restricted internal rationale or chain-of-thought. Store concise, auditable decision reasons separately from the customer reply.

## Concrete examples — illustrative text, not authoritative business facts

**Question:** "I want to start a company with three visas. What are my options?"

**Poor:** "intentKey=company_formation, confidence=0.92, missingSlot=business_activity."

**Expected persona-style response:** "I'd be happy to help you explore the options for your new company. I'll keep the three visas you mentioned in mind. [Explain only options backed by approved RAG or package data, with citations.] What business activity are you planning?"

**Pending external operation:** If a Lead action is *verified queued but not completed*: "I've sent your confirmed request for processing. I haven't received the final registration confirmation yet, so I'll keep this step open until we have it." Do **not** say "Your company is registered."

**Missing evidence:** "I don't have a verified answer for that specific fee yet. I can continue with the company details we already know. What business activity are you planning?" The question must actually be pending and permissible; otherwise offer a different validated next step.

**Goal complete:** "We've completed the steps that our connected systems have verified, and I can summarize your confirmed package, documents, invoice and contract status. Is there anything else I can help you with?" Never claim legal company registration if only the conversational workflow has completed.

## Fallback and service failures

- Store tenant/persona-versioned approved fallback message families for unavailable RAG, model outage/rate limit, validation failure, action pending, reconciliation, consent declined and support handoff.
- Fill templates only with already verified business facts/status, use the session's permitted language, and do not invent an unsupported next requirement.
- Unknown tenant persona, unpublished persona version or bad personalization payload must **fail closed** to an approved tenant-level AI-assistant fallback or typed transport error; must not silently substitute ANCFZ's Zara persona for another tenant.
- Public HTTP errors that occur before a valid session/tenant is established may return a safe generic transport error; once established, customer-facing chat error text follows the pinned persona and response guard.
- Preserve consent and privacy requirements in these paths. Never use unmasked identity documents or one-time passwords as examples in model prompts.

## Required acceptance suite (not yet run)

- Two tenants with distinct published names, tone and languages: no persona contamination, even with a malicious prompt or unrelated RAG document.
- One 7-stage ANCFZ session: **all** customer-visible answers, clarification prompts, action confirmations, error/retry messages and completion narration match the pinned version of Zara.
- RAG answer is conversational and cited, not a raw passage; absence of RAG produces honest uncertainty, not fabricated claims or forced Lead collection.
- Knowledge interruption and fact correction keep both business goal and persona consistent.
- Duplicate message and service restart preserve the persona version and previously approved response with no additional LLM call.
- Model failure, invalid schema, 429, private tool timeout, action pending, `reconcile_required` and consent refusal produce coherent **approved fallback** responses without internal jargon or fabricated success.
- Persona update during an active session follows version-pinning policy; future sessions use newly published persona only.
- Response guard catches raw JSON, tool payloads, unsupported facts, unauthorized promises, multiple irrelevant questions, wrong language and inconsistent identity.
- Track qualitative review with a labeled scenario matrix: voice consistency, empathy, concision, relevant follow-up, citation validity, no repetition and stage honesty.
