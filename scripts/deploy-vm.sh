#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  printf '%s\n' 'Missing .env. Copy .env.example to .env and add the VM-only connection settings.' >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  printf '%s\n' 'Refusing to deploy with a dirty working tree.' >&2
  exit 1
fi

BRANCH="$(git branch --show-current)"
[[ -n "$BRANCH" ]] || { echo "Detached HEAD is not deployable." >&2; exit 1; }
git pull --ff-only origin "$BRANCH"

# No service list: this deliberately builds every service with a Dockerfile target.
COMPOSE_FILES=(-f docker-compose.yml)
docker compose --env-file .env "${COMPOSE_FILES[@]}" config --quiet
docker compose --env-file .env "${COMPOSE_FILES[@]}" build --pull
docker compose --env-file .env "${COMPOSE_FILES[@]}" up --detach --force-recreate --remove-orphans --wait

printf 'DEPLOYED_COMMIT=%s\n' "$(git rev-parse HEAD)"
docker compose --env-file .env "${COMPOSE_FILES[@]}" ps
