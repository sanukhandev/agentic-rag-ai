# Python conversation-core rewrite — deletion and retention manifest

**Branch:** `refactor/python-conversation-core-v2` created from the latest feature branch. This document records the intended **clean rewrite without destroying working customer/business state**.

## Safe-to-remove legacy runtime after Node provider switch

Foundry Agent SDK client and tests, candidate dispatcher and tool helpers, plus Azure CLI development image/volume are no longer part of the selected **Python GPT-model** path. Remove the old imported modules from the build only after no live references remain. Leave migration `054-foundry-conversation-bindings.sql` in history/schema: applied migrations and existing conversation records must not be deleted; future database cleanup requires a separate forward-only migration and data retention review.

## Keep (risk of deletion until replacement proven)

- `services/api/src/app.ts`: large, legacy chat dispatcher **also** contains critical session ownership, action confirmation and callback code. Do not delete until new modular endpoints provide identical contracts and regression tests.
- `services/api/src/model.ts`: legacy lead-first conversational fallback and shared `ChatModel` interface; retain only as compatibility shim for Node until new structured planner is wired. Explicitly earmarked for a later replacement.
- `services/api/src/intent-catalog.ts`, `intent-journey.ts`, `journey-engine.ts`: existing published catalog/version and stage/identity gates; must migrate to new goal-first catalog-v2 rather than bypass.
- `services/api/src/events.ts`, `event-relay.ts`, `event-bus.ts`, `event-worker.ts`, `actions.ts`: authorized PostgreSQL outbox, Redis Streams, idempotency and provider reconciliation.
- `services/api/src/store-postgres.ts`, `infra/postgres/`, authentication, privacy, file storage, Admin/Next.js routes, package/quote/invoice/contract integrations and historical evidence.
- User-generated `data/` and `artifacts/`: never delete automatically.

## New modules in first atomic slice

- `services/model-gateway/`: private Python GPT Responses API, Pydantic contract, 3 SDK retries, bounded concurrency and service authentication.
- `services/api/src/python-model/chat-model-adapter.ts`: isolated Node provider adapter, **no duplicate retry** or direct n8n/CRM tool execution.
- `docker-compose.python-gpt.yml`: opt-in private Python service overlay.

## Before removing the legacy lead-first handler

Implement a new Node `ConversationCoordinator` that calls Python `/plan`, validates the catalog-based primary Business Goal/turn category, loads the durable per-opportunity User Intent Document, invokes authorized Node RAG/tool reads, composes a grounded answer plus one question, and persists/replays decisions. Migrate chat endpoints behind a safe flag, preserve Admin API, then remove `app.ts` lead-first branches after full stage/CRM/callback tests.

**Current status:** Python model gateway and a compatibility adapter are an **initial slice**, not the full coordinator. Do not claim seven-stage completion, automatic tool calls or enabled provider writes.
