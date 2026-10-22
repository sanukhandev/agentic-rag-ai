# PR #46 — Review remediation and verification

Date: 2026-10-22
Branch: `feature/crm-omnichannel-conversation-v2`
Review baseline: `7a78bbd`

## Current scope

Per owner instruction, the Redis Streams / transactional outbox architecture is **deferred** and is not a gate for this review-fix pass. Existing n8n HTTP integration remains in place. The existing ANC production/sandbox workflow is intentionally not activated or reconfigured by these commits.

## Implemented code changes

1. **Prevent retained leads from hijacking RAG:** `leadReady` does not independently override unrelated knowledge questions; the lead journey must be active. Regression checks an unrelated question after a consented CRM interaction.
2. **Action-scoped consent:** no session-wide consent fallback in `/internal/crm/leads`; catalog confirmation validates active consent prompt + matching action intent/version. A changed intent resets permission. Bare negative answers/refusals suppress proposals and stale confirmation.
3. **Accurate confirmation status:** expired or failed confirmation responds `409 ACTION_NOT_ACCEPTED` without marking queued or granting consent; repeated expiration also returns 409.
4. **Complete contact gate:** runtime requires valid name **and** email **and** E.164 phone for local CRM creation and Salesforce remote-payload release. Legacy chat collects missing fields individually; generator marks name/email/phone mandatory, removes either/or grouping and updates mapped field requirements.
5. **Concurrent state protection:** optimistic session `stateVersion` enforced on PostgreSQL update, and version-aware MemoryStore copies sessions to prevent lost updates. Conflicts return explicit 409; callers must retry against the latest prompt. True atomic user-message + assistant-response + state persistence remains a future hardening task.
6. **Existing CRM lookup endpoint:** generated CRM-01 now targets a tenant/session/action-validated internal CRM reference lookup. This is an internal link lookup, **not** yet a live Salesforce query.
7. **n8n generated exports:** all 17 inactive JSON exports now use bindable n8n HTTP Header Auth credentials instead of `$env.N8N_WEBHOOK_SECRET`. CRM-02 and 13 intent templates explicitly finalize a claimed action only if a validated remote CRM record is already linked; otherwise they mark the action failed, rather than returning a false success or leaving a successful internal write in `processing`. **Provider nodes are not configured and exports remain inactive.**
8. **Regression coverage:** added stale state, expired confirmation, consent across actions, declined consent, missing email/phone, topic switching, and workflow terminal/auth contract assertions.
9. **CI:** added `.github/workflows/crm-v2-pr-validation.yml` for Node build/typecheck/lint/tests, workflow contracts, secret checks and Python/Tesseract suite.

## Validation actually performed in this review pass

- Verified JSON parsing and credential/terminal node structure of all **17** modified n8n templates using the GitHub-sourced JSON.
- Evaluated the generated CRM terminal Code node on mock lead objects: linked records report `completed`, records without a remote link report `failed`.
- Syntax-parsed the updated n8n and catalog generator JavaScript and JSON test file source (after stripping import syntax in a parser-only check).

These are **structural checks**, not a run of the repository test suite. The GitHub API currently reports no workflow runs or checks on the newest feature-branch commit. The previously reported local smoke tests predate these remediation commits.

## Remaining release gates

- Run `npm ci && npm run build && npm run typecheck && npm run lint && npm test`; run `node --test infra/n8n/workflows/crm-v2-workflows.test.mjs` and Python tests, Docker/browser E2E.
- Regenerate and validate the **committed binary ANCFZ intent/content XLSX and training ZIP** locally. The checked-in workbooks have not been rewritten after updating their generator; do not claim binary artifact validation or publish them.
- Import and bind the inactive CRM-01/02/03 and intent workflow exports in an approved tenant n8n instance. Provider-specific Salesforce lookup, configurable CRM summary field update and error/reconciliation paths still need implementation and controlled sandbox verification.
- Existing active ANC WF-1 still uses some n8n environment-based integration configuration. Do not change its credential binding remotely without validated deployment and rollover.
- Run deliberate Salesforce OAuth, provider timeout/replay and OCR error-path tests in staging.
- Resolve the lack of CI status reporting and confirm deployment/rollback evidence before release.

No production deployment or live-provider retest is claimed in this document.
