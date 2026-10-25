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

git switch main
git pull --ff-only origin main

# No service list: this deliberately builds every service with a Dockerfile target.
docker compose --env-file .env config --quiet
docker compose --env-file .env build --pull --no-cache
docker compose --env-file .env up --detach --force-recreate --remove-orphans --wait

printf 'DEPLOYED_COMMIT=%s\n' "$(git rev-parse HEAD)"
docker compose --env-file .env ps
