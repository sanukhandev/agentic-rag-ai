# ANCFZ starter import and local source prerequisites

## Inputs

- Downloaded artifact: ANCFZ_Dedicated_Seven_Stage_Starter_2026-10-29.zip (local developer workstation; not part of repository yet).
- Authoritative fresh knowledge ZIP: OneDrive_1_23-10-2026.zip (local developer workstation; never commit raw ZIP without source and confidentiality review).
- Current branch: feat/ancfz-seven-stage-lifecycle-acceptance.

## Actions

1. Obtain the local ZIP and inspect its contents and checksums before applying; do not assume ChatGPT sandbox paths exist on the workstation.
2. Import the draft XLSX and its canonical intent-source JSON, Python quote/invoice PDF service, payment mock, n8n workflow templates and ingestion/preflight utilities from the starter package, preserving relative paths.
3. Compare files and MERGE conflicts. Do not overwrite existing AGENTS.md security rules, operational migrations, credentials or working workflows blindly.
4. Run Python tests and Node lint/test/typecheck/build before activating any workflow.
5. For OneDrive_1_23-10-2026.zip, safely extract and register eligible Markdown and Word files sequentially, verify real embeddings in fresh isolated pgvector and approve each source. Record rejected/unsupported/failed sources separately.
6. Keep unverified workflow bindings inactive. Configure existing managed Salesforce credentials ONLY in n8n; do not commit credentials or upload mock payments to public ingress.
7. Read docs/prompts/CODEX_MASTER_ANCFZ_FRESH_DELIVERY.md as controlling execution prompt. Use docs/ops/SAFE_CLEANUP_PLAN.md from the starter as the cleanup checklist once imported.

## Bootstrap note

This documentation is pushed to the requested remote branch as setup. The older 25-local-commit rule is preserved for subsequent substantive implementation commits, counted separately from this docs-only bootstrap. No fresh ingestion, admin bootstrap, Salesforce binding, n8n import or API acceptance is claimed by this commit.
