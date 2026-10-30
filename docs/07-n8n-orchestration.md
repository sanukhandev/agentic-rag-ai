# n8n orchestration and guarded tools

## Design principle
n8n is a **workflow execution engine**, not the primary chat brain, source of business facts, policy authority or customer token vault. Node authorizes and records approved work; the PostgreSQL transactional outbox, Redis Streams relay and event worker deliver it to n8n. The model may propose an intent or request an approved read-only Foundry function; neither authorizes a business write.

Approved actions and supporting-document jobs are now written with an application-owned PostgreSQL outbox event. The relay publishes to Redis Streams and an isolated worker starts a bounded n8n entrypoint with opaque references. The existing polling endpoints remain a compatibility path during rollout; Redis Pub/Sub is not used as the durable queue.

## Catalog decision → consent → durable action execution

1. Node loads the authenticated tenant/session, pinned published catalog, selected opportunity and verified facts. The catalog determines eligibility, thresholds, required slots and the active workflow binding. Foundry's interpretation or function call is **advisory**, never authorization.
2. Node validates purpose-scoped consent, user confirmation, stage prerequisites and opportunity/action revision. Invalid, ambiguous, duplicate or stale requests cannot dispatch a side effect.
3. Node proposes an `ActionRequest` and returns the existing `actionProposal` for explicit confirmation where needed. The Chat API must not call n8n directly.
4. Once confirmed, Node atomically persists the authorized action/state transition and its PostgreSQL `event_outbox` record under the existing idempotency and transaction rules.
5. The `event-relay` publishes the outbox event to Redis Streams. The `event-worker` consumes the event, uses an authenticated internal n8n entrypoint and carries only allowlisted minimum-data references.
6. n8n executes the configured credentialed provider workflow and returns independently verifiable results through authenticated callback/reconciliation paths. Node updates `action_executions`, authoritative stage state, and audit records; `202`, a local Lead or an n8n success event is not remote provider completion.
7. Unknown/timeout outcomes move to reconciliation/dead-letter handling according to existing retry and idempotency policy; do not replay ambiguous external writes blindly.

**Compatibility:** legacy scheduled n8n workflows may poll the authenticated action-claim endpoint during transition. That polling is a maintained compatibility mechanism, **not the primary architecture** or an instruction to build another polling engine.

## Registry example (concept, not configured)
| Key | Risk | Example purpose | Gate |
| --- | --- | --- | --- |
| lead.capture | personal data write | Record consented sales lead | explicit permission/consent + verified destination |
| lead.notify | external communication | Notify authorized sales team | permitted team + approved recipient |
| appointment.request | external scheduling | Request an appointment | identity + confirmation + slot validation |
| catalog.refresh | admin operation | Reindex approved catalog | admin role + documented source ID |

The repository contains lead-capture workflow definitions under `infra/n8n/workflows/`. Their activation and provider credentials are deployment-specific; do not treat static exports or a local workflow run as an independently verified Salesforce write.

`ANC Lead Capture WF-1` is a provider-neutral workflow variant. Its remote CRM lead URL, provider name and remote-ID pattern are n8n environment values (`REMOTE_CRM_*`), while OAuth client credentials remain in n8n's encrypted credential store and are referenced by workflow credential ID/name. Node exposes only an authenticated, tenant/action-matched payload containing the validated lead contact fields and summary; n8n owns the provider calls and sends the returned ID back to Node.

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

## Historical local lead-capture polling compatibility

The existing `01-lead-capture-and-crm.json` and `02-lead-conversation-summary.json` exports document the original scheduled claim/quality POC. They may still be used by configured compatibility paths but do not supersede `event_outbox` → Redis Streams → event worker. They require the same catalog, consent and identity checks. Admins can review permissible Lead and summary data through existing APIs; a local CRM record does not establish a verified remote Salesforce Lead.

The Node API remains the authorization, tenant-isolation and token-rehydration boundary. The ANC workflow is an explicit internal exception: after approval, scoring and contact validation, its n8n path receives only the minimum rehydrated contact payload needed by the configured CRM provider—not the full transcript or vault—and uses the shared local Compose secret for internal API calls. Keep n8n private, protect execution history, and never put provider credentials in exported workflow JSON.
## Dynamic document intake

The catalog may publish `anc.document.ocr.extract` as a secondary, explicit-upload action. The API is authoritative for tenant access, consent, file validation, document/job persistence, masking, and summary composition. n8n receives only opaque tenant/session/document/job IDs and the catalog-selected workflow contract.

The importable local workflow is `infra/n8n/workflows/04-anc-document-ocr-wf-1.json` (`anc-test-document-ocr-wf-1`). It is intentionally inactive until the tenant catalog binding is activated and the workflow is reviewed. The worker claims the durable job and runs local Tesseract OCR; n8n does not receive document bytes.
