# Final Acceptance Report — Checkpoint

**Overall status:** NOT_READY
**Branch:** `fix/zara-conversation-engine-end-to-end-recovery`
**Base:** `feat/gpt-first-langgraph-unit-only`

## PASS at this checkpoint

- Original four failures reproduced and root causes documented.
- Optional question validation separated from answer validation.
- Trusted post-tool evidence eligible for bounded repair.
- Claim polarity regression corrected at source-clause boundary.
- Candidate intent survives rejected response wording.
- Public five-turn historical regression: 5/5 smoke PASS.
- Public initiation/refusal state behavior: PASS.
- Natural `Yes, let's proceed.` goal confirmation: PASS; confirmed goal persisted and no action consent inferred.
- Verified business activity and visa facts survive post-confirmation turns: PASS in public smoke and PostgreSQL intent-document inspection.
- Invalid non-knowledge journey citations no longer erase safe continuity: PASS in coordinator regression and public smoke.
- Public 25-turn conversation/persistence harness: 25/25 turns and 25 durable unique customer messages PASS after ZARA-005 correction.
- Final public 25-turn persistence rerun at commit `58fb319`: PASS, session `b4c17814-8b2f-4af1-90a0-5d6ec9b6a8ee`, 25/25 answers and 25 durable unique customer messages.
- Local five-source ingestion acceptance: PASS after ZARA-006 correction.
- Synthetic tenant A/B/idempotent mock workflow acceptance: PASS after aligning the harness with one-field-at-a-time contact collection.
- API focused/full unit, typecheck, lint and Docker API/model-gateway build: PASS for executed runs.
- V2 package catalog identity boundary: PASS — migrations 059–060 applied, tenant-scoped FK/check constraint verified, V2 gateway/store/lifecycle regression coverage PASS; two explicitly development-only sandbox offerings are pinned to the canonical V2 catalog, and no official pricebook data was fabricated.
- V2 masked contact collection boundary: PASS — name/email facts persisted under catalog requirement keys, explicit contact consent advanced to Lead action confirmation, and no action was created.
- V2 catalog-gated Lead proposal boundary: PASS in the regression fixture — explicit submission plus purpose-specific consent produced one awaiting-confirmation proposal through Node's existing gate; no provider dispatch was claimed.
- V2 package/lifecycle boundary: PASS for canonical development-only package listing and deterministic quote contract tests; public package retrieval returned two V2-pinned offerings. Verified Account, official pricebook and provider completion remain unverified.
- V2 outbox/n8n claim boundary: PASS in focused memory/bridge coverage — canonical V2 refs, catalog-declared transport identity and durable execution correlation are enforced; live n8n/provider execution remains unverified.
- V2 provider-evidence boundary: PASS for deterministic mock verification and fail-closed Salesforce reconciliation; canonical V2 provider contracts accept pinned catalog refs; live Salesforce readback remains unverified.
- Latest API full suite: PASS — 61 test files / 494 tests; lint, typecheck and build PASS; rebuilt API health endpoint HTTP 200.
- Final post-fix historical five-turn replay: PASS — grounded formation response, grounded contextual follow-up, natural formation confirmation prompt, and refusal without action.
- Catalog V2 revision 3: PASS in the development database; existing revisions remain draft/pinned and new sessions resolve `anc:r3:1de595abd94fc134b5e457113e927c323a29b89da60ffa2cf9dae0574c0d0858`.
- V2 Account lifecycle identity boundary: PASS in the enabled synthetic binding regression; the real ANCFZ Account binding remains disabled and no provider completion is claimed.
- Docker API restart/duplicate replay: PASS — the same client message ID returned the same assistant message before and after an API restart, with one durable user message and no provider side effect.
- Live provider boundary check: BLOCKED_EXTERNAL_DEPENDENCY — `.env` selects Salesforce, but the published ANCFZ V2 `lead.create` and `crm.lead.create` bindings are disabled; the inactive n8n template has a placeholder provider URL/no credential, and the evidence endpoint deliberately reconciles until independent Salesforce readback is configured.

## Unverified or blocked

- Full seven-stage customer journey.
- Salesforce sandbox create/update/readback and SF-02.
- Package/quotation lifecycle.
- Browser E2E.
- Worker/Redis restart/replay and full stack acceptance; API restart and duplicate replay are separately PASS as recorded above.
- Three independent Azure evaluations at >=90% each.
- Formal performance benchmark.
- Full quote/package calculation and customer-facing quote revision journey.
- Live Lead proposal/provider execution from the published ANCFZ catalog remains blocked because its Lead bindings are disabled and the n8n template has no configured Salesforce provider evidence path.
- V2 Salesforce provider-evidence completion remains BLOCKED_EXTERNAL_DEPENDENCY until a configured Node provider adapter performs independent sandbox readback; the implemented endpoint deliberately fails closed.
- ANCFZ official package/pricebook acceptance: BLOCKED_EXTERNAL_DEPENDENCY — two development-only sandbox offerings are available for deterministic local tests, but no official ANCFZ price source or live quote/provider integration is configured.
- `npm audit --omit=dev --audit-level=high`: FAIL — one high `undici` advisory remains on the workspace OpenAI/Angular resolution path. `npm audit fix --dry-run` hits an Angular peer-resolution conflict; no security gate was weakened and no forced dependency upgrade was applied.
- Browser host automation: BLOCKED_EXTERNAL_DEPENDENCY — no usable browser tab/host was available for the required customer UI run.

The branch is not ready to merge until the unverified gates are executed or explicitly accepted as external blockers.
