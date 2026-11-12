# Local Docker Compose (Windows / Docker Desktop)

This guide uses the existing single-file stack with an **optional local-only override**. Keep production on `docker-compose.yml` alone. Do not deploy `docker-compose.local.yml` on a public host.

## Initial setup (PowerShell)

```powershell
git switch refactor/clean-architecture-rebuild
git pull --ff-only origin refactor/clean-architecture-rebuild
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Set all required secrets in `.env` (never commit the file). Use a dedicated value for `P2_TEST_POSTGRES_PASSWORD`. Set `AI_PROVIDER` and the corresponding model URL/deployment/API key for actual model turns; the gateway needs a configured provider to serve chat. For a Windows port-80 conflict, set `APP_HOST_PORT=8080` and `PUBLIC_ORIGIN=http://localhost:8080` together.

## Run the local application stack

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.local.yml ps
```

Nginx is available at `http://localhost` by default (or your configured `APP_HOST_PORT`); Admin uses `/admin/` and n8n uses `/n8n/`. Application PostgreSQL binds to **127.0.0.1:55432** for host tools only. Redis, the Python gateway and all other services remain internal to Docker. Run `npm run verify:compose` for canonical defaults and `npm run verify:compose:local` to check the local override's network and volume boundaries.

The P2 conversation core is **not wired to the production chat route** by this Compose change. The existing V2 coordinator continues to handle live chat.

## P2: disposable PostgreSQL integration database

The test service uses its **own named volume**, runs the existing SQL initialization scripts on a fresh volume, and does not share `./data/postgres` with your application. It is opt-in and has a separate 127.0.0.1 port.

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile p2-test up -d postgres-p2-test
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile p2-test ps postgres-p2-test
```

Ensure the service is **healthy** and its SQL initialization logs contain no errors:

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile p2-test logs --tail=100 postgres-p2-test
```

Then run the existing integration test from the repository root. Replace `<value-from-your-env>` with the real `P2_TEST_POSTGRES_PASSWORD` in your untracked `.env` (URL encoding matters if the password has reserved characters).

```powershell
$encoded = [uri]::EscapeDataString("<value-from-your-env>")
$env:P2_TEST_DATABASE_URL = "postgres://agentic_p2:${encoded}@127.0.0.1:55433/agentic_rag_p2_test"
cd services/api
npx vitest run src/conversation-core/tests/postgres-integration.test.ts
cd ../..
Remove-Item Env:P2_TEST_DATABASE_URL
```

**Important:** Running the integration test with `P2_TEST_DATABASE_URL` pointing to an existing customer or application database is prohibited. The test includes local-host and `test`-database-name checks; they are safeguards, not a substitute for an isolated database.

## Shutdown and data preservation

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml stop
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile p2-test stop postgres-p2-test
```

Never use `docker compose down -v`, `docker volume prune`, or delete `./data/postgres` for this work. The application PostgreSQL data, RAG sources, embeddings and customer session data must remain untouched.
