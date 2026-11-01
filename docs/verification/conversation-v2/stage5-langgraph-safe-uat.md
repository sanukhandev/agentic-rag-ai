# Stage 1–5 LangGraph UAT: safe integration notes

Status: **CODE CHANGES COMMITTED; LIVE FIVE-STAGE CONVERSATION NOT ACCEPTED**. The engine defaults to on when the Python gateway/model are configured, but this branch does not merge into `main` or alter the local database.

## Scope / safety boundary

- Branch: `feat/conversation-v2-langgraph-stage5-safe`, based on `feat/conversation-engine-v2`.
- The Python graph is a **per-request bounded model → trusted Node read tool → model** state machine. Node's durable PostgreSQL session, User Intent Document and business action ledger remain authoritative.
- Both `LANGGRAPH_CONVERSATION_ENABLED=true` and `CONVERSATION_ENGINE_V2_ENABLED=true` are defaults. Explicit `false` disables each path. An empty `CONVERSATION_ENGINE_V2_TENANTS` allows all tenants with a configured v2 gateway; set a tenant UUID list to restrict UAT. Consent and workflow action gates remain in Node.
- No new SQL migration, table rewrite, seed, data purge, vector reset, customer replay, Salesforce mutation or n8n activation is introduced.
- No LangGraph checkpoint tables are created. A durable LangGraph checkpointer may be added only after an explicit separate database/schema and retention/privacy review. Do **not** point auto-migrating checkpoint setup at the populated operational database.
- The graph receives masked user content. It cannot invoke arbitrary tools; actual CRM/document writes continue to require Node's existing consent/action gates.
- Empty RAG alone is not a failure: the response guard permits only a deterministic, server-authored missing-evidence dialogue. Generated claims about fees, timelines, eligibility, payment and signing still need verified sources.

## Code changes and risk addressed

1. Fix Python `scopeRef` contract max length (256 → 2048), matching the existing Node signed-tool-scope contract.
2. Fix stateless Responses API tool continuation: replay user message, prior response output including encrypted reasoning items, function-call items and correlated function-call-output items; never use `previous_response_id` with `store=False`.
3. Implement opt-in `LangGraphConversationAgent` with nodes `model` and `trusted_tools`, bounded model requests/tool calls/rounds/deadline, typed fallback and fresh per-turn state.
4. Reject expired tool deadlines server-side before any database read.
5. Add regression tests and an isolated, no-database GitHub PR validation workflow.

## Five-stage target and evidence required

| Stage | Target proof | Current branch status |
|---|---|---|
| 1 Lead Generation | Explicit contact consent + mock Lead ID and idempotency record | Mock provider adapter exists in base branch; **not wired/accepted end-to-end here** |
| 2 Qualification | Verified activity, entity type, visa count, timeline, eligibility | Catalog requirements and qualification validator exist; **full-turn proof outstanding** |
| 3 Account Creation | Explicit confirmation + account linked to original Lead | Mock adapter exists; **full-turn proof outstanding** |
| 4 Package Selection | Approved package/quote selected, price evidenced | Catalog/package adapter exists; **full-turn proof outstanding** |
| 5 Document Collection | Customer is asked for missing doc; authorized upload is stored and linked to correct opportunity; SF-02 transfer remains pending until independently verified | Document intake and SF-02 adapter exist; **full-turn proof outstanding** |

**Document collection is not document-provider completion.** A conversation can reach `document_upload` and collect a file, but must not announce SF-02 success until a verified mock/sandbox attachment result is recorded. Real credentials/documents should not be used for UAT.

## Read-only preflight on your existing local installation

Run from the repository root:

```powershell
git status --short
git fetch origin
git switch --create feat/conversation-v2-langgraph-stage5-safe --track origin/feat/conversation-v2-langgraph-stage5-safe
node --test tools/qa/stage5-preflight.test.mjs
node tools/qa/stage5-preflight.mjs
```

Only switch branches if `git status` is clean; do **not** discard uncommitted changes. The preflight reads a committed *synthetic fixture* and cannot inspect or modify your live tenant's published catalog. It will report `POLICY_DEFINED_ACTIONS_UNREADY` until the enabled stage action bindings are complete. Do not treat that status as permission to conduct live provider writes.

Run isolated Python tests in the new branch (with an existing Python virtual environment or disposable Python container):

```powershell
python -m pip install -r services/model-gateway/requirements-dev.txt
$env:PYTHONPATH="services/model-gateway"
python -m pytest -q services/model-gateway/tests
```

Run Node focused checks:

```powershell
npm ci
npm run typecheck
npx vitest run services/api/src/v2-tool-gateway.test.ts
```

`npm ci` installs lockfile dependencies; it does not intentionally modify runtime database data. No schema migration or `docker compose down -v` is required for these code tests.

## Before turning on the graph with local runtime data

1. **Back up** the existing PostgreSQL database via the running `postgres` container and verify the backup is readable, using a location outside the repository. Never use `down -v`, `docker volume prune`, `DROP`, `TRUNCATE`, a blanket seed/reset or a production customer session during this UAT.
2. Confirm the existing Compose project/service names and the exact UAT tenant UUID. Do not start a second Compose project from a separate worktree and accidentally point it at a different database.
3. Check your current `.env` locally without pasting secrets into tickets. If it still explicitly contains `false`, that overrides the new defaults: update both flags to `true` only once you intend to test the running containers. Both paths require a configured private Python gateway, model deployment and service key.
4. For local UAT, set an approved tenant UUID in `CONVERSATION_ENGINE_V2_TENANTS` to avoid accidentally including every tenant. The flags default to true, but you must select the `docker-compose.python-gpt.yml` overlay and rebuild `api` and `model-gateway` for the new code to take effect. Keep n8n and provider writes disabled unless mock providers are explicitly configured.
5. Capture a fresh synthetic lead/opportunity/session. Verify Stage 1→5 status using stored provider evidence, not just chat text; test a pricing detour, visa-count correction, repeated message ID, pending document upload and restart continuity. With no RAG evidence, the guarded v2 response now uses a clear, factual-claim-free conversational acknowledgment and one relevant question. It never invents pricing, legal rules or provider outcomes.

**Rollback:** revert both feature flags to `false`, restart only `api` and `model-gateway` with the same Compose project and existing volumes. Preserve in-flight actions, callbacks and database records. Never roll back by deleting migrations or dropping data.

## Remaining blockers before Stage 5 UAT can be called achieved

- The current `app.ts` still mixes legacy lead-first orchestration with opt-in v2 text generation, and does not commit structured graph decisions as authoritative stage transitions.
- The trusted Node tool gateway still reads the legacy published catalog and does not fully project the v2 catalog + User Intent Document into stage-scoped tool results.
- The current ANCFZ v2 fixture lacks several enabled stage action bindings; do not enable synthetic adapters against a populated environment until these are reviewed and published for the UAT tenant.
- Tool-produced RAG evidence must be reconciled with the final Node response guard via canonical, independently validated citation IDs.
- An actual public API Stage 1→5 acceptance run with real model calls, consent, mock provider proofs and document upload is still required. Existing final acceptance issue #124 remains on manual hold.

This branch is a **safe conversation runtime increment**, not a claim of full five-stage completion.
