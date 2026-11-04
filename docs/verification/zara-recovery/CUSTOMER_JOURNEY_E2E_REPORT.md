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

This is a partial journey gate, not full completion. A later checkpoint added two development-only V2 package fixtures, but Salesforce/provider verification and a complete customer-facing package/quotation journey were not available in this run.

## V2 development pricebook and lifecycle boundary

- Migration 060 was applied after this public smoke and returned two ANCFZ offerings pinned to the published canonical V2 catalog reference.
- The V2 lifecycle regression now lists the canonical offerings and creates a deterministic development quote only after a verified Account is present; the focused lifecycle suite passed 3/3 tests.
- These values are explicitly development-only and are not evidence of official ANCFZ pricing, Salesforce completion, or a full customer journey.

## Catalog-gated Lead proposal boundary

**Result:** PASS in the V2 controller regression fixture; not a live provider result.

- Confirmed goal, verified contact facts and explicit contact consent were required.
- An explicit `Please create my Lead` request with an enabled published binding produced one awaiting-confirmation proposal through Node's existing action gate.
- The test verifies purpose-specific consent, idempotent action revision handling and no direct provider dispatch.
- The development ANCFZ publication still has disabled Lead bindings, so the public environment cannot execute this path until Salesforce workflow configuration and provider evidence are available.

## V2 outbox and n8n claim boundary

**Result:** PASS in focused memory-store/bridge tests; live n8n execution not run.

- Canonical V2 catalog references now resolve only published bindings with explicit n8n workflow identity, webhook path and payload contract.
- Claims require a matching durable action execution tuple and return masked approved payload plus Node authorization flags.
- The development publication remains disabled and lacks those transport identities; Salesforce provider readback remains unavailable.

## V2 provider-evidence boundary

**Result:** PASS for deterministic mock verification; Salesforce remains blocked and fail-closed.

- The authenticated Node endpoint validates the pinned V2 action and durable execution tuple before accepting evidence.
- A deterministic mock record is accepted only when its expected idempotent reference matches; the local Lead is masked, deduplicated and linked before terminal action completion.
- A Salesforce binding without a configured Node readback adapter transitions to `reconcile_required` and does not create or claim a local Lead.
- No live Salesforce completion is claimed.

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

## Fresh public persistence rerun after V2 dispatch-boundary correction

**Result:** PASS for the public conversation persistence boundary; external business outcomes remain unverified.

- Artifact: `artifacts/ancfz/api-25-turns-v2-dispatch-bridge.json`.
- Tenant: `anc`; session: `f80f0173-d500-4ce7-a693-68be0fe52682`.
- 25/25 customer turns returned HTTP answers and 25 unique customer messages were durable in the history endpoint.
- The harness explicitly reports `external_crm_invoice_document_signing: NOT_VERIFIED_BY_THIS_HARNESS`.
- This rerun verifies the deployed conversation path only; it does not claim Salesforce, n8n, package, quotation, document, invoice or contract completion.

## Fresh public persistence rerun after provider-evidence route correction

**Result:** PASS for the rebuilt public conversation persistence boundary; external business outcomes remain unverified.

- Artifact: `artifacts/ancfz/api-25-turns-v2-provider-evidence-route.json`.
- Tenant: `anc`; session: `c67e8537-d6ee-479e-a6b7-6e7c3706e35d`.
- 25/25 customer turns returned answers, and the history endpoint confirmed 25 durable unique customer messages.
- The harness reports `external_crm_invoice_document_signing: NOT_VERIFIED_BY_THIS_HARNESS`.
- The rebuilt API container became healthy and `/api/v1/health/live` returned HTTP 200 before this run.

## Final public persistence rerun at commit `58fb319`

**Result:** PASS.

- Session: `b4c17814-8b2f-4af1-90a0-5d6ec9b6a8ee`.
- 25/25 public HTTP turns returned answers through Nginx → API → model gateway.
- History endpoint returned HTTP 200 with 25 durable unique customer messages.
- External CRM, invoice, document and signing outcomes: `NOT_VERIFIED_BY_THIS_HARNESS`.

## Post-migration public persistence rerun with V2 development pricebook

**Result:** PASS for the deployed conversation persistence boundary; external business outcomes remain unverified.

- Artifact: `artifacts/ancfz/api-25-turns-v2-pricebook.json`.
- Tenant: `anc`; session: `313cfa10-e01c-4fd5-bdce-602cf72f46b3`.
- 25/25 public HTTP turns returned answers and 25 unique customer messages were durable in the history endpoint.
- The public package route smoke separately returned two offerings pinned to the canonical V2 catalog; both were marked `development_only`.
- The harness reports `external_crm_invoice_document_signing: NOT_VERIFIED_BY_THIS_HARNESS`.
