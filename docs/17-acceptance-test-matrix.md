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
| END-01 | Tenant A onboarding→sources→publish→chat | E2E complete, citations correct | E2E |
| END-02 | A/B with different personas/sources | Both isolated despite guessed IDs / injection | E2E |
| BUILD-01 | Clean install/bootstrap | Documented commands work | CI clean environment |
| BUILD-02 | Lint/typecheck/unit/integration/build | All runnable defined checks pass | CI |
| SEC-01 | Docker exposure and repository secret audit | No public unauthenticated n8n/DB/admin; no leaked secrets | CI/ops |
| EXT-01 | Live Azure Chat/Embedding, if configured | Explicit opt-in smoke + cost guard + actual result | Manual/staging |
| EXT-02 | Live n8n private webhook, if configured | Verified authentication, status and replay handling | Manual/staging |

## Fixture expectations
Create tenant_a and tenant_b fixture accounts and strictly distinct DOCX/XLSX/TXT/PDF/URL knowledge; include a conflicting FAQ, expired pricing, a malicious 'ignore safety' document and synthetic PII. Use deterministic model/embedding/n8n test doubles that log sanitized calls in memory; never assert real provider success from mocks.

## Proof standard
Each case must map to executable test path and show pass/fail/skip with reason. CI passing with a skipped critical security case **does not** satisfy acceptance. Network/cloud test absence is reported as integration **blocked** rather than green. Include migration/backup rehearsal and audited retention test before production approval.
