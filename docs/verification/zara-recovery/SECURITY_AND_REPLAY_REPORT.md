# Security and Replay Report

## Completed

- V2 runtime safety check: PASS.
- V2 retirement safety check: PASS.
- Secret test suite: PASS (2/2).
- Tenant-scoped source validation, tool authorization, action consent and provider evidence unit suites: PASS.
- Public five-turn recovery created no action and no provider claim.

## Not run

Full prompt-injection corpus, cross-tenant live probes, Docker restart/replay, duplicate external-operation replay, document security and Salesforce callback replay acceptance remain NOT RUN.

## Current security gate

`npm audit --omit=dev` reports one high `undici` advisory from the workspace resolution path. The attempted lock-only audit remediation failed with npm’s `edgesOut` error; no unsafe override or audit suppression was retained. `verify:local` therefore remains NOT_READY at the dependency-audit gate.

## Catalog identity boundary

Migration 059 adds only a tenant-scoped foreign key and mutual-exclusion check for canonical V2 package references. It does not repin existing offerings, enable synthetic price data, or bypass approval status/effective-date checks. Direct PostgreSQL verification returned both constraints; the full cross-tenant live replay remains NOT RUN.
## Masked contact boundary

The public contact smoke persisted only session-scoped tokens (`[NAME_n]`, `[EMAIL_n]`) in the intent ledger and journey slots. Generic contact consent advanced the catalog requirement but did not authorize a Salesforce action; the published V2 side-effect binding remains disabled. Raw contact values were not added to diagnostics. Replay/restart and live Salesforce verification remain NOT RUN.
