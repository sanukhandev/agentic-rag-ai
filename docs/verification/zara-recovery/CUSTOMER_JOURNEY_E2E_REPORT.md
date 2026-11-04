# Customer Journey E2E Report

## Public five-turn regression

**Result:** PASS on a fresh authorized public API session after the recovery build.

1. `hello` → Zara greeting.
2. `Tell me about company formation` → grounded cited ANCFZ response.
3. `How does it work?` → grounded cited contextual response.
4. `I want to start company formation` → explicit confirmation prompt; pending key `anc.company_formation`; no action.
5. `No, not now` → informational acknowledgement; pending prompt cleared; no action.

## Public 25-turn conversation persistence harness

**Result:** PASS after fixing the package-tool citation boundary.

- Route: public Nginx → API → Python model gateway → PostgreSQL.
- Tenant: `anc` with synthetic conversation content.
- Turns answered: 25/25.
- Durable unique customer messages: 25.
- External CRM, document, invoice and signing outcomes: not exercised by this harness.

The first run stopped at turn 12 with PostgreSQL `22P02` because synthetic `tool-*` evidence was queried as a UUID source. That failure and its regression test are recorded as ZARA-005 in the root-cause report.

## Local ingestion acceptance

**Result:** PASS after correcting short structured-line grounding.

`npm run acceptance:local` published four synthetic file sources plus one approved HTTPS snapshot and verified a grounded public chat answer. The first attempt failed because the XLSX row was shorter than the deterministic fallback's prose-only threshold; this is recorded as ZARA-006.

`npm run acceptance:seed` also passes for synthetic tenant A/B grounding, cross-tenant refusal, contact collection and idempotent mock action confirmation. The harness was updated to reflect the current one-contact-field-at-a-time policy; no action gate was removed.

## Full company-formation journey

**Status:** NOT RUN. Lead creation, qualification, document/SF-02, package, quotation, Salesforce readback, restart/replay and browser acceptance remain unverified.

## Confirmation and verified-fact smoke

**Result:** PASS through the public Nginx/API path on a fresh synthetic session.

- `I want to open a company in Ajman.` → `anc.company_formation` pending confirmation; no action.
- `Yes, let's proceed.` → confirmation persisted; prompt cleared; no action consent inferred.
- `My business is technology consulting.` → visitor fact persisted; safe acknowledgement returned.
- `I need two visas.` → visitor fact persisted; safe acknowledgement returned.
- PostgreSQL inspection confirmed `goal_confirmed=true`, `business_goal_key=anc.company_formation`, and verified activity, visa and timeline facts on the exercised journey.

This is a partial journey gate, not full completion. The database has zero approved package offerings, and Salesforce/provider verification was not available in this run.

## Rebuilt Docker regression after Catalog V2 package identity fix

**Result:** PASS for the public conversation persistence boundary.

- API image rebuilt from the recovery branch; `/api/v1/health/live` returned 200.
- Fresh Nginx → API → model-gateway → PostgreSQL run answered 25/25 turns and persisted 25 unique customer messages.
- Session: `1c36ec5f-b09f-4ec5-a8b7-1b5fc4877d13`.
- Migration 059 was applied and its V2 package identity constraints were verified directly in PostgreSQL.
- This run did not claim Lead, Salesforce, package, quote, document, invoice or contract completion.

## Rebuilt Docker contact-collection smoke

**Result:** PASS through the public Nginx/API path for the independently verified contact boundary.

- Session: `c3853c27-0483-44a1-ae85-0bccf14bef40`.
- Formation initiation and `Yes, let's proceed.` → `goal_confirmed=true`, no action.
- Activity, visa count and timeline → verified visitor facts.
- Synthetic name and email → masked facts persisted under `lead_contact_name` and `lead_contact_channel`.
- Contact consent → `lead_crm_consent` persisted, session consent `granted`, pending requirement advanced to `lead_action_confirmation`.
- No Salesforce action was created or claimed; the published V2 `lead.create` binding remains disabled and external provider verification was not attempted.
