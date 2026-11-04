# ANCFZ V2 – credential-ready workflow templates (not active)

**Status: imported drafts only.** These templates deliberately cannot execute external provider actions until reviewed and configured. This directory is volume-mounted read-only at `/workflows/ancfz-v2`. Merely pulling the repository or restarting n8n does **not** import workflows into the n8n database.

## Scope and stage policy

1. **Lead Generation** – `crm.lead.create` (Salesforce Lead); optional lead notification is a distinct workflow.
2. **Lead Qualification** – **Node-only deterministic qualification gate**, not an n8n CRM write; no workflow needed to mark qualification complete.
3. **Account Creation** – optional verification email send/check, followed by Salesforce Account, Contact and Opportunity linkage only after qualification and explicit confirmation. OTP verification alone is not Account creation. Optional notification follows verified Account creation.
4. **Package Selection** – Node authoritative package choice, optional approved quote/PDF adapter.
5. **Document Upload** – document review/consent in Node, then Salesforce SF-02 attachment using an opaque document handle; readback must verify the correct Lead/Account association.
6. **Payment Details & Invoice** – separate invoice generation and payment authorization/status verification workflows. A payment redirect or invoice does not mean paid.
7. **Contract** – separate contract-send and signing-status verification workflows; `sent` is not `signed`.

## Why these templates are inert

- All exports contain `active:false`; no provider credential IDs or secrets are embedded.
- Success and error execution-data persistence are both set to `none` to avoid retaining customer contacts, document references, payment handles and signing details in n8n execution history. Use restricted backend audit events for diagnostics.
- Webhook nodes use **Header Auth**; create a credential named `ANCFZ Node Dispatch` with header `X-Agentic-Internal-Secret` and the existing value of `N8N_WEBHOOK_SECRET` from your local deployment. Also assign a managed `httpHeaderAuth` credential for internal HTTP Request nodes; never put the secret into workflow JSON.
- Salesforce provider nodes require n8n managed OAuth2 credentials (sandbox first). Other providers use placeholder HTTP Header Auth; replace the `.invalid` URLs only with approved sandbox endpoints.
- The Node action claim endpoint now resolves published V2 actions by canonical catalog reference when the V2 workflow binding includes `n8nWorkflowId`, `webhookPath` and `payloadContract`. The V2 trusted evidence endpoint `/api/v2/internal/provider-evidence/verify` is still **not implemented**. Consequently **the workflows are not runnable end-to-end merely by setting credentials**; implement and test the evidence bridge before activation, and do not weaken the `Require V2 Stage Authorization` gate.
- Claimed actions require exact tenant/session/opportunity, catalog version, idempotency key, action key/revision and purpose-specific consent/confirmation verified by **Node**. The n8n code cannot create this authority from the webhook body.
- Provider writes must use stable idempotency; ambiguous timeouts require reconciliation, not blind retries. Provider readback and a trusted Node attestation must precede `completed` callbacks.
- V2 `ToolBindings` and `WorkflowBindings` in the ANCFZ draft remain disabled. **Do not enable them until the Node claim/dispatch/evidence/callback contract is complete and sandbox acceptance passes.**

## Credential and endpoint checklist

| Provider type | Configure manually in n8n | Required proof |
| --- | --- | --- |
| Internal Node API | Header Auth, `X-Agentic-Internal-Secret` | Correlated claim, evidence attestation and completion |
| Salesforce | OAuth2 sandbox; approved Lead/Account/SF02 URLs | Remote record readback and correct Lead–Account–Opportunity association |
| Email / OTP | Approved messaging provider, API credential | Challenge bound to session, expiry, verification receipt; no OTP in model logs |
| Package quote / PDF | Quote service credential and approved catalog pricing | Quote ID, version and revision |
| Document transfer | Salesforce credential + secure document-handle resolver | SF-02 attachment ID and exact target linkage |
| Invoice | Finance/invoice credential | Invoice ID, artifact hash, issued status |
| Payment | Payment-provider sandbox credential | Payment transaction ID and authoritative paid/failed status; no card data in n8n |
| Contract signing | E-sign provider sandbox credential | Contract ID, signer proof and signed-state readback |
| Notifications | Transactional email credential; per-event consent | Delivery reference, no effect on stage advancement |

## Import into your existing persistent n8n instance (once)

From the repository root, after pulling the branch:

```powershell
docker compose ps n8n
docker compose exec -T -u node n8n n8n import:workflow --separate --input=/workflows/ancfz-v2
```

If the CLI invocation is unavailable, open `http://localhost/n8n/` and import the JSON files individually in the editor. Confirm all are **unpublished**; do not use `--activeState=fromJson`. Each file has a stable `id`, so **back up existing n8n workflows** before reimport: matching IDs may overwrite local edits or credential assignments. Existing `./data/n8n` remains untouched by repository changes. Rebuilding Docker alone will not import these files.

Production-facing public Nginx ingress stays on port 80 for local HTTP. Provider credentials and backend traffic never need additional published Docker ports. Add HTTPS before public deployment.

## Test gates before activation

Static structural check: `node --test infra/n8n/workflows/ancfz-v2-templates.test.mjs`. Then sandbox tests: bad auth, wrong tenant, missing consent, wrong stage, stale revision, duplicate action, timeout/retry, partial invoice, unpaid payment, mismatched Salesforce attachment, unsigned contract, callback replay and independently verified provider readback.
