# n8n orchestration and guarded tools

## Design principle
n8n is a **workflow execution engine**, not the primary chat brain, source of business facts, policy authority or customer token vault. Node authorizes and queues approved work; n8n polls and executes it. The model may propose an intent; a deterministic policy engine decides whether a workflow is permitted.

Approved actions and supporting-document jobs are now written with an application-owned PostgreSQL outbox event. The relay publishes to Redis Streams and an isolated worker starts a bounded n8n entrypoint with opaque references. The existing polling endpoints remain a compatibility path during rollout; Redis Pub/Sub is not used as the durable queue.

## Intent proposal → action gate
1. GPT-4.1-mini returns a constrained JSON intent proposal: canonical intent enum, arguments derived from masked conversation, supporting citations when needed, and explicit missing parameters.
2. Node validates against a versioned schema. Ignore extra properties, unknown intent IDs, unsupported arguments, fabricated evidence references and imperative text from retrieved documents.
3. Node checks confidence threshold **plus** business rules; low confidence means ask a targeted question or do nothing. Confidence alone is never authorization.
4. Resolve tenant, session, role, source permissions, user confirmation and action policy; check side effects/consent.
5. Reserve idempotency key in PostgreSQL transaction; create pending action audit event.
6. Mark the action `approved` after confirmation. Do not invoke n8n from the API.
7. n8n claims approved actions through the authenticated polling endpoint, validates the catalog binding, performs the side effect through Node, and reports the resulting state. Never claim completion from an HTTP timeout or an unverified model statement.

## Registry example (concept, not configured)
| Key | Risk | Example purpose | Gate |
| --- | --- | --- | --- |
| lead.capture | personal data write | Record consented sales lead | explicit permission/consent + verified destination |
| lead.notify | external communication | Notify authorized sales team | permitted team + approved recipient |
| appointment.request | external scheduling | Request an appointment | identity + confirmation + slot validation |
| catalog.refresh | admin operation | Reindex approved catalog | admin role + documented source ID |

The local `lead.capture` action is implemented by the checked-in workflows under `infra/n8n/workflows/`. Production destinations and credentials remain deployment decisions.

`ANC Lead Capture WF-1` is the provider-neutral async variant. Its remote CRM lead URL, provider name and remote-ID pattern are n8n environment values (`REMOTE_CRM_*`), while OAuth client credentials remain in n8n's encrypted credential store and are referenced by workflow credential ID/name. Node exposes only an authenticated, tenant/action-matched payload containing the validated lead contact fields and summary; n8n owns the provider calls and sends the returned ID back to Node.

## Internal request fields
workflowKey, registryVersion, tenantId (server-derived), actionId, correlationId, idempotencyKey, masked/non-sensitive arguments, consentRef, userRef (opaque). Use HTTPS/mTLS or signed HMAC with replay window; never include raw identity, full transcripts or model prompts. If downstream integration must receive a contact address, authorize and resolve it **inside a separate trusted Node-side integration boundary**, not generically inside n8n.

## Workflow conventions
- Name by domain + action + version, e.g. sales.lead-capture.v1.
- Validate payload at entry. Use non-public authenticated triggers and least-privileged credentials.
- Distinguish 202 accepted from completed. For async tasks, require signed callbacks or server-side polling with durable correlation.
- A non-success n8n dispatch is acknowledged only after the action is moved to `RECONCILE_REQUIRED` and dead-lettered; this prevents a failed or provider-ambiguous execution from remaining `processing` or being replayed blindly.
- Implement retry/backoff with poison queue/dead-letter handling; no automatic retry of non-idempotent side effects without provider support.
- Keep workflow nodes minimal; business validation, evidence generation and PII mapping remain in Node.
- Do not leak request bodies in n8n execution history; use redacted execution retention and appropriate role controls.
- Version and review exported workflow definitions as code when approved; never commit credentials, connection IDs tied to real secrets or customer payloads.

## Error cases
Timeout does not mean failure or success; mark outcome unknown until reconciled. Callback replay must be rejected. Unexpected tenant/action IDs cause rejection and security event. Internal workflow engine outage should not invalidate an otherwise grounded FAQ answer.

## Implemented local lead-capture POC
1. Node collects name plus email/phone through conversation and requires explicit confirmation.
2. Node records the action as `approved`; it does not make an HTTP call to n8n.
3. `01-lead-capture-and-crm.json` polls `/api/v1/internal/workflow-events/claim`, validates the published intent catalog and masked contact data, then inserts one tenant-scoped CRM record through Node.
4. The first workflow executes `02-lead-conversation-summary.json` as a sub-workflow. Its `Calculate Catalog Quality` node reads only the claim's published `QualityRules` and slot weights, stores the score, and then stores a deterministic summary with the request, intent, quality and turn counts.
5. Tenant admins can view the lead, intent, quality, score, validation result, summary and expandable conversation JSON in the CRM section.

The Node API remains the authorization, tenant-isolation and token-rehydration boundary. The ANC workflow is an explicit internal exception: after approval, scoring and contact validation, its n8n path receives only the minimum rehydrated contact payload needed by the configured CRM provider—not the full transcript or vault—and uses the shared local Compose secret for internal API calls. Keep n8n private, protect execution history, and never put provider credentials in exported workflow JSON.
# Dynamic document intake

The catalog may publish `anc.document.ocr.extract` as a secondary, explicit-upload action. The API is authoritative for tenant access, consent, file validation, document/job persistence, masking, and summary composition. n8n receives only opaque tenant/session/document/job IDs and the catalog-selected workflow contract.

The importable local workflow is `infra/n8n/workflows/04-anc-document-ocr-wf-1.json` (`anc-test-document-ocr-wf-1`). It is intentionally inactive until the tenant catalog binding is activated and the workflow is reviewed. The worker claims the durable job and runs local Tesseract OCR; n8n does not receive document bytes.
