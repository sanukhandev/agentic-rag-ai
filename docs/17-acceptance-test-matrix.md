# Acceptance and negative-test matrix

The system is considered **locally complete** only with automated synthetic fixtures and actual check outputs; real cloud integration readiness is separate and requires approved credentials and environment.

| ID | Scenario | Mandatory result | Suggested test level |
| --- | --- | --- | --- |
| AUTH-01 | Tenant admin sign-in/sign-out/session timeout | Unauthorized routes deny; session revokes | E2E/integration |
| AUTH-02 | Tenant A admin accesses tenant B record by UUID/slug | 403/404; no response body or timing-based info leakage where feasible | Security/integration |
| AUTH-03 | Public visitor calls platform/admin APIs | 401/403 | Integration |
| TEN-01 | Platform admin provisions tenant with unique slug | Tenant and owner established; audit event | Integration/E2E |
| TEN-02 | Suspend tenant | Reject new chat/index/action requests | Integration |
| TEN-03 | Spoof host/header/tenantId in client payload | Tenant cannot be overridden | Security |
| PER-01 | Friendly Arabic/English persona for tenant A | Style/language changes; facts remain source-bound | E2E |
| PER-02 | Persona instructs "ignore rules or search web" | Rejected/sanitized; tenant ACL intact | Security |
| SRC-01 | DOCX with headings, tables | Structured chunks, provenance and citation locator | Worker integration |
| SRC-02 | XLSX with headers/sheets/units/formulas | Correct extracted values or explicit unsafe/unavailable warning; no execution | Worker integration |
| SRC-03 | UTF-8 TXT | Deterministic chunks | Worker integration |
| SRC-04 | Text PDF | Page locators and chunks | Worker integration |
| SRC-05 | Admin-approved HTTPS URL | Fetch snapshot only approved host, provenance tracked | Worker integration |
| SRC-06 | URL to localhost/private IP/metadata or redirect there | Deny; no outbound private request | SSRF security |
| SRC-07 | Unsupported encrypted .doc/.xls/OCR-only PDF | Clear error; not published | Worker integration |
| SRC-08 | Same content/retry twice | Idempotent job/chunk upsert, no active duplicates | Integration |
| SRC-09 | New version fails ingestion | Previous active version remains | Integration |
| SRC-10 | Revoke active source | Immediate retrieval exclusion | Integration |
| RAG-01 | Supported FAQ | Factually supported answer with valid tenant-approved citations | Golden corpus |
| RAG-02 | Unknown price/service/policy | Clear abstention; no invented answer | Golden corpus |
| RAG-03 | Conflicting active sources | Flag contradiction / defer review; never choose arbitrarily | Golden corpus |
| RAG-04 | Tenant B chunk closest vector match | A never receives or cites B | DB + API security |
| RAG-05 | Internal document with valid answer | Anonymous visitor cannot retrieve it | DB + API security |
| RAG-06 | Prompt injection hidden in uploaded file/link | No change to permissions/instructions/tools | Security/golden corpus |
| RAG-07 | Wrong/unknown model-generated citation ID | Reject or safe fallback | Unit/integration |
| RAG-08 | Unsupported requested language and evidence gap | Explain limitations in permitted language; no new facts | Golden corpus |
| PII-01 | Chat includes synthetic name/email/phone | Never appears in Foundry, embedding adapter, n8n or logs | Spy-adapter security |
| PII-02 | Unknown/expired/other-tenant token reference | Never resolves or appears in response | Vault security |
| PII-03 | Allowed scoped recipient token resolution | Rehydration limited to explicit destination/purpose | Vault unit/integration |
| PII-04 | Sensitive file upload | Not embedded until sanitized/approved | Worker security |
| API-01 | Oversized input/rate abuse | Typed 4xx/429, bounded resource use | Integration/security |
| API-02 | Duplicate chat clientMessageId | One durable message processing result | Integration |
| FLOW-01 | No confirmation or unsupported intent | No n8n invocation | Integration |
| FLOW-02 | Confirmed mock action | Exactly one idempotent private call and confirmed result | Integration/E2E |
| FLOW-03 | Callback forged/replayed/wrong tenant | Rejected and audited | Security |
| FLOW-04 | Timeout/unknown workflow result | Never report completed | Integration |
| OPS-01 | Service down/health check outdated | Display observed failure/unknown with timestamp | Integration/E2E |
| OPS-02 | Tenant usage dashboard | Metrics scoped to tenant, no customer PII | Integration/security |
| END-01 | Tenant A onboarding→sources→publish→chat | Local API journey complete, citations correct | API acceptance/manual UI |
| END-02 | A/B with different personas/sources | Both isolated despite guessed IDs / injection | API acceptance/manual UI |
| BUILD-01 | Clean install/bootstrap | Documented commands work | Local clean environment |
| BUILD-02 | Lint/typecheck/unit/integration/build | All runnable defined checks pass | Local gate |
| SEC-01 | Docker exposure and repository secret audit | No public unauthenticated n8n/DB/admin; no leaked secrets | Local gate/ops |
| EXT-01 | Live Azure Chat/Embedding, if configured | Explicit opt-in smoke + cost guard + actual result | Manual/staging |
| EXT-02 | Live n8n private webhook, if configured | Verified authentication, status and replay handling | Manual/staging |

## Local execution record (2026-10-15)

| ID | Evidence and outcome |
| --- | --- |
| AUTH-01 | Pass: `services/api/src/auth.test.ts` covers issue, logout revocation and expired durable sessions; `app.test.ts` covers `/auth/me` current-user resolution and unauthorized access after logout. |
| AUTH-02 | Pass: `services/api/src/app.test.ts` proves tenant A/B source, job, domain, member, workflow, audit and authenticated chat-config isolation. |
| AUTH-03 | Pass: `app.test.ts` denies unauthenticated admin access and public tenant-ID sessions. |
| TEN-01 | Pass: `app.test.ts` provisions two tenants, owners and audited creation. |
| TEN-02 | Pass: `app.test.ts` suspends a tenant and rejects new chat/indexing, then reactivates it. |
| TEN-03 | Pass: tenant scope is resolved from verified auth/slug; guessed cross-tenant IDs return 403/404 in `app.test.ts`. |
| PER-01 | Pass for local persona/language policy: API persona version and language tests; browser style verification remains manual. |
| PER-02 | Pass: unsafe persona text and injected source instructions are rejected/treated as data in `app.test.ts`. |
| SRC-01 | Pass: DOCX extraction preserves headings/tables in `tools/ingestion/test_ingestion.py`; API worker result preserves locators. |
| SRC-02 | Pass: XLSX extraction preserves sheet/header/value structure without formula execution in `test_ingestion.py`. |
| SRC-03 | Pass: deterministic UTF-8 text normalization/chunking in `test_ingestion.py` and API source flow. |
| SRC-04 | Pass: text PDF page locators and OCR-only rejection in `test_ingestion.py`. |
| SRC-05 | Pass: allowlisted HTTPS snapshot and source URL provenance in `test_ingestion.py`; API domain allowlist covered in `app.test.ts`. |
| SRC-06 | Pass locally: private DNS, redirects, non-text responses and DNS-rebinding address changes are rejected by Python tests. |
| SRC-07 | Pass locally: mismatched signatures, macro/path-traversal Office containers, legacy `.doc`/`.xls` and OCR-only PDF inputs fail visibly; bounded decompression limits are enforced and encrypted-parser behavior remains a production parser-policy decision. |
| SRC-08 | Pass: API duplicate content is idempotent; action proposal races recover from PostgreSQL unique conflicts. |
| SRC-09 | Pass: failed reindex test proves the prior active source remains active. |
| SRC-10 | Pass: revoke immediately removes a source from retrieval; purge requires prior revocation. |
| RAG-01 | Pass: deterministic grounded FAQ response with validated citation in `app.test.ts`. |
| RAG-02 | Pass: unsupported question returns abstention without a business claim. |
| RAG-03 | Pass: conflicting evidence refusal in `knowledge.test.ts` and API flow. |
| RAG-04 | Pass: tenant A/B retrieval isolation in API and PostgreSQL query predicates. |
| RAG-05 | Pass: internal evidence is available only to authenticated tenant scope; public session is refused. |
| RAG-06 | Pass: injected source text cannot authorize a workflow. |
| RAG-07 | Pass: invalid citation IDs are discarded and the answer fails closed. |
| RAG-08 | Pass: unsupported language is refused before model invocation. |
| PII-01 | Pass for local adapters: privacy/embedding/model/action spies and persisted chat responses contain no raw synthetic PII; live provider delivery remains blocked. |
| PII-02 | Pass: vault tokens are session-scoped, expire and cannot be resolved from an unknown session. |
| PII-03 | Pass: rehydration is purpose-limited to the assistant response path. |
| PII-04 | Pass locally: source text is sanitized before chunking/embedding and uploaded bytes remain private until worker success. |
| API-01 | Pass: bounded JSON returns 413 and configured abuse bursts return 429. |
| API-02 | Pass: duplicate `clientMessageId` returns the durable response without a second user message; a failed model turn is retryable under the same masked idempotency record. |
| FLOW-01 | Pass: confirmation is required and prompt injection alone produces no action. |
| FLOW-02 | Pass: mock adapter receives exactly one opaque, confirmed action and audit result. |
| FLOW-03 | Pass: forged, wrong-tenant and replayed callbacks are rejected; nonce claims are store-backed. |
| FLOW-04 | Pass: adapter failure becomes `unknown`, never `completed`. |
| OPS-01 | Pass: forced store outage returns timestamped `503/down` health state. |
| OPS-02 | Pass: tenant dashboard/telemetry counters, bounded token estimates and optional configured cost estimate are scoped and redacted; manual dashboard verification remains pending. |
| END-01 | Pass locally: `npm run acceptance:local` completed real TXT/DOCX/XLSX/text-PDF upload→Python worker→publish plus a deterministic approved HTTPS snapshot and grounded public chat; `npm run seed:local` separately covers citation/refusal/confirmed mock action; web/admin browser journey remains manual. |
| END-02 | Pass locally: `npm run seed:local` completed against synthetic tenant A/B with different sources/personas and verified cross-tenant refusal; API tests also cover histories and operations. |
| BUILD-01 | Pass: `npm ci --dry-run`, migrations and documented local commands; `npm run verify:local` provisions/checks the local PostgreSQL-backed path. Hosted GitHub Actions is intentionally not configured. |
| BUILD-02 | Pass locally: `npm run verify:local` completed with Admin 2 + Web 3 + API 53 (including PostgreSQL) + Contracts 3, Python ingestion 16, synthetic five-source acceptance, lint/typecheck/build, and 0 audit vulnerabilities. |
| SEC-01 | Pass for local defaults: `npm run verify:compose` confirms digest-pinned n8n and localhost-only `127.0.0.1:5678`, while `npm run verify:secrets` scans tracked/unignored files for high-confidence leaked credential formats; production remains blocked on authenticated HTTPS ingress, identity and operational controls. |
| EXT-01 | Blocked: live chat smoke was previously observed, but the configured embedding deployment is missing; deterministic embeddings are used locally. |
| EXT-02 | Blocked: live private n8n credentials/environment are unavailable; signed HTTP adapter and mock tests pass. |

## Fixture expectations
Create tenant_a and tenant_b fixture accounts and strictly distinct DOCX/XLSX/TXT/PDF/URL knowledge; include a conflicting FAQ, expired pricing, a malicious 'ignore safety' document and synthetic PII. Use deterministic model/embedding/n8n test doubles that log sanitized calls in memory; never assert real provider success from mocks.

## Proof standard
Each case must map to executable test path and show pass/fail/skip with reason. Local checks passing with a skipped critical security case **does not** satisfy acceptance. Network/cloud test absence is reported as integration **blocked** rather than green. Include migration/backup rehearsal and audited retention test before production approval.
