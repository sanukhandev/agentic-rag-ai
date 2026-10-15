# Developer environment and deployment (local implementation)

## Repository baseline
The root `docker-compose.yml` declares **only an n8n service** with persistent `n8n_data` volume. Local application services are run from npm workspaces, while `infra/docker-compose.dev.yml` runs a private pgvector/PostgreSQL container. This is development infrastructure only; no VM deployment is performed by the repository.

## Intended workstation prerequisites
Git, Docker Engine/Compose, Node.js 22+, npm, Python 3.x with venv, a PostgreSQL client and optional Azure credentials with an approved model deployment.

## Inspecting existing n8n
```sh
docker compose config
docker compose up -d n8n
docker compose ps
docker compose logs --tail=100 n8n
```
**Security:** the present Compose binds the editor to all interfaces over plaintext HTTP with insecure cookies. Use only in a controlled disposable environment with network isolation; before external access or any real customer data, follow docs/06-security-and-privacy.md and replace exposed settings. Do not paste real credentials into screenshots, terminal logs or GitHub issues.

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

The worker copies file inputs into the private staging root for the attempt, extracts from the staged copy, and purges it before sending only sanitized normalized content, chunk hashes and locators. The API revalidates hashes, re-sanitizes chunks and performs embedding before staging the source for approval. Keep the staging directory private and outside any web-served path.

The Angular tenant-admin panel can also queue a TXT, PDF, DOCX or XLSX upload. It is stored by the Node API in `INGESTION_STAGING_ROOT` (default `data/ingestion-staging`) with a generated job key, mode `0600`, and a 5 MiB limit. Run the worker without `--path` or `--url` to retrieve that private input after claiming the job:

```powershell
\.venv\Scripts\python.exe -m ingestion.worker --staging-root .\private-staging --api-base http://localhost:4000 --job-id <job-id> --worker-secret <local-worker-secret>
```

The API deletes the Node-side staged bytes after a successful or idempotent result. Failed jobs remain available for retry; configure a scheduled private-staging retention/purge policy before production.

For public chat channel binding, a tenant administrator saves the exact web origin and enabled state in the **Public chat channel** panel. When enabled, `/api/v1/chat/config` and public session creation require the matching browser `Origin`; disabling the channel rejects public preflight/session requests. Production tenants must configure one.

## Local PostgreSQL backup/restore rehearsal

The local pgvector container supports a schema/data rehearsal without touching the development database: dump `agentic_rag` to a temporary `agentic_rag_restore_check` database, verify the restored tables, then drop only that explicitly named scratch database. Production must use managed encrypted backups, retention and a scheduled restore test.

```powershell
docker compose -f infra/docker-compose.dev.yml exec -T postgres createdb -U agentic agentic_rag_restore_check
docker compose -f infra/docker-compose.dev.yml exec -T postgres pg_dump -U agentic -d agentic_rag --format=plain --no-owner --no-privileges | docker compose -f infra/docker-compose.dev.yml exec -T postgres psql -U agentic -d agentic_rag_restore_check -v ON_ERROR_STOP=1
docker compose -f infra/docker-compose.dev.yml exec -T postgres psql -U agentic -d agentic_rag_restore_check -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
docker compose -f infra/docker-compose.dev.yml exec -T postgres dropdb -U agentic agentic_rag_restore_check
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
