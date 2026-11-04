# Customer Journey E2E Report

## Public five-turn regression

**Result:** PASS on a fresh authorized public API session after the recovery build.

1. `hello` → Zara greeting.
2. `Tell me about company formation` → grounded cited ANCFZ response.
3. `How does it work?` → grounded cited contextual response.
4. `I want to start company formation` → explicit confirmation prompt; pending key `anc.company_formation`; no action.
5. `No, not now` → informational acknowledgement; pending prompt cleared; no action.

Final post-fix replay evidence (fresh session `58ddff43-47b7-43f3-a1f5-0eb506486eec`): turns 2 and 3 returned the same grounded ANCFZ registration-time sentence with the approved citation; turns 4 and 5 persisted the pending formation goal and then cleared it on refusal. This is a PASS for the historical intent/grounding/refusal regression, but not a complete process-overview quality pass.

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

## Final Azure-backed public persistence runs after evidence-merge fix

**Result:** PASS for transport, guarded response completion and durable conversation persistence; formal quality score is not claimed.

- `artifacts/ancfz/azure-eval-final-run-1.json`: 25/25 answers, 25 durable unique user messages.
- `artifacts/ancfz/azure-eval-final-run-2.json`: 25/25 answers, 25 durable unique user messages.
- `artifacts/ancfz/azure-eval-final-run-3.json`: 25/25 answers, 25 durable unique user messages.
- The same harness reports `external_crm_invoice_document_signing: NOT_VERIFIED_BY_THIS_HARNESS` for all three runs.
- The formal >=90% natural-conversation score remains unverified because this harness records HTTP/persistence gates, not rubric judgments.

## Opt-in local simulator health

**Result:** PASS for process health only.

- The private ANCFZ PDF simulator and mock-payment simulator now remain running with local-only keys stored in the ignored development `.env`.
- This does not authorize Salesforce, create a real payment, or establish provider completion; those remain separately gated and unverified.

## Pending-goal live recovery checkpoint

- Final public artifact: `artifacts/ancfz/azure-eval-final-correction-detector.json`.
- 25/25 customer turns returned HTTP answers and 25 unique customer messages were durable.
- The customer’s timeline correction was acknowledged as `two months`; the recap retained the visa and timeline facts.
- No action proposal or provider-completion claim was emitted.
- Automated objective score: 0.90 (9/10); three generic fallback responses remained on non-action turns. Human persona review, browser E2E and the full seven-stage journey are not verified.

## Latest non-action recovery rerun — 2026-11-04

- Artifact: `artifacts/ancfz/azure-eval-after-budget-privacy-recovery-scored.json`.
- Public nginx/API/model-gateway route: **PASS** — 25/25 answers and 25 durable user messages.
- Automated objective score: **1.00 (10/10)**. Budget uncertainty and PII-masked privacy refusal now receive truthful pending-goal acknowledgements; no action proposal was emitted.
- This remains a conversation/persistence regression run, not proof of Salesforce, quotation, document, browser or seven-stage completion.

## Latest public action-gate replay — 2026-11-04

**Result:** PASS through the Lead consent boundary; provider completion NOT VERIFIED.

- Session: `30fc6300-8c6e-4e2f-951e-ff457a748a26`.
- Public Nginx/API replay reached `goal_confirmed=true`, persisted masked name/email and contact consent, and retained `lead_action_confirmation` as the pending requirement.
- `Please create my Lead` produced a customer-facing explicit-confirmation question with no action proposal.
- `I confirm the authorized submission.` produced a truthful provider-unavailable response stating that the Lead was not submitted.
- PostgreSQL showed zero `action_requests` for the session. No Salesforce write or completion claim was made.
- The published ANCFZ `lead.create` binding remains disabled; Salesforce sandbox create/readback and the complete seven-stage journey remain `BLOCKED_EXTERNAL_DEPENDENCY` / `NOT_RUN`.

## Fresh rebuilt-stack persistence run — 2026-11-05

- Artifact: `artifacts/ancfz/api-25-turns-post-dependency-scored.json`.
- Docker rebuilt `api`, `admin`, and `web` from the refreshed lockfile; the public Nginx/API/model-gateway route was healthy.
- Result: **PASS** — 25/25 HTTP answers and 25 durable unique customer messages.
- Automated objective score: **1.00 (10/10)**. No action proposal, internal payload leak, or false provider-completion claim was observed.
- Human persona review: `NOT_RUN`. Salesforce, invoice, document, contract and full seven-stage provider completion remain `NOT_VERIFIED_BY_THIS_HARNESS`.

## V2 Account callback safety regression — 2026-11-05

- The legacy internal Account remote callback was exercised against a synthetic V2 action and pending Account.
- Before the fix it returned HTTP 200 and mutated the Account to `verified` without V2 provider evidence. The regression now returns HTTP 409 `V2_PROVIDER_EVIDENCE_REQUIRED` and leaves the Account pending.
- Focused route suite: 3/3 PASS. Full API suite: 61 files / 513 tests PASS. This closes the bypass only; it is not Account provider completion.

## Deterministic V2 Account provider integration — 2026-11-05

- Synthetic path exercised: verified deterministic Lead, qualified Lead, Account action in `processing`, OTP challenge/verification, exact execution correlation, deterministic Account/Contact/Opportunity readback, action completion and lifecycle/document advancement to `package_selection`.
- Result: **PASS** — focused provider-evidence route suite 5/5; API suite 61 files / 515 tests; replay returned the existing verified result without another operation.
- Evidence boundary: **DEVELOPMENT MOCK ONLY**. Salesforce sandbox Account/Contact/Opportunity creation, provider readback and restart-durable OTP remain `BLOCKED_EXTERNAL_DEPENDENCY`/unverified.
