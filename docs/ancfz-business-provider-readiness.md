# ANCFZ business policies and sandbox/mock provider readiness

**Status:** REQUIRED INPUT REGISTER and source for the locked P0-05 matrix; NOT PROVIDER VERIFICATION. Customer has approved P0 decisions in [P0 sign-off](conversation-engine-p0-signoff.md). Do not request those five decisions again. External dependencies must not stall independent P0–P4 engineering with approved synthetic fixtures.

## Business input by fulfillment stage

| Stage | Owner input needed (never invent) | Blocks |
| --- | --- | --- |
| Pre-stage discovery | Final company-formation goal confirmation wording; when to offer a human adviser | Public-facing production copy |
| 1 Lead Generation | Mandatory Name/Company/Phone/Email fields, purpose-specific consent, duplicate policy, Lead notification wording and provider record evidence | Real sandbox Stage 1 |
| 2 Lead Qualification | Eligible activities, exclusions, company/entity criteria, visa count, budget/timeline if truly mandatory, manual-review rules and deterministic qualified verdict | Stage 2 policy |
| 3 Account Creation | Email OTP mandatory/expiry/retries, explicit Account approval, exact Account/Contact/Opportunity fields and association to verified Lead ID | Stage 3 provider policy |
| 4 Package Selection | Approved packages, eligibility, price/tax/discount sources, quote validity and confirmation | Stage 4 business policy |
| 5 Document Upload | Required documents by package/activity, OCR/review policy, file limits, identity-document retention, Salesforce SF-02 attachment target and verified lookup | Stage 5 provider |
| 6 Payment Details & Invoice | When to generate invoice, quote linkage, invoice statuses, mock payment states and customer wording; no card details in model | Stage 6 provider |
| 7 Contract | Approved contract template/version, signatories, customer consent, sandbox/mock signature completion criteria and cancellation | Stage 7 provider |
| Separate legal registration | Authoritative government/registrar source, owner, pending/complete state and update process after contract | Later legal-registration tracking, **not** Stage 7 acceptance |

All unspecified business values are **blocked inputs**, not facts GPT may invent. Synthetic policies may drive early parser/agent tests but must be clearly labeled and never published as real customer guidance.

## Integration details needed (per operation)

For each provider/mock operation record: accountable owner; trusted `toolKey`/workflow registry key; sandbox or mock environment; enabled status; auth/secret reference; request/response JSON or multipart schema; idempotency/correlation key; callback signature and expected record IDs; independent status lookup; verified completion evidence; failure/reconciliation retry policy; retention/privacy; synthetic test fixture.

| Integration | Known status | Needed by |
| --- | --- | --- |
| Existing Azure GPT model | Approved to **reuse**, but exact resource/deployment/schema/tool capability and quota not verified | P0/P3 |
| Published ANCFZ Zara | Approved persona, **English only**, but actual published Admin personaVersionId and fallback rules not verified | P0/P4 |
| Salesforce Lead creation | Previously supplied n8n test webhook; prior run had `reconcile_required`, no verified Salesforce Lead result | Stage 1 |
| Account OTP send and verify | Reported n8n `/webhook-test/` routes; auth, expiry, request/response and callback require inspection | Stage 3 |
| Salesforce Account/Contact/Opportunity linking | **Operation not supplied/verified**; OTP does not create an Account | Stage 3 |
| Packages/quotation | Catalog/quote foundations exist; approved provider pricing/quote state not verified | Stage 4 |
| SF-02 document upload | Reported test webhook; exact Salesforce record association and OCR/review completion not verified | Stage 5 |
| Invoice / payment | PDF and mock payment foundations exist; invoice status/contract and real paid state are distinct | Stage 6 |
| Contract / signing | Missing/unverified signature provider callback, template and proof | Stage 7 |
| Registration | Separate post-contract status; government proof not part of Stage-7 gate | After journey |

Known reported n8n test routes are `/n8n/webhook-test/salesforce-lead`, `/n8n/webhook-test/send-account-verification`, `/n8n/webhook-test/verify-account-otp`, `/n8n/webhook-test/salesforce-document-upload`. These are **test listeners**, not activated production endpoints. Do not embed credentials or API keys in GitHub issues, model prompts or catalog XLSX. Rotate previously shared credentials before active integration.

## First-release sandbox/mock evidence contract

Every one of seven stage actions must have deterministic provider mock or actual sandbox adapter with persistent evidence and callback-correlation tests. **No hardcoded `success:true` just to satisfy QA**. A mock signature is not a legal signature; `HTTP 200`, n8n execution success and generated PDFs are not provider verification. Any stage completed with local mock means aggregate release report **SEVEN_STAGE_SIMULATED** and names those stages; independently verified sandbox providers across all seven may be **SEVEN_STAGE_SANDBOX_VERIFIED**. Legal company registration remains separately pending until authoritative registration evidence is available.

## Owner-dependent unblock order

1. **P0 and P1–P4 development may start:** engineering defines typed schemas and safe synthetic fixtures, config-probe procedure, model/Node tool loop and persona guard. Missing live provider credentials do not block this.
2. **P5 business side effects:** need secure n8n registry, consent copy, provider correlation, sandbox/mock operations; leave disabled otherwise.
3. **P6 seven stages:** need real owner-approved eligibility/package/document/contract policies or explicit synthetic fixtures for simulation, plus each provider/mock callback contract.
4. **P7 release:** final manual test remains open and unrun until the user explicitly triggers it. Production operation is a separate later approval.

**Sign-off integrity:** Do not close an issue on a speculative provider result; a task can finish with a **verified mock adapter** if its stated acceptance permits that, but must never claim a real sandbox record exists when only local mocks ran.
