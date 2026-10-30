# Proposed monorepo and engineering conventions

**No app packages exist in the repository yet.** Adopt this structure as components are implemented; do not generate boilerplate or package lockfiles in a documentation task.

```text
/
  AGENTS.md
  readme.md
  docker-compose.yml            # shared stack definition
  docker-compose.local-dev.yml  # Docker Desktop + Azure CLI local entrypoint
  docker-compose.vm-dev.yml     # VM development entrypoint
  apps/
    web/                       # Next.js / React / TS / Tailwind
    admin/                     # Angular / TS / Tailwind
  services/
    api/                       # Express / TypeScript
  tools/
    ingestion/                 # Python venv tooling
  packages/
    contracts/                 # pure schemas/generated API types where useful
    config/                    # optional repo-wide tooling presets
  infra/                       # database migrations and static admin server config
  docs/
```

## Layer responsibilities
- **Next.js**: render chat UI, maintain client session UX, handle optimistic status safely, consume backend API only. Never call model, vault, DB or n8n from browser, client bundles, or public env vars. Server-side Next routes (if used) proxy only and do not duplicate auth policy.
- **Angular**: secured admin UX for source ingestion, indexing status, review, access rules, workflow observability and approved settings. UI checks are usability only; Node enforces authorization.
- **Express**: API transport and auth middleware; domain services for chat, knowledge, intent, privacy and actions; typed repositories and external adapters; structured errors and audit.
- **Python**: separate isolated process with requirements lock, typed extraction adapters, repeatable parser/version metadata, retryable ingestion, integration tests and temp-file cleanup.
- **packages/contracts**: versioned REST JSON Schema/OpenAPI as canonical interface; generate typed clients rather than coupling Angular to Next internal types.

## Backend module proposal
Routes/controllers → application services → domain/policy layer → adapters (database, embeddings, AI, n8n, cryptographic vault). Separate identity/masking from grounding logic. No controller writes to vector tables directly. Prefer dependency injection for model, clock, DB, and action gateway.

## Development rules
- TypeScript strict, explicit types at boundaries; validate inbound and generated JSON at runtime (e.g., Zod or JSON Schema—decision pending).
- Version API at /api/v1; make breaking changes via a new version or explicit migration.
- Use PostgreSQL parameterized queries, transactions, migration scripts, database roles, indexes and explain plans; never string-concatenate SQL or use a model to write executable SQL.
- Python uses a checked-in lockfile or pinned dependency set when created; do not commit venv/, downloaded customer documents or generated embeddings.
- Pin deployable Docker image versions instead of floating :latest in production; do not auto-apply irreversible migrations.
- Define code style, package manager and CI commands when the application bootstrap task occurs; do not misrepresent uncreated scripts as executable.
- Feature branches and PR review recommended; atomic commits and documented verification expected.

## Shared contracts
Use stable IDs (UUID/ULID by project decision), UTC timestamps, machine-readable error codes, request IDs, idempotency keys, pagination and tenant context resolved from server auth. Keep server DB entities distinct from public DTOs. Never expose raw vector rows, embedding payloads or vault tokens via admin/client APIs.

## Agent task boundaries
Scope changes to a feature; do not redesign all apps or expose new internet listeners without explicit request. Update docs/13-decisions-and-open-questions.md when selecting previously TBD infrastructure, auth, embeddings, storage, secrets, message transport or retention.
