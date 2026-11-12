# VM Conversation Runtime and Workflow Blocker Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Activate the latest `main` runtime on `rag-vm`, keep the VM SSL overlay intact, make the published Lead and quotation workflow bindings reachable, and prove that a fresh conversation preserves intent state and requires explicit action confirmation.

**Architecture:** Keep the current Node coordinator, Python model gateway, PostgreSQL intent/session state, Redis outbox, and Node-authorized n8n boundary. The incident is first treated as a deployment/configuration failure: the latest images were built but not recreated, and the running n8n instance has no published webhook routes. Only add conversation code if a clean latest-main replay reproduces the state or response defect.

**Tech Stack:** TypeScript/Node, FastAPI model gateway, PostgreSQL/pgvector, Redis, Docker Compose, n8n, remote HTTPS n8n webhooks, WebSocket/API acceptance scripts.

**Spec:** `docs/current-state.md`, `docs/vm-deployment.md`, `docs/remote-n8n-integration.md`, `docs/acceptance.md`, `docs/conversation-engine-contracts.md`

## Global Constraints

- Deploy only the latest `main` commit; do not push, merge, or alter production credentials.
- Preserve the VM-local SSL/configuration stash and certificate files. Do not delete SSL files, volumes, PostgreSQL data, Redis data, n8n data, sessions, or vector data.
- Use synthetic customer data only. Never place webhook keys, CRM secrets, customer PII, document bytes, or OTPs in Git, transcripts, or logs.
- Use active `/webhook/` routes, not `/webhook-test/`, for Lead and quotation acceptance.
- Node remains the only side-effect authority. Contact consent is not Lead submission confirmation.
- A transport `2xx`, n8n acceptance, or PDF existence is not provider completion without the configured verification/reconciliation evidence.
- Do not manually edit `intent_catalog_v2_versions.catalog_json`; use the catalog validation → draft → publish path if a binding change is required.

## Review Focus

1. **Runtime freshness:** every API/worker container must run the image built from the deployed commit, not merely have a newer image present locally.
2. **Consent boundary:** contact consent must not persist `lead_action_confirmation` or create a Lead action; explicit Lead submission and confirmation remain separate.
3. **Pending cursor quality:** while Lead confirmation is pending, new business facts must be retained and acknowledged without the generic “tell me more” loop.
4. **Knowledge isolation:** greeting-plus-question and document-information questions must receive grounded answers without automatic CRM advancement.
5. **Workflow truth:** missing/unknown n8n routes must produce a typed reconciliation state and must never be reported as a created Lead or generated quotation.

---

### Task 1: Establish a clean latest-main baseline

**Files:**
- Inspect: `services/api/src/conversation/planning.ts`
- Inspect: `services/api/src/conversation/customer-fact-provenance.ts`
- Inspect: `services/api/src/conversation/turn-controller.ts`
- Test: `services/api/src/conversation/turn-controller.test.ts`

**Interfaces:**
- Consumes: the existing `V2PlanningProposal`, `ConversationTurnCoordinator`, and User Intent Document persistence.
- Produces: a verified decision on whether conversation code changes are needed before VM deployment.

- [ ] Confirm the working tree contains no unrelated edits and record the current branch/commit. Do not overwrite the existing local modifications.
- [ ] Run the focused conversation tests and typecheck/lint/build on the current latest-main source.
- [ ] Confirm the planner schema only accepts customer business facts (`business_activity`, `entity_type`, `visa_count`, `timeline`, `package_choice`) and cannot accept control facts such as `lead_action_confirmation`.
- [ ] Add a regression test only if absent: contact consent leaves `lead_action_confirmation` undefined, creates no action, and leaves the explicit Lead confirmation requirement pending.
- [ ] Add a regression test only if absent: a user supplying business activity and visa count while Lead confirmation is pending retains both facts, receives a contextual acknowledgement, and is still asked for explicit Lead submission rather than a generic requirement prompt.
- [ ] If these tests pass on latest `main`, make no production conversation refactor for this incident. The VM session is then classified as stale-runtime evidence.

**Exit gate:** focused tests, typecheck, lint, and build pass; no unverified conversation patch is carried into deployment.

### Task 2: Verify and select the VM workflow route

**Files:**
- Inspect: published catalog `WorkflowBindings` through the authenticated catalog/admin read path
- Inspect: VM `.env` presence only; never print secret values
- Inspect: `services/api/src/remote-n8n.ts`
- Test: `scripts/acceptance-remote-n8n.mjs`

**Interfaces:**
- Consumes: published Lead and quotation bindings, remote route contracts, and VM-only environment variables.
- Produces: one unambiguous remote n8n route configuration.

- [ ] Verify the published bindings for Lead and quotation use `providerType=remote_n8n`, are enabled only if approved, and carry the expected contracts `remote.salesforce-lead.v1` and `remote.generate-quotation.v1`.
- [ ] Configure VM-only values through the protected environment mechanism: remote base URL `https://ai.techcarrot.ae`, Lead path `/n8n/webhook/salesforce-lead`, quotation path `/n8n/webhook/generate-quotation`, and the quotation API key. Do not commit or echo the key.
- [ ] Keep `V2_LEAD_WORKFLOW_READY=true` only when Salesforce Lead readback configuration is also present and approved; otherwise leave the action disabled and report the exact readiness blocker.
- [ ] Run the existing remote acceptance probe with synthetic data and record status/body previews with secrets redacted. A quotation failure must remain a failure; do not convert it to success.
- [ ] Do not import or activate local n8n copies as a workaround if the published binding is remote. If the catalog is still local-n8n, stop and correct the binding through the catalog publication flow before testing.

**Exit gate:** both remote routes return the contract-expected response shape, or the plan stops with a documented external workflow blocker.

### Task 3: Recreate VM services without losing SSL/configuration

**Files:**
- Inspect: VM `docker-compose.yml` and `infra/nginx/public.conf`
- Preserve: VM-local SSL/configuration stash and `/home/aiuserpoc/ssl/agentic-rag-ai/`
- Use: `scripts/deploy-vm.sh` only if its Compose input includes the VM SSL overlay

**Interfaces:**
- Consumes: latest `main`, the protected VM `.env`, built service images, and existing persistent volumes.
- Produces: running API, event worker, model gateway, n8n, and nginx containers using the deployed image set.

- [ ] Record the current running image IDs and health status for rollback evidence.
- [ ] Verify the preserved VM stash still contains only the intended SSL/configuration changes and that `fullchain.crt` and `server.key` exist. Do not drop or delete the stash.
- [ ] Pull latest `main` with fast-forward only. Before any recreation, ensure the SSL-preserving Compose configuration is applied; the base Compose file alone must not remove HTTPS ports, certificate mounts, or SSL nginx configuration.
- [ ] Validate Compose configuration, start/wait for PostgreSQL, run the forward-only migration runner, build all services, and recreate with `--force-recreate --remove-orphans --wait`. Do not use `down --volumes`, volume deletion, database flush, or vector deletion.
- [ ] Confirm every application container image ID matches the newly built image from the deployed commit. `docker compose build` alone is insufficient.
- [ ] Verify API, model gateway, PostgreSQL, Redis, event worker, n8n, and nginx health, then verify HTTPS and the existing SSL files.

**Exit gate:** all required containers are healthy, running image IDs match the new build, HTTPS remains functional, and persistent data is unchanged.

### Task 4: Run a fresh conversation acceptance session

**Files:**
- Use: existing deployed WebSocket/API conversation harness
- Generate: `artifacts/conversation-quality-runs/<timestamp>/`
- Verify: PostgreSQL `chat_messages`, `chat_sessions`, `user_intent_documents`, `intent_turn_assessments`, action requests/executions, and audit events

**Interfaces:**
- Consumes: the recreated VM runtime and published catalog.
- Produces: one redacted transcript plus a state/action evidence report.

- [ ] Start a new synthetic session; do not reuse the corrupted session from the incident.
- [ ] Exercise: greeting; mixed greeting plus ANCFZ knowledge question; company-formation goal; business activity and two-visa requirement; contact details; contact consent; explicit Lead submission; explicit Lead confirmation; package selection; document request and consent; quotation request.
- [ ] Assert after contact consent: no Lead action exists and `lead_action_confirmation` is absent from verified facts.
- [ ] Assert after business facts: both facts persist, the primary goal remains company formation, and the response acknowledges the facts with one purposeful next question.
- [ ] Assert after explicit Lead confirmation: one idempotent action is created and dispatched; duplicate client message does not create another action.
- [ ] Assert knowledge-only turns do not create CRM actions and document-information questions are not treated as document upload consent.
- [ ] For Lead, require remote provider reference/readback evidence before marking completion. For quotation, require a valid PDF response and the configured workflow/provider evidence; otherwise report `reconcile_required` or blocked.
- [ ] Review the complete transcript for repetitions, unsupported claims, internal keys, wrong persona, duplicate questions, false success, and generic fallbacks.

**Exit gate:** the conversation reaches the first external blocker truthfully, with no false Lead confirmation, no action duplication, and no ungrounded completion claim.

### Task 5: Close out with evidence and rollback readiness

**Files:**
- Update: `docs/current-state.md` with measured result and exact blocker, if any
- Create: redacted artifact under `artifacts/conversation-quality-runs/`
- Preserve: prior image IDs and VM SSL/configuration stash

**Interfaces:**
- Consumes: test transcript, DB state checks, container health, workflow responses, and provider evidence.
- Produces: a truthful pass/blocked report and a rollback point.

- [ ] Classify the result as `CONVERSATION_INTENT_AND_TOOLS_VERIFIED_INTEGRATIONS_BLOCKED`, `SEVEN_STAGE_SIMULATED`, or provider-verified only when the acceptance evidence supports it.
- [ ] If the fresh run fails before the workflow boundary, fix the smallest failing code path, add its regression test, rebuild, and repeat Tasks 3–4.
- [ ] If only n8n/provider verification fails, do not change conversation state to hide it; correct route/credentials/workflow activation and rerun the affected action with a new synthetic session.
- [ ] If the new containers are unhealthy, restore the recorded image set using the preserved deployment configuration; do not roll back by deleting data or SSL files.
- [ ] Update `docs/current-state.md` only with measured facts, not an unverified “green” claim.

**Final acceptance:** latest-main containers are active on the VM, SSL is intact, remote workflow routes are configured and independently verified, and the new transcript passes the state/quality assertions or reports the first remaining external blocker precisely.
