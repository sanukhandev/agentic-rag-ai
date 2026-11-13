# 08 — Testing and release acceptance gates

**Status:** proposed tests; no Foundry Agent or plain-PostgreSQL results are claimed.

## Core test layers
| Layer | Mandatory evidence |
| --- | --- |
| Repository cleanup | One Node entrypoint and one Python Foundry agent adapter; no LangGraph/pgvector/tenant-domain imports on active path |
| Database | Fresh ordinary PostgreSQL image + migrations, integrity/unique/FK/RLS, OTP, ticket event sequencing and outbox transactional tests |
| Agent isolation | Cross-agent account, ticket, tool, knowledge source, cache, docs, n8n callback and audit denial |
| Gateway/tool contracts | Foundry agent binding, typed function arguments/results, deadlines, cancellation, per-Agent budget and repeated-call guards |
| Knowledge | Approval/dedupe, index readiness, source revoke, false citation, absent evidence, low-quality/contradictory claims |
| Intent + offerings | Natural phrases, ambiguous/multi-intent changes, generic requirements, pricing revision/quote eligibility |
| Identity + tickets | Guest greeting creates ticket, secure OTP/opt-in account, persistence after restart, explicit closure, in-flight workflow reconciliation |
| OCR | Multi-page PDF/DOCX/image extraction, malformed input, PII and source-linked field review |
| SSE | Auth on connect/reconnect, Last-Event-ID replay, ordered event sequence, Redis loss, duplicate browser subscriptions |
| n8n execution | Approve lead/quote, provider callback authentication, idempotency, unknown result, reconciliation, no false completion |
| UI | Customer ticket header, async statuses, OTP form, documents, admin Agent/Knowledge/Intents/Offerings/Workflow/Tickets |
| Operations | Compose service health, clean volumes, no pgvector extension, no deleted script references, build/test exact commit |
| Real AI | Actual Azure Foundry Agent + Foundry IQ conversations; human rubric, response quality, citation accuracy, p95 and cost |

## Core conversation scenarios
Greeting-only; FAQ answer; company formation without forced funnel; ambiguous intent; pricing and offering comparison; missing requirements; customer corrections; switching topic; email/OTP and account linking; uploaded document field extraction; approved lead through n8n; quote generation; pending/failed provider; final closure request; resumed ticket; injection and cross-agent isolation.

## Quality gates
- Zero observed cross-agent access, unauthorized actions, fabricated verified outcomes and exposed secrets in adversarial tests.
- Accepted messages and state survive Redis restart; no duplicate customer commands or double provider dispatch after retries.
- Every consequential factual claim has current attributable evidence; measure false rejection separately from hallucination.
- A provisional human-acceptance target of at least 90% of representative live Foundry turns, subject to establishing baseline and sample size; no claim this has already passed.
- Measure p50/p95/p99 model and tool latencies, per-turn cost, failure rate, source readiness/revocation latency and resource consumption.
- Real provider + browser E2E and clean deployment pass before calling the rebuilt POC integrated.

## Validation commands
Update current npm/Python/Docker scripts after deleting obsolete paths; use exact-head CI that runs TypeScript typecheck/lint/tests/build, Python gateway/OCR tests, fresh SQL migration tests, `docker compose config`, security negatives, browser E2E, and opt-in real Foundry/n8n integration. Historical P2–P7 mock runs do not qualify as new-architecture certification.
