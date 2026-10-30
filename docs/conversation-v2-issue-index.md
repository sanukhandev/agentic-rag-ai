# Conversation Engine v2 — executable issue index

**Source:** merged PR #81, approved decisions in [P0 sign-off](conversation-engine-p0-signoff.md). **Implementation branch:** `feat/conversation-engine-v2`. **Master execution instructions:** [Codex v2 master prompt](codex-v2-master-prompt.md).

All 43 tasks are created as open GitHub issues, labeled `v2-feature` and `v2-p0` … `v2-p7`. Issue dependencies and acceptance criteria are recorded **inside each issue**. Work through dependency-ready tasks; do not falsely close a provider-blocked issue. Never automatically run the final seven-stage harness.

| Phase | GitHub issue | Task |
| --- | --- | --- |
| P0 | [V2-P0-01 #82](https://github.com/sanukhandev/agentic-rag-ai/issues/82) | Baseline audit and rollback |
| P0 | [V2-P0-02 #83](https://github.com/sanukhandev/agentic-rag-ai/issues/83) | Existing Azure GPT deployment readiness |
| P0 | [V2-P0-03 #84](https://github.com/sanukhandev/agentic-rag-ai/issues/84) | Strict v2-only catalog schema freeze |
| P0 | [V2-P0-04 #85](https://github.com/sanukhandev/agentic-rag-ai/issues/85) | Python/Node interface contracts |
| P0 | [V2-P0-05 #86](https://github.com/sanukhandev/agentic-rag-ai/issues/86) | ANCFZ policies and provider evidence matrix |
| P1 | [V2-P1-01 #87](https://github.com/sanukhandev/agentic-rag-ai/issues/87) | v2 parser and strict validation |
| P1 | [V2-P1-02 #88](https://github.com/sanukhandev/agentic-rag-ai/issues/88) | v2 runtime scoring and policy validator |
| P1 | [V2-P1-03 #89](https://github.com/sanukhandev/agentic-rag-ai/issues/89) | Admin import/publish/export |
| P1 | [V2-P1-04 #90](https://github.com/sanukhandev/agentic-rag-ai/issues/90) | Read-only v1 history and audited v2 migration |
| P1 | [V2-P1-05 #91](https://github.com/sanukhandev/agentic-rag-ai/issues/91) | ANCFZ reference workbook and fixtures |
| P2 | [V2-P2-01 #92](https://github.com/sanukhandev/agentic-rag-ai/issues/92) | User Intent Document projection and ledger |
| P2 | [V2-P2-02 #93](https://github.com/sanukhandev/agentic-rag-ai/issues/93) | CAS, replay and message idempotency |
| P2 | [V2-P2-03 #94](https://github.com/sanukhandev/agentic-rag-ai/issues/94) | Discovery, goal continuity and corrections |
| P2 | [V2-P2-04 #95](https://github.com/sanukhandev/agentic-rag-ai/issues/95) | Redis caches and invalidation |
| P2 | [V2-P2-05 #96](https://github.com/sanukhandev/agentic-rag-ai/issues/96) | Persona version pin and response audit |
| P3 | [V2-P3-01 #97](https://github.com/sanukhandev/agentic-rag-ai/issues/97) | Azure GPT reliability and quotas |
| P3 | [V2-P3-02 #98](https://github.com/sanukhandev/agentic-rag-ai/issues/98) | Python bounded conversation agent |
| P3 | [V2-P3-03 #99](https://github.com/sanukhandev/agentic-rag-ai/issues/99) | Node Trusted Tool Gateway |
| P3 | [V2-P3-04 #100](https://github.com/sanukhandev/agentic-rag-ai/issues/100) | Tenant-safe RAG and grounding |
| P3 | [V2-P3-05 #101](https://github.com/sanukhandev/agentic-rag-ai/issues/101) | Intent reasoning and stage planning |
| P3 | [V2-P3-06 #102](https://github.com/sanukhandev/agentic-rag-ai/issues/102) | Claim-level evidence provenance |
| P4 | [V2-P4-01 #103](https://github.com/sanukhandev/agentic-rag-ai/issues/103) | Natural Persona Composer |
| P4 | [V2-P4-02 #104](https://github.com/sanukhandev/agentic-rag-ai/issues/104) | Node Response Guard |
| P4 | [V2-P4-03 #105](https://github.com/sanukhandev/agentic-rag-ai/issues/105) | Versioned offline persona fallbacks |
| P4 | [V2-P4-04 #106](https://github.com/sanukhandev/agentic-rag-ai/issues/106) | New Node ConversationCoordinator |
| P4 | [V2-P4-05 #107](https://github.com/sanukhandev/agentic-rag-ai/issues/107) | Cross-tenant persona quality tests |
| P5 | [V2-P5-01 #108](https://github.com/sanukhandev/agentic-rag-ai/issues/108) | Action consent/proposal and confirmation |
| P5 | [V2-P5-02 #109](https://github.com/sanukhandev/agentic-rag-ai/issues/109) | Outbox/Redis/n8n idempotency |
| P5 | [V2-P5-03 #110](https://github.com/sanukhandev/agentic-rag-ai/issues/110) | Provider callbacks and reconciliation |
| P5 | [V2-P5-04 #111](https://github.com/sanukhandev/agentic-rag-ai/issues/111) | Privacy and credential hardening |
| P6 | [V2-P6-01 #112](https://github.com/sanukhandev/agentic-rag-ai/issues/112) | Salesforce Lead create/dedupe adapter |
| P6 | [V2-P6-02 #113](https://github.com/sanukhandev/agentic-rag-ai/issues/113) | Lead qualification rules |
| P6 | [V2-P6-03 #114](https://github.com/sanukhandev/agentic-rag-ai/issues/114) | OTP and Account/Contact/Opportunity adapter |
| P6 | [V2-P6-04 #115](https://github.com/sanukhandev/agentic-rag-ai/issues/115) | Package/quote provider adapter |
| P6 | [V2-P6-05 #116](https://github.com/sanukhandev/agentic-rag-ai/issues/116) | SF-02 document/OCR/attachment |
| P6 | [V2-P6-06 #117](https://github.com/sanukhandev/agentic-rag-ai/issues/117) | Invoice and mock payment |
| P6 | [V2-P6-07 #118](https://github.com/sanukhandev/agentic-rag-ai/issues/118) | Contract and mock/sandbox signature |
| P6 | [V2-P6-08 #119](https://github.com/sanukhandev/agentic-rag-ai/issues/119) | Separate legal-registration tracker |
| P7 | [V2-P7-01 #120](https://github.com/sanukhandev/agentic-rag-ai/issues/120) | Focused CI and Docker smoke |
| P7 | [V2-P7-02 #121](https://github.com/sanukhandev/agentic-rag-ai/issues/121) | Security/fault injection/budget tests |
| P7 | [V2-P7-03 #122](https://github.com/sanukhandev/agentic-rag-ai/issues/122) | Prepare manual final-test harness, no run |
| P7 | [V2-P7-04 #123](https://github.com/sanukhandev/agentic-rag-ai/issues/123) | Cutover/rollback readiness |
| P7 | [V2-P7-05 #124](https://github.com/sanukhandev/agentic-rag-ai/issues/124) | MANUAL HOLD — user-triggered final seven-stage E2E |

## Execution policy

1. Read [P0 sign-off](conversation-engine-p0-signoff.md), [v2 catalog contract](catalog-v2-contract.md), [provider inputs](ancfz-business-provider-readiness.md) and [canonical architecture](conversation-engine-architecture.md).
2. Build on `feat/conversation-engine-v2`, never commit implementation to `main`. Preserve APIs, security, existing applied migrations and customer data.
3. After each dependency-ready issue: implement → focused tests/typecheck/lint/build → evidence artifact → commit with issue ID → push → verify remote SHA → comment verification evidence → **close issue**. If blocked, leave OPEN and move to another independent ready task.
4. P0 product decisions are fixed: existing Azure GPT model; **v2-only** catalog; published English Zara; mock/sandbox-first seven stages; contract-complete journey with separate registration status.
5. Final full seven-stage acceptance issue [#124](https://github.com/sanukhandev/agentic-rag-ai/issues/124) **must stay OPEN** until the user explicitly invokes the manual run after all other tasks [#82–#123] are validated and closed. Even a fully implemented codebase is not proof of final E2E success.

## GitHub issue filters

- [All v2 features](https://github.com/sanukhandev/agentic-rag-ai/issues?q=is%3Aissue+label%3Av2-feature)
- [Open v2 features](https://github.com/sanukhandev/agentic-rag-ai/issues?q=is%3Aissue+is%3Aopen+label%3Av2-feature)
- [Manual final gate](https://github.com/sanukhandev/agentic-rag-ai/issues/124)
