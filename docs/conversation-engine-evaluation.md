# Conversation Engine v2 — requirements traceability and evaluation matrix

**Status: TEST DESIGN, NOT EXECUTED.** Applies to ANCFZ and at least one contrasting tenant persona. All examples use synthetic data. Tests must exercise public Node API, private Python gateway, real or mock Node tools, PostgreSQL persistence, Redis/n8n where appropriate. A prompt-only demonstration is **not** end-to-end acceptance.

**Signed-off first-release testing:** ANCFZ uses the published **Zara English-only** persona, strict **v2-only catalog**, existing Azure GPT deployment and contract-verified **sandbox/mock** providers. The **seven-stage journey ends on verified Stage-7 contract**, with legal registration tracked separately. Per-task focused checks may run automatically; the **full seven-stage E2E is reserved for manual issue #124**, not an automatic P6/P7 test. Refer to [P0 decisions](conversation-engine-p0-signoff.md) and [issue index](conversation-v2-issue-index.md).

## Outcome metrics

Report objective pass/fail per scenario and supporting evidence, not a single uncalibrated "agent quality score".

| Dimension | Required objective evidence |
| --- | --- |
| Intent classification | Selected published Business Goal, turn category, candidate IDs and accepted signals, explicit confirmation, ambiguity handling |
| Requirement progression | Current stage, validated facts and exact next requirement key; no repeated fulfilled requirement, no later-stage blocking |
| RAG grounding | Approved source/version/ACL citation refs, structured provider evidence; unsupported fee/policy abstains |
| Persona quality | Human review of natural tone, assistant identity, no repetitive greetings, relevant acknowledgment; 100% deterministic identity/version/language rules |
| Tool behavior | Only published tool keys, correlated outputs, bounded rounds and deadline, no arbitrary URL/code/tenant override |
| Response guard | Internal-only data never appears in customer reply, no unsupported action success, one appropriate next question or exception |
| Durable state | CAS, message hash/idempotency, restart continuity, persona/catalog pin, correction and callback audit |
| Business outcome | Per-stage authoritative status/evidence, exact action consent and provider correlation; no fake success |
| Resilience | Model/Redis/RAG/provider outage, 429, duplicate webhook, late/stale callback and safe fallback |

## Traceability matrix

| ID | Customer condition / injected failure | What must happen | Required proof |
| --- | --- | --- | --- |
| INT-01 | Knowledge-only "What are the company setup options?" | Natural RAG answer, optional next question, **no Lead/CRM action** | No action/outbox entry |
| INT-02 | Customer explicitly wants a new company | Candidate goal then explicit confirmation; CRM consent separate | Goal confirmation ref; distinct action consent |
| INT-03 | Two similar goals / vague "yes" | One targeted clarification; no arbitrary action | Candidate assessment + zero writes |
| INT-04 | Visa count three, then knowledge detour | Persist three; answer cited knowledge; resume missing activity, not visa count | User Intent Document revisions |
| INT-05 | Customer corrects visa count to four | Update fact provenance, re-evaluate relevant package, invalidate stale proposal | CAS, state/caches/actions |
| CAT-01 | v2 workbook contains BusinessGoals/ToolBindings/Stage policies | Importer and Admin publish/round-trip all active metadata without discarding | Parser/version/preview tests |
| CAT-02 | Stage 5 document requirement exists | Does **not** block Stage 1 Lead | Stage-scoped rule tests |
| CAT-03 | Invalid workflow binding, orphan key, bad weight | Reject publication and no tool advertisement | Typed validation diagnostics |
| PLN-01 | Missing factual answer in current summary | Python requests scoped RAG via Node before final message | Tool call ID, evidence and response citation |
| PLN-02 | Approved packages in catalog | Python requests package data and cites approved provider/catalog version | Tool output provenance |
| PLN-03 | Model requests unlisted tool / arbitrary URL | Node refuses; no side-effect or sensitive data | Tool authorization failure |
| PLN-04 | Tool result contains persona-change instructions | Treat as untrusted content; persona unchanged | Prompt-injection test |
| PLN-05 | Tool rounds/budget exceeded | Bounded stop with accurate persona fallback | Timings, counts and typed reason |
| PER-01 | ANCFZ published Zara session | Natural Zara voice on greeting, RAG, requirements, pending, error, completion; no raw codes | PersonaVersionId and audited replies |
| PER-02 | Tenant B uses a different published persona | Never use Zara's name/voice or templates | Cross-tenant test, no bleed |
| PER-03 | Mid-session persona publication | Existing session pinned; new session uses new version | Version refs |
| PER-04 | Model output includes JSON/tool IDs/unverified fee | Guard blocks/replaces, customer never sees raw payload | Guard verdict and accepted reply |
| PER-05 | Missing evidence or model 429 | Truthful uncertainty / approved offline persona fallback, not contact capture | Zero unsupported claims |
| PER-06 | Customer opts out/farewell | Respect no-question exception | Allowed reason/no-question |
| SES-01 | Identical repeated message | Exact saved reply; zero extra GPT, tool writes or n8n actions | Idempotency replay evidence |
| SES-02 | Same clientMessageId different content | Reject conflict | 409 and unchanged state |
| SES-03 | Concurrent user turns / stale model output | State revision CAS rejects stale plan | No stale fact/stage |
| SES-04 | API/Redis restart during conversation | Intent, persona, stage and pending requirement recovered from DB | Before/after revision |
| SEC-01 | User/RAG requests wrong tenant context | Node refuses tool/data, correct persona unchanged | ACL/tenant assertions |
| SEC-02 | OTP, payment credentials or identity docs | Never enter GPT prompt, RAG, logs or User Intent Document | Sanitized fixture inspection |
| ACT-01 | Unconfirmed goal or missing consent | No CRM Lead, Account, document or invoice write | Zero outbox events |
| ACT-02 | Confirmed action, duplicate workflow event | One effective provider operation or reconciliation | Stable idempotency/correlation |
| ACT-03 | n8n 2xx but Salesforce not independently verified | Remain pending/reconcile; no stage advancement | Provider evidence tier |
| ACT-04 | Stale or forged callback | Reject or reconcile, never mutate unrelated opportunity | Correlation/signature tests |
| STG-01 | Lead creation | Verified Lead ID and notification state as applicable | Provider record evidence |
| STG-02 | Qualification | Deterministic catalog criteria; state remains scoped | Verified criteria result |
| STG-03 | OTP verified but Account write absent | Stage still pending; no false Account completion | Provider IDs absent |
| STG-04 | Eligible package chosen | Quote/version and explicit selection confirmed | Approved package/quote IDs |
| STG-05 | SF-02 upload completed transport-only | Remain pending until correct Salesforce target attachment verified | Attachment provider ref |
| STG-06 | Mock invoice/payment | Explicitly label mock; do not claim real payment | Invoice/real provider status |
| STG-07 | Draft contract link generated, not signed | Not signed/completed until signature evidence | Verified signed status |
| END-01 | One continuous approved synthetic ANCFZ session | Complete stages 1–7 in order or report exact first blocked stage | Session/opportunity ledger and provider refs |

## Required customer response quality rubric

Human reviewers sample first contact, knowledge-only, ambiguous goal, correction, qualification, consent, verification, document failure, pending workflow, contract completion and handoff. Rate each sample on a **four-point rubric** (1 unacceptable, 2 requires revision, 3 acceptable, 4 excellent) for persona consistency, clarity, relevant fact acknowledgment, factual support, helpfulness and question quality. **All deterministic safety/identity assertions must pass regardless of average quality score.** A low-scoring response is a quality issue, not evidence of fabricated provider completion.

## Acceptance scenario harness

1. **Prepare but do not automatically execute** the full realistic multi-turn seven-stage script; use a fresh synthetic customer with unique contact values when the user manually triggers final issue #124. Normal tasks may run individual isolated scenario/contract tests.
2. Exercise the actual customer-facing API and the selected Python model through Node; tool stub tests alone are insufficient.
3. Each tool call has request/result call IDs, tenant/catalog/persona versions and provenance; redact raw PII from reports.
4. Track every model request, SDK retries, tool rounds, latency and final response guard decision. Include negative-path fixtures.
5. For external stages use sandbox adapters and explicitly identify **mock**, **transport accepted**, **provider verified** or **blocked** evidence; never present mock data as production completion.
6. Verify human-reviewed persona narrative **and** strict stored workflow state separately; neither substitutes for the other.
7. Store results and date/commit/config/model identity under `docs/verification/` or `artifacts/` without secrets.

## Verdict categories

- `CONVERSATION_ENGINE_VERIFIED`: planner, Node tools, persona, grounding, guard, durable state and safety tests pass; external integrations may remain blocked.
- `SEVEN_STAGE_SIMULATED`: all stage gates pass with at least one explicitly identified local mock and verified callback/contract fixture; no mock is described as a live sandbox record.
- `SEVEN_STAGE_SANDBOX_VERIFIED`: all seven stages have independently verified records/evidence from approved sandbox providers with no local mock substitution.
- `SEVEN_STAGE_PROVIDER_VERIFIED`: the seven stages have actual approved provider verifications, including contract state; legal company registration status must be separately evidenced if claimed.
- `INTEGRATIONS_BLOCKED`: conversational flow passed but external operations needed for next stage not configured or not verified.
- `FAILED` / `PARTIAL`: report the first failed invariant, exact scenario and remedy.

Do not mark an architecture phase completed just because documentation or initial code scaffolding exists. Runtime pass requires executed and recorded tests.
