# Developer environment and deployment (local implementation)

## Repository baseline
The root `docker-compose.yml` is the single local stack: PostgreSQL/pgvector, Redis, n8n, the API, Next web, Angular admin and the opt-in ingestion image. Persistent data stays under `data/`, and service bindings are localhost-only by default. This is development infrastructure only; no VM deployment is performed by the repository.

## Intended workstation prerequisites
Git, Docker Engine/Compose, Node.js 22+, npm, Python 3.x with venv, a PostgreSQL client and optional Azure credentials with an approved model deployment.

## Starting the master Compose stack
```sh
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 api web admin redis postgres
```
**Security:** the default Compose binding is localhost-only plaintext HTTP with insecure cookies because it is a disposable local development profile. If a controlled staging reverse proxy is intentionally configured, override `N8N_BIND_ADDRESS`, `N8N_HOST`, `N8N_PROTOCOL`, `N8N_EDITOR_BASE_URL`, `N8N_WEBHOOK_URL` and `N8N_SECURE_COOKIE` explicitly; direct public HTTP exposure is not a production configuration. Do not paste real credentials into screenshots, terminal logs or GitHub issues.

## Python venv convention
```sh
cd tools/ingestion
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```
The pinned requirements are in `tools/ingestion/requirements.txt`; `.venv` is ignored by Git.

To submit a parsed file to a queued API job, run the worker from the ingestion directory after the tenant admin creates a job:

```powershell
\.venv\Scripts\python.exe -m ingestion.worker --path .\faq.docx --staging-root .\private-staging --api-base http://localhost:4000 --job-id <job-id> --worker-secret <local-worker-secret>
```

For an approved HTTPS snapshot, create a queued `text/html` job and run:

```powershell
\.venv\Scripts\python.exe -m ingestion.worker --url https://approved.example/faq --title "Approved FAQ" --allowed-host approved.example --api-base http://localhost:4000 --job-id <job-id> --worker-secret <local-worker-secret>
```

The worker claims path/URL jobs before fetching or extracting, copies file inputs into the private staging root for the attempt, extracts from the staged copy, and purges it before sending only sanitized normalized content, chunk hashes and locators. The API revalidates hashes, re-sanitizes chunks and performs embedding before staging the source for approval. Keep the staging directory private and outside any web-served path.

The Angular tenant-admin panel can also queue a TXT, Markdown, CSV, JSON, JSONL, PDF, DOCX, XLSX or ZIP upload. A ZIP bundle may contain those supported file types and is indexed as one tenant source with file-name locators on its chunks. The API validates the archive signature and stores it in `INGESTION_STAGING_ROOT` (default `data/ingestion-staging`) with a generated job key, mode `0600`, and a 20 MiB compressed limit. The Python worker applies bounded extraction, rejects unsafe paths, duplicates, nested archives, macros, unsupported members and oversized contents, then sanitizes and embeds each extracted file. The aggregate normalized content limit is 1,000,000 characters. Run the worker without `--path` or `--url` to retrieve that private input after claiming the job:

```powershell
\.venv\Scripts\python.exe -m ingestion.worker --staging-root .\private-staging --api-base http://localhost:4000 --job-id <job-id> --worker-secret <local-worker-secret>
```

The API deletes the Node-side staged bytes after a successful or idempotent result. Failed jobs remain available for retry; configure a scheduled private-staging retention/purge policy before production.

## Redis cache

Start the local cache with `docker compose up -d redis`. Set `REDIS_URL=redis://127.0.0.1:6379` in the ignored local `.env` before starting the API. The API keeps a bounded in-process LRU fallback and fails open when Redis is unavailable. Redis stores only masked, tenant/session/client-message-scoped response entries; passwords, bearer tokens, authorization sessions and reversible PII mappings are never cached. Production requires authenticated TLS Redis, restricted network access, encryption/backup policy and an explicit eviction/retention policy.

## Repeatable local verification

After starting and migrating the private PostgreSQL container and creating the pinned Python venv, run the complete local gate from the repository root:

```powershell
npm run db:up
npm run db:migrate
tools/ingestion/.venv/Scripts/python.exe -m pip install -r tools/ingestion/requirements.txt
npm run verify:local
```

`verify:local` requires the local venv, defaults `DATABASE_URL` to the private development database when it is not already set, runs lint/typecheck, the compose security-default and high-confidence repository secret checks, the PostgreSQL-backed workspace tests, production builds, the dependency audit, the clean-room acceptance journey and all Python ingestion tests. It does not start or deploy any VM service. The secret audit scans tracked and unignored files for private-key headers, common provider-token formats and populated local secret assignments; it is not a substitute for a production secret manager or provider-side scanning.

To run the clean-room synthetic tenant A/B journey, use `npm run acceptance:seed`; it starts and stops a disposable local API, publishes isolated FAQ sources and personas, checks cited and unsupported answers, verifies a cross-tenant refusal, and confirms the mock workflow twice with one completed result. Against an already-running API, `npm run seed:local` performs the same checks; set `SEED_API_URL` or the `SEED_*` credential variables to override local defaults and never use real credentials.

For the clean-room ingestion/API acceptance journey, run `npm run acceptance:local`. It starts a disposable in-memory API, generates real TXT/DOCX/XLSX/text-PDF fixtures, uploads and processes them through the Python worker, processes an approved HTTPS snapshot with a deterministic HTTP double, publishes all five sources and verifies grounded public chat. The harness stops the API and removes its scratch staging directory when finished.

For public chat channel binding, a tenant administrator saves the exact web origin and enabled state in the **Public chat channel** panel. When enabled, `/api/v1/chat/config` and public session creation require the matching browser `Origin`; disabling the channel rejects public preflight/session requests. Production tenants must configure one.

## Local PostgreSQL backup/restore rehearsal

The local pgvector container supports a schema/data rehearsal without touching the development database: dump `agentic_rag` to a temporary `agentic_rag_restore_check` database, verify the restored tables, then drop only that explicitly named scratch database. Production must use managed encrypted backups, retention and a scheduled restore test.

```powershell
docker compose exec -T postgres createdb -U agentic agentic_rag_restore_check
docker compose exec -T postgres pg_dump -U agentic -d agentic_rag --format=plain --no-owner --no-privileges | docker compose exec -T postgres psql -U agentic -d agentic_rag_restore_check -v ON_ERROR_STOP=1
docker compose exec -T postgres psql -U agentic -d agentic_rag_restore_check -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
docker compose exec -T postgres dropdb -U agentic agentic_rag_restore_check
```

## Proposed environment contract (names TBD until implementation)
| Secret/config family | Consumer | Handling |
| --- | --- | --- |
| DATABASE_URL / separate role DSNs | Node and worker | Secret manager or gitignored env; TLS |
| AZURE_AI_ENDPOINT, AZURE_AI_CHAT_DEPLOYMENT, API_VERSION | Node | Server only; verify specific Foundry route |
| AZURE_AI_EMBEDDING_DEPLOYMENT / dimensions | Python / retrieval adapter | Separate deployment and versioned index |
| AZURE_CREDENTIAL / managed identity | Node / worker | Prefer managed identity; do not check in keys |
| PII_KMS_KEY_ID / vault key identity | Node privacy module only | Managed KMS/HSM and documented rotation |
| N8N_INTERNAL_URL / service auth | Node | Private endpoint, authenticated requests |
| SESSION_SIGNING_KEYS / admin identity configuration | Node | Secret store; strong random values |
| LOG_LEVEL / tracing / permitted origins | All relevant services | Redacted non-secret configuration |

No real IPs, tenant IDs, credentials, encryption keys or webhook secrets in docs, client env, source control or sample output. A future .env.example should contain only non-sensitive placeholders.

## Suggested deployment topology
HTTPS ingress/reverse proxy → Next web and Node API. Angular admin behind separate authenticated access. Node/worker privately connect to PostgreSQL; pgvector extension enabled on approved DB; n8n private behind signed HTTPS gateway; Azure Foundry over approved network/identity. Provide backups, rotation, audit retention, health checks, tested restore and separated dev/staging/prod.

## Deployment readiness gate
No real customer traffic until TLS everywhere relevant, protected n8n access, identity/authorization, PII isolation, model deployment data-region approval, backup restore, dependency vulnerability checks, logging redaction and adversarial AI tests pass.
# Supporting document OCR

The ingestion image installs Tesseract English and Arabic language data plus the Python OCR dependencies. The API and ingestion worker share the private `./data/supporting-documents` volume. Set `N8N_INTERNAL_URL=http://n8n:5678` for local dispatch; leave the catalog OCR binding inactive until the imported workflow is reviewed and activated.

Uploaded documents use the existing bounded JSON upload pattern, require explicit visitor consent, are type/signature checked, and are never served as public static files. The API masks OCR output before storing it and composes CRM summaries from masked conversation and OCR excerpts.
