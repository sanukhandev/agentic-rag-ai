# Security and Replay Report

## Completed

- V2 runtime safety check: PASS.
- V2 retirement safety check: PASS.
- Secret test suite: PASS (2/2).
- Tenant-scoped source validation, tool authorization, action consent and provider evidence unit suites: PASS.
- Public five-turn recovery created no action and no provider claim.

## Not run

Full prompt-injection corpus, cross-tenant live probes, duplicate external-operation replay, document security and Salesforce callback replay acceptance remain NOT RUN. The tested Docker service restart/replay boundary is now recorded below.

## Current security gate

The latest `npm audit --omit=dev --audit-level=high` run inside `verify:local` found **0 vulnerabilities**. Earlier one-high-advisory text in this report was historical and is superseded; no audit suppression or unsafe override is retained.

## Catalog identity boundary

Migration 059 adds only a tenant-scoped foreign key and mutual-exclusion check for canonical V2 package references. It does not repin existing offerings, enable synthetic price data, or bypass approval status/effective-date checks. Direct PostgreSQL verification returned both constraints; the full cross-tenant live replay remains NOT RUN.
## Masked contact boundary

The public contact smoke persisted only session-scoped tokens (`[NAME_n]`, `[EMAIL_n]`) in the intent ledger and journey slots. Generic contact consent advanced the catalog requirement but did not authorize a Salesforce action; the published V2 side-effect binding remains disabled. Raw contact values were not added to diagnostics.

## Docker API restart and duplicate replay — 2026-11-04

Artifact: `artifacts/ancfz/restart-replay-20261104.json`.

A fresh public ANCFZ session sent `hello` with one client message ID. The duplicate request before restart returned the same assistant message ID. The API container was restarted and reached its health endpoint. The session then returned two durable messages with one durable user message, and replaying the same client message ID returned the original assistant message ID again. No provider action was involved. Result: **PASS** for session persistence and duplicate-message idempotency at the deployed API boundary.

This does not prove worker/Redis replay, duplicate Salesforce writes, document callback replay or provider reconciliation; those remain unverified.

## Docker service restart and public history replay — 2026-11-05

- Restarted `api`, `model-gateway`, and `event-worker` during a fresh public ANCFZ session.
- Replayed the same `clientMessageId`; the API returned the identical assistant message ID and answer.
- PostgreSQL retained exactly one user row and one assistant row for that client message.
- A raw HTTP history request returned HTTP 200 with the expected user and assistant messages.
- Result: **PASS** for the tested service restart, durable session state and duplicate-message boundary. Redis/outbox replay, duplicate external writes, document callback replay and provider reconciliation remain unverified.
