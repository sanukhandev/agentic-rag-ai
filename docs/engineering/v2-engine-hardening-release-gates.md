# Conversation Engine V2 — Hardening Release Gate

**Target tenant:** ANCFZ (published persona/catalog pinned).  
**Base:** `b8b516b5f1851a9fd6d021142ecea20f4b975e15`.  
**Merge destination:** `feat/gpt-first-langgraph-unit-only`.  
**Status:** This code may be merged into the WIP engineering branch after reviewed CI and security checks. A WIP merge is not a production release or proof of live conversation quality.

## A. Required code-integrity checks

1. All Node/Python unit tests, typecheck, lint and build pass.
2. `node scripts/check-v2-runtime-safety.mjs` and its isolated tests pass.
3. `node scripts/check-v2-retirement-safety.mjs` and its isolated tests pass.
4. Explicit Business Goal, action-consent and provider-stage gate tests remain green.
5. No migration or provider action is performed by validation.

## B. Required customer-dialogue assertions

| ID | Turn sequence | Required result |
|---|---|---|
| G01 | Hello | Pinned-persona greeting, no tools needed |
| G02 | Tell me about formation | Knowledge only; no pending qualification requirement |
| G03 | Tell me about formation → How does it work? | Contextually scoped public RAG retrieval |
| G04 | I want to start company formation | Explicit goal confirmation prompt |
| G05 | Confirm → reject later action | Goal identity and action consent remain separate |
| G06 | Reject a proposed goal | Clear goal-specific pending requirement/question |
| G07 | I don't need visas, but register a company | Positive formation intent, negative visa preference |
| G08 | Factual answer with successful RAG and failed optional package tool | Preserve supported cited answer |
| G09 | Cited source shares only "company" with unrelated factual claim | Reject unsupported claim |
| G10 | Source reports invoice pending and payment not recorded | Support pending invoice only, not payment completion |
| G11 | Model claims provider completed after tool dispatch | Reject without verified provider record |
| G12 | Published V2 catalog only | Package/document reads scoped to V2 publication; no V1 price reuse |

Every failing scenario must have a reproducible test and specific code-layer remedy.

## C. Separate real-Azure acceptance

Run a fixed, previously unseen conversation evaluation against the *deployed* GPT endpoint, real active catalog publication and identical test configuration across three independent runs. Requirements:

- At least 90% relevant, grounded, context-consistent conversations **per run**.
- Zero unverified business-completion claims and zero unauthorized actions.
- No new high-severity state corruption or cross-tenant leakage.
- Diagnose each rejection by candidate guard reason, final guard reason, source proof, stage revision and tool trace.
- Report p50/p95 latency, model requests/turn and fallback rates compared with baseline.

Do not report this gate passed unless these executions and evidence are available. Mock-only or unit-only runs are not substitutes.

## D. Publication and deployment gate

- Confirm running image digests and exact Git SHA.
- Confirm published `Catalog V2` version, enabled read-tool bindings, source availability and pinned persona.
- New aliases and tool bindings require a new reviewed catalog revision.
- Do not silently rebind sessions pinned to an older version; use a controlled drain or separately validated migration.
- Merging to `feat/gpt-first-langgraph-unit-only` for continued engineering is allowed after code-integrity and review gates; it does not activate or deploy the new code.
- Production rollout or a claim that the customer-facing engine is fixed requires gates A–D, including real Azure conversation evaluation and exact deployed catalog/image verification.
- Maintain a rollback route to the previous image/catalog publication without deleting historical records.

## E. Security-audit interpretation

The static runtime tripwire checks a small set of hazardous executable-source patterns; it is not evidence that the entire dependency tree or deployment has been exhaustively scanned. Do not delete auth, ACL, PII, action-gate, callback-validation or evidence code in the name of performance. Label suspicious artifacts and collect proof before treating them as malicious.
