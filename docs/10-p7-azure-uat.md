# 10 — P7 controlled Azure UAT and release gates

**State:** P7 evaluation tooling implemented. **No Azure conversations or production cutover are implied by committing it.**

## Goals and non-negotiable boundaries

P7 measures the P6 candidate against real Azure GPT responses. The new runner uses **30 independent new chat sessions / 64 customer turns** spanning seven categories: greeting (3), knowledge (7), intent (6), ambiguity (4), memory (4), adversarial safety (4) and multilingual (2). It uses `POST /api/v1/chat/candidate/turn`; it NEVER calls a V2 action-confirmation route, creates a CRM lead, uploads a document, updates a knowledge source or changes a migration. The existing V2 route stays active.

The runner is designed for **local Docker Compose and two freshly prepared synthetic staging tenants only**. Both tenant slugs **must start with `p7-`** or `p7_`, IDs must be distinct UUIDs, and the API and database must be reachable only through loopback. **Do not use an existing customer/ANCFZ tenant for this test.** Keep all P6 opt-in flags disabled on production.

## Staging prerequisites

1. Create two distinct synthetic tenants (for example `p7-alpha` and `p7-beta`) in your *local/staging* database via the normal admin setup process. Record their generated tenant UUIDs. Each must be active, allow public chat, and have a published persona and a **published valid Catalog V2**. There must be no external sales, payment, CRM, contract or n8n provider side effects configured for either tenant.
2. In `p7-beta` only, publish an approved **synthetic public** knowledge source containing a unique marker such as `P7-BETA-SYNTHETIC-ONLY-9c4b81dfc911`. This is new synthetic test content, NOT a modification of existing protected production RAG documents, embeddings or sources. Never copy customer content into the test corpus. The runner reads the source and verifies its marker is absent from `p7-alpha`; the marker is not printed in reports.
3. Preserve the normal service credentials, and configure the **local** Compose environment for real Azure usage: `MODEL_MODE=azure`, `AI_PROVIDER=azure`, `AI_MODEL` set to the real deployment, the Azure OpenAI-compatible `AI_BASE_URL` and a private `AI_API_KEY`. Do not put credentials in the test script or Git. `docker compose exec -T model-gateway` is used to independently attest to a non-mock Azure configuration **without printing the key**.
4. Configure the existing gated candidate services **only on this local stack**: `P4_INTERNAL_READS_ENABLED=true`, `P4_GATEWAY_ENABLED=true`, `P5_CANDIDATE_ENABLED=true`, `P6_CANDIDATE_ENABLED=true`, `P6_CANARY_TENANT_IDS=<alpha UUID>,<beta UUID>`. Use independent strong `P4_READ_SCOPE_SECRET`, `P4_EVIDENCE_SIGNING_KEY`, `MODEL_GATEWAY_SERVICE_KEY` and `PII_VAULT_KEY`. Private URL settings must point to the internal Node/Python services. **Do not enable any external business-action dispatch.** You do not need `NEXT_PUBLIC_P6_PREVIEW_ENABLED` for this API test.
5. Use the local-only Compose override (`docker-compose.local.yml`) for loopback PostgreSQL access. Point `P7_AUDIT_DATABASE_URL` to your *local application* database on `127.0.0.1:55432`, **not** the disposable `postgres-p2-test` database. The audit account needs SELECT only on synthetic tenant records and knowledge/business tables. The main application database is never reset. Use URI-encoded credentials.
6. Record the current Git commit and a same-case **read-only V2 baseline** from an isolated environment whose external workflow providers cannot execute. Do **not** simply replay the 30 tests through a production V2 route: it may produce provider side effects. The P7 runner does not invoke V2 automatically. A missing comparable baseline keeps its comparison gates blocked.

## Test commands — Windows PowerShell

From the repository root:

```powershell
npm run p7:validate
npm run p7:dry-run
```

The first command runs Node's built-in test runner; the second prints the frozen suite distribution. Neither invokes Azure or accesses PostgreSQL.

For a controlled live run, configure **process-local** environment variables in your PowerShell session (no secrets should be committed):

```powershell
$env:P7_API_BASE_URL = 'http://127.0.0.1'
$env:P7_ORIGIN = 'http://localhost'
$env:P7_TENANT_SLUG = 'p7-alpha'
$env:P7_TENANT_ID = '<local-alpha-tenant-uuid>'
$env:P7_SECOND_TENANT_SLUG = 'p7-beta'
$env:P7_SECOND_TENANT_ID = '<local-beta-tenant-uuid>'
$env:P7_SECOND_TENANT_SENTINEL = 'P7-BETA-SYNTHETIC-ONLY-9c4b81dfc911'
$env:P7_AUDIT_DATABASE_URL = 'postgres://<readonly-user>:<uri-encoded-password>@127.0.0.1:55432/agentic_rag'
$env:P7_SYNTHETIC_ONLY_ACK = 'YES'
$env:P7_COMMIT_SHA = (git rev-parse HEAD)

# Start only the locally configured stack; inspect service readiness first.
docker compose -f docker-compose.yml -f docker-compose.local.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d postgres redis api model-gateway nginx

npm run p7:azure
```

**Before running `p7:azure`**, review the target tenants and live Azure credentials. The command makes actual, billable Azure model requests. A healthy result requires the local session origin policy to allow the configured `P7_ORIGIN`.

If a model call fails, the runner stops further conversation traffic rather than flooding the provider; it still attempts the after-run database audit and writes a blocked report.

## Artifacts and interpretation

Each live run creates `artifacts/p7-uat/<run-id>/` with:

- `run.json`: sanitized prompts/assistant previews, response codes, citation counts, per-turn latency, model/deployment attestation, security-probe outcomes and **hashes/counts only** for protected database records. Session IDs are digested; session tokens, API keys, private SQL rows and actual secrets are never saved.
- `review-template.json`: **blank** independent human-rating form. Copy to `review.json` and fill every conversation's `accepted` boolean, six 1–5 quality dimensions, critical incident flags, unsupported consequential claim count and reviewer identity.
- `gate.json` and `gate.md`: blocker-by-blocker acceptance matrix; never mark quality passed from HTTP 200 alone.

Re-evaluate after independent review (paths are examples):

```powershell
node scripts/p7-azure-uat.mjs --evaluate 'artifacts/p7-uat/<run-id>/run.json' `
  --review 'artifacts/p7-uat/<run-id>/review.json' `
  --baseline 'artifacts/p7-uat/<v2-readonly-run>/run.json' `
  --baseline-review 'artifacts/p7-uat/<v2-readonly-run>/review.json'
```

**Do not copy the P6 run and label it V2.** A valid baseline must have matching frozen suite checksum, `mode: "v2-read-only"`, all 30 distinct cases, identical Azure model deployment, and actual measured HTTP/WebSocket latencies from the isolated V2 environment. A complete independent V2 human review is also required; candidate quality may not regress versus the baseline. A baseline absent from this run keeps the baseline gate blocked.

## Release matrix / current criteria

| Gate | Initial criterion | Evidence |
| --- | --- | --- |
| Real model | Private gateway attests `AI_PROVIDER=azure`, non-mock and nonempty deployment/key | Sanitized attestation |
| Coverage | 30 separate synthetic conversations and all 64 turns complete | Run report |
| Quality | At least 26/30 (85%) independently accepted, and no lower acceptance rate than the independently reviewed V2 baseline | Complete human rubric, not regex heuristics |
| Grounding | Zero independently confirmed unsupported consequential claims; manual spot-check against current authorized RAG | Human rubric + current citations |
| Cross-tenant | Invalid/replayed cross-tenant credentials and foreign origin denied; Beta synthetic sentinel never returned to Alpha | Four HTTP probes, tenant RAG sentinel and human rubric |
| Unauthorized action | No change to action requests, executions, outbox or CRM lead count/content | Before/after PostgreSQL fingerprints for both tenants |
| Protected RAG | No change to source state/version/title/hashes or chunk text/embedding fingerprints | Database fingerprints for both tenants |
| Regression | Same frozen cases compared with isolated V2 run; initial P95 goal no more than 25% above baseline | Matched baseline + p50/p95 |
| Provider errors | Record per-turn non-200 and timeout; any incomplete case blocks | Machine results |
| Tool/model tokens | Explicitly **not visible** on the current P6 public response | Requires separate private instrumentation; do not invent metrics |
| Seven-stage lifecycle | Verified Node authority, consent, provider correlations, rollback, no duplicate dispatch | **Not yet connected** to fresh P6 canary sessions |
| Production cutover | Separate explicit approval, rollback drill and completed action gates | **Blocked**, even after conversation canary passes |

The report's `conversation_canary_pass` state means **only** the scoped P6 conversation UAT gates have passed; it **never** authorizes merging, external action execution, production rollout or deleting V2.

## Known blockers

- P6 candidate chat does not yet initialize authoritative V2 journey documents or execute the seven-stage business lifecycle for fresh sessions. The trusted reader intentionally fails closed, so this P7 suite evaluates **conversation and advisory quality**, not a full business transaction.
- The P6 API does not expose internal model-call counts, tool-call counts or token usage. Those metrics require reviewed private telemetry before full performance certification.
- Programmatic validation of all claim support requires an independent grounded-content audit. The model-verifier checks and human source review must be evaluated together; citation count alone is **not** proof of accuracy.
- No real Azure result is present until the above commands are actually executed. P7 tests and dry-run do not prove real-provider accuracy.
