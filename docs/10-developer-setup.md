# Developer environment and deployment (planned)

## Repository baseline
As of 15 Oct 2026 the root docker-compose.yml declares **only an n8n service** with persistent n8n_data volume. It does not launch Node, PostgreSQL, pgvector, Next.js, Angular, Python worker or AI Foundry emulator. Do not invent a one-command full-stack start sequence.

## Intended workstation prerequisites
Git, Docker Engine/Compose, a supported Node.js LTS, an agreed JS workspace package manager (TBD), Python 3.x with venv, a PostgreSQL client and Azure credentials with an approved model deployment. Version pinning, scripts and package manager will be chosen in the bootstrap task; don't assume any are installed by this repository.

## Inspecting existing n8n
```sh
docker compose config
docker compose up -d n8n
docker compose ps
docker compose logs --tail=100 n8n
```
**Security:** the present Compose binds the editor to all interfaces over plaintext HTTP with insecure cookies. Use only in a controlled disposable environment with network isolation; before external access or any real customer data, follow docs/06-security-and-privacy.md and replace exposed settings. Do not paste real credentials into screenshots, terminal logs or GitHub issues.

## Python venv convention (when ingestion folder exists)
```sh
cd tools/ingestion
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```
requirements.txt is **not present yet**; the command is illustrative and will work only after the ingestion bootstrap. Ignore .venv in git.

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
