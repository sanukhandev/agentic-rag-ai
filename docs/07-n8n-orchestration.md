# n8n orchestration and guarded tools

## Design principle
n8n is a **workflow execution engine**, not the primary chat brain, source of business facts, policy authority or customer token vault. Node alone authorizes and invokes workflows. The model may propose an intent; a deterministic policy engine decides whether a workflow is permitted.

## Intent proposal → action gate
1. GPT-4.1-mini returns a constrained JSON intent proposal: canonical intent enum, arguments derived from masked conversation, supporting citations when needed, and explicit missing parameters.
2. Node validates against a versioned schema. Ignore extra properties, unknown intent IDs, unsupported arguments, fabricated evidence references and imperative text from retrieved documents.
3. Node checks confidence threshold **plus** business rules; low confidence means ask a targeted question or do nothing. Confidence alone is never authorization.
4. Resolve tenant, session, role, source permissions, user confirmation and action policy; check side effects/consent.
5. Reserve idempotency key in PostgreSQL transaction; create pending action audit event.
6. Call only registered internal workflow connector with minimal, sanitized, typed payload and restricted credentials.
7. Validate n8n result, update action state machine, and return accurate status. Never claim completion from an HTTP timeout or an unverified model statement.

## Registry example (concept, not configured)
| Key | Risk | Example purpose | Gate |
| --- | --- | --- | --- |
| lead.capture | personal data write | Record consented sales lead | explicit permission/consent + verified destination |
| lead.notify | external communication | Notify authorized sales team | permitted team + approved recipient |
| appointment.request | external scheduling | Request an appointment | identity + confirmation + slot validation |
| catalog.refresh | admin operation | Reindex approved catalog | admin role + documented source ID |

The local `lead.capture` action is implemented by the checked-in workflows under `infra/n8n/workflows/`. Production destinations and credentials remain deployment decisions.

## Internal request fields
workflowKey, registryVersion, tenantId (server-derived), actionId, correlationId, idempotencyKey, masked/non-sensitive arguments, consentRef, userRef (opaque). Use HTTPS/mTLS or signed HMAC with replay window; never include raw identity, full transcripts or model prompts. If downstream integration must receive a contact address, authorize and resolve it **inside a separate trusted Node-side integration boundary**, not generically inside n8n.

## Workflow conventions
- Name by domain + action + version, e.g. sales.lead-capture.v1.
- Validate payload at entry. Use non-public authenticated triggers and least-privileged credentials.
- Distinguish 202 accepted from completed. For async tasks, require signed callbacks or server-side polling with durable correlation.
- Implement retry/backoff with poison queue/dead-letter handling; no automatic retry of non-idempotent side effects without provider support.
- Keep workflow nodes minimal; business validation, evidence generation and PII mapping remain in Node.
- Do not leak request bodies in n8n execution history; use redacted execution retention and appropriate role controls.
- Version and review exported workflow definitions as code when approved; never commit credentials, connection IDs tied to real secrets or customer payloads.

## Error cases
Timeout does not mean failure or success; mark outcome unknown until reconciled. Callback replay must be rejected. Unexpected tenant/action IDs cause rejection and security event. Internal workflow engine outage should not invalidate an otherwise grounded FAQ answer.

## Implemented local lead-capture POC
1. Node collects name plus email/phone through conversation and requires explicit confirmation.
2. Node sends masked lead fields, score, validation result and the complete masked conversation to the private `lead-capture` webhook.
3. `01-lead-capture-and-crm.json` validates `lead.capture`, `score >= 70`, contact data and conversation shape, then inserts the tenant-scoped record through the internal Node API.
4. The workflow triggers `02-lead-conversation-summary.json`, which stores a deterministic summary while the CRM record retains the full masked conversation JSON.
5. Tenant admins can view the lead, intent, score, validation result, summary and expandable conversation JSON in the CRM section.

The Node API remains the authorization, tenant-isolation and token-rehydration boundary. n8n receives only tokenized values and uses the shared local Compose secret for the internal API calls.
