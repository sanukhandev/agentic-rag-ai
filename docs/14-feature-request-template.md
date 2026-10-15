# Feature implementation prompt template

Use this template in a new coding agent task. Replace placeholders and include relevant docs. An agent must inspect repository reality first and must not scaffold unrelated features.

## Prompt

**Feature:** [precise task title]

**User story and outcome:** [who needs it, what observable behavior changes and why]

**Repository context:** Read root AGENTS.md, docs/02-system-architecture.md, docs/06-security-and-privacy.md, and relevant feature docs. Inspect existing files/tests/config. Distinguish implemented behavior from planned guidance.

**Scope — must implement:** [UI/API/worker/migration/flow features, explicit acceptance]

**Scope — must not modify:** [unrelated files, protected configs, visual behavior, business data]

**Data and authority:** [tenant/role, approved source versions, content format, customer PII class, retention, consent]

**Interfaces:** [exact route/DTO/event names, error semantics, idempotency/trace]

**RAG rule:** company/product/service claims must cite approved active tenant-authorized sources; do not guess. Document the unsupported-evidence behavior.

**Privacy rule:** no raw customer PII in prompts, embeddings, n8n or diagnostics. Any reversible rehydration stays behind authorized Node control and is tested.

**n8n rule:** only if specified, invoke registered private authenticated action with minimal validated payload; never model/browser direct calls.

**Acceptance tests:** [happy path, no evidence, cross tenant, injection, leakage, duplicate event, timeout, access denied, parser edge]

**Verification commands:** [existing repo build/typecheck/lint/test commands; do not invent]

**Deliverables:** smallest cohesive code changes, migrations/contracts/tests, docs/ADR updates, summary of changed paths, actual verification and limitations.

## Agent completion report format
1. Implemented behavior (with paths)
2. Validation/tests executed and real results
3. Security/PII and source-grounding behavior checked
4. Migration/configuration/deployment implications
5. Remaining unknowns or explicit blockers

## Mandatory stop conditions
Request a decision rather than fabricate customer policies, price/service data, legal basis, real integration credentials, embedding dimensions, token rehydration recipients, production domains or unauthorized workflows. Do not claim that actions ran if tools/credentials are unavailable.

## Multi-tenant feature requirements
Include explicit persona version, audience scope (`public_for_chat` vs internal), affected tenant, authorized roles, and whether data is permitted to reach Azure. For source features, require DOCX/XLSX/TXT/PDF/URL-specific fixtures and malformed/SSRF tests. For dashboard features, require Node-only metrics APIs and tenant-isolated redacted output. Refer to docs/15-complete-feature-brief.md, docs/16-autonomous-codex-execution-plan.md, and docs/17-acceptance-test-matrix.md.
