# ANCFZ dedicated code cleanup — proposal, no destructive change executed

The source repo contains legacy and cross-tenant implementation features. Do NOT delete files based solely on names: adapters and tests may be used by the dedicated ANCFZ instance. Clean in reviewable stages:

1. Establish a full dependency inventory (`rg 'from .*|import .*|require\(' apps services packages tools infra docs`), runtime route inventory, migrations state, test baseline, and actual n8n active workflow list. Mark all proposed removal entries with usage evidence and rollback path.
2. **Keep:** `services/api` Node orchestration, authentication/tenant isolation, PII vault, RAG, approved-source ingestion, catalog versions and CAS, PostgreSQL outbox, Redis worker, existing lead/qualification, OCR, n8n callback and provider reconciliation, migration chain, acceptance scripts.
3. **Conditionally hide/deprecate:** public tenant onboarding wizard, generic multi-tenant demo navigation, unused channel connectors (only if ANCFZ does not use them), unused illustrative intent catalog demo screens, old readme assumptions and placeholder service feature flags. Remove routes only after end-to-end contract/role tests pass.
4. **Consolidate, not duplicate:** lead-capture workflow `03-anc-lead-capture-wf-1`, CRM01/02/03 templates, SF-02 attachment, DOC01/OCR, PR#71 business-lifecycle migrations 044–052, quote/invoice/contract providers. Replace older template paths only after test-backed migration of active n8n credential bindings and execution IDs.
5. **Never remove SQL migration history** already applied. Add forward-only migrations for simplified dedicated deployment and deprecate columns cautiously.
6. Remove obsolete documentation only after moving required security, API and incident-recovery facts into an up-to-date AGENTS.md, architecture ADR, operator runbook and acceptance matrix. Do not delete evidence logs for audit without approved retention.
7. Execute build/lint/typecheck/unit/PostgreSQL/tenant-boundary tests/8x25 conversation + UI and live n8n sandbox. Block the cleanup PR if regressions exist.

No files in the remote GitHub repository were deleted by this starter package.
