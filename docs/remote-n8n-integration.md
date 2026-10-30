# ANCFZ remote n8n workflow registry — supplied contracts, not yet verified

**Status:** four user-reported remote n8n webhooks; **NOT YET EXECUTED OR INTEGRATION-VERIFIED**. These are reusable provider operations in the target catalog-driven Node orchestration, not a reason to make CRM Lead creation the primary customer intent.

Host configuration (not catalog-controlled): `https://ai.techcarrot.ae` with private, approved workflow credential references.

| Stage | Catalog tool / workflow key | Supplied test webhook route | Request content | Verification requirement |
| --- | --- | --- | --- | --- |
| 1. Lead Generation | `create_lead` / `anc.new_company.lead_create` | `/n8n/webhook-test/salesforce-lead` | JSON `Name`, `Company`, `Phone`, `Email`, `Description` | Approved action with consent; independently verify `leadId`, duplicate handling and provider association |
| 3. Account verification (send) | `send_account_verification` / `anc.new_company.send_account_otp` | `/n8n/webhook-test/send-account-verification` | JSON `leadId`, `email`, `customerName` | Qualified + verified Lead, explicit email approval, returned challenge/delivery evidence |
| 3. Account verification (check) | `verify_account_otp` / `anc.new_company.verify_account_otp` | `/n8n/webhook-test/verify-account-otp` | JSON `challengeId`, `otp` | Challenge bound to correct session/opportunity; provider-verified success, expiry and replay limits |
| 5. Document Upload | `sf02_document_attach` / `anc.new_company.document_upload` | `/n8n/webhook-test/salesforce-document-upload` | Multipart `leadId`, binary `file` | Upload consent, approved document, verified Salesforce attachment ID and linked target |

## Provider mapping in the canonical plan

These reported paths are **configuration evidence**, not approved production endpoints; `webhook-test` requires a listening test workflow. The new seven-component conversation system keeps n8n **outside Python**. P5 verifies Node approval/outbox/event correlation and P6 individually validates provider records. OTP verification cannot complete Stage 3 without the separate Account creation/linkage operation. Invoice/quotation/contract must have independent verified adapters, with signed/paid status described only if proven. See [delivery plan](conversation-engine-delivery-plan.md) and [evaluation](conversation-engine-evaluation.md).

## Required implementation rules

1. The current importer expects six mandatory workbook sheets (`README`, `Intents`, `Signals`, `Slots`, `Relations`, `WorkflowBindings`); proposed `ToolBindings`, stage-scoped requirements and other new planner sheets are **not** authoritative until the importer and TypeScript validator are extended. Use current architecture docs and a reviewed workbook version.
2. Set all current remote workflow bindings **inactive** until the real n8n workflow IDs, authentication, active test listeners, returned JSON, callback mappings and provider evidence are inspected. Treat supplied webhook paths as inventory, **not as verified deployments**. Do not enable a binding merely because the URL is known.
3. The example OTP endpoints used `X-API-Key`; the previously disclosed value must be **rotated** and supplied only as a protected Node/worker environment secret (`N8N_ACCOUNT_VERIFY_API_KEY`). Never reproduce keys, challenge values, OTPs, customer email/phone, Lead IDs or absolute file paths in code, prompts, tests or documentation.
4. Lead creation and SF-02 upload examples omitted auth headers. This **does not prove** their authentication configuration is safe; require reviewed authentication and webhook access rules before testing.
5. `webhook-test` is registered only while n8n is **listening for a test event** (documented ~120 seconds). Use the activated/published webhook URL for ongoing service only after safe authentication, idempotency and callback verification: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/workflow-development/
6. Python GPT planner may propose `toolKey`; Node verifies published catalog, tenant/session/opportunity, stage, consent and separate customer action confirmation. Existing transactional outbox → Redis event worker → authenticated n8n remains the only external write path. Never let model supply arbitrary URL or webhook authentication.
7. OTP is a short-lived secret; collect through a protected Node field and send only to the verification adapter. Do not persist raw OTP in the User Intent Document, model prompt, RAG, audit trace or generated artifact. Persist only challenge reference and verified status.
8. OTP verification **is not** Salesforce Account/Contact/Opportunity creation. Stage 3 still needs its own approved creation/linkage integration and provider identifiers.
9. Remaining not-supplied workflows: approved Account creation/linkage, package quotation, invoice/payment status and contract/signing. Qualification may be deterministic Node-only. Avoid inventing external completion.
10. Distinguish transport receipt (`2xx`), n8n execution success, provider record verification, and reconciled stage completion as separate outcomes. On ambiguous CRM write, use `reconcile_required` without blind replay.

## Safe sequence to test — NOT EXECUTED

1. Inspect and confirm four remote workflow IDs, operation method, auth, expected response, sandbox/production target and test listener.
2. With unique **synthetic** customer data and explicit authorization, invoke **Lead Generation** through the Node action gate. Independently verify Salesforce Lead identifier before proceeding.
3. Run deterministic Lead Qualification; only after success, request OTP send to a synthetic approved test mailbox, then verify fresh customer-entered OTP through protected Node.
4. Wait for distinct Account creation/linkage workflow and verified provider IDs; do not mark stage complete from OTP success.
5. At Stage 5 (after confirmed package), upload only a benign synthetic PDF through secure backend and verify SF-02 attachment with its Salesforce target; validate whether the upload endpoint supports Account/Contract IDs, as its supplied request uses `leadId`.
6. Exercise no-consent, expired OTP, duplicate Lead, duplicate action replay, wrong target record, provider timeout and callback rejection. No real payment/signature testing without explicit approval.

The accompanying draft sample workbook (`anc_new_company_intent_catalog_remote_workflows_v02.xlsx`) includes these paths under `RemoteWorkflowRegistry`, disabled `WorkflowBindings`, and proposed `ToolBindings`. It is an **offline artifact**, not published/activated automatically.
