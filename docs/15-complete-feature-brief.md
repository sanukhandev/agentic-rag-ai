# Complete feature brief — Agentic RAG AI

Status: **approved project requirements / proposed implementation**, 15 October 2026. Nothing here is evidence that the software has been built. Read root AGENTS.md. The system is a multi-tenant, privacy-first RAG sales assistant; initial delivery is web chat plus a secure Angular admin console. New integrations require explicit scope.

## 1. Product objective and scope
Build one hosted platform where a platform operator can onboard many independent organizations (tenants). Every tenant has separate accounts, settings, approved source knowledge, a configured conversational agent persona, chat sessions, usage metrics, workflows and lifecycle controls. A Next.js chat interface serves website visitors through a Node.js API. All factual answers must be drawn from that tenant's approved corpus and must never assume outside facts, access another tenant's corpus, or disclose restricted organizational information. Python ingests source files and approved URLs into PostgreSQL/pgvector. Azure AI Foundry GPT-4.1-mini drafts answers against evidence; a separate embedding deployment creates vectors. n8n executes only Node-authorized automation.

**RAG, not training or fine-tuning:** "Train" in the user interface means prepare, index, version and publish knowledge embeddings; never fine-tune a model without a separately approved feature.

## 2. Actors and roles
| Role | Boundaries | Main responsibilities |
| --- | --- | --- |
| Platform owner/superadmin | Explicit cross-tenant administration, audited | Create/suspend tenants, provisioning, platform service status and security operations |
| Tenant owner/admin | One or more explicitly assigned tenants only | Manage members, approved sources, persona, channels, tenant usage and workflow requests |
| Tenant editor/operator | Assigned tenant; limited write/read rights | Upload documents, request re-index, review status and conversations only when permitted |
| Tenant viewer | Assigned tenant; read-only subsets | See sanitized operational dashboards and permitted settings |
| Website visitor | A tenant-bound anonymous or authenticated chat session | Ask the configured agent about tenant-approved **public** knowledge |

Use Node-enforced RBAC/ABAC, session auth, credential rotation, admin MFA/SSO decision, secure cookies and auditable changes. Never trust a role, tenantId, sourceId or host header by itself from an untrusted browser.

## 3. Admin app — Angular + Tailwind
**3.1 Sign in/out and session**: login, logout, secure session management, forgotten-password/identity-provider flow once authentication provider is selected, role-based route access, session timeout and unauthorized states. No public self-registration into another organization's workspace.

**3.2 Platform dashboard**: tenants total/active/suspended, Node API health, database/vector retrieval health, Python ingestion worker/queue status, Foundry connectivity check/last successful check (no secrets), private n8n availability, ingestion throughput/failure counts, active chat sessions, conversation volumes, response latency, verified citation/abstention rates, model token/cost estimates, workflow queue outcomes, error trends. Health displayed as observed status with check timestamp, not invented uptime. Limit detail by role, with no raw PII or another tenant's private content.

**3.3 Tenant onboarding and lifecycle**: create organization with immutable tenant ID, unique slug, display name, admin membership/invitation, status (provisioning, active, suspended, archived), locales, public chat enabled flag, approved origin/domain registration, storage and usage quotas, source visibility defaults, retention/config ownership. Prevent activation until minimum policy, initial admin, and resources pass checks. Suspend means deny chats and new ingestion immediately; archive/delete uses reviewed retention/purge process.

**3.4 Tenant workspace**: dashboard, tenant profile, members/roles, knowledge source library, version and approval history, ingestion jobs and errors, agent persona editor, channel configuration, chat testing/playground, redacted analytics, n8n action execution history and audit logs. All app reads/writes via authenticated Node API; no direct DB/n8n/model calls.

**3.5 Agent persona management**: versioned and auditable name, description, greeting, tone, style, formality, default language, allowed languages, optional response length, permitted expressions and unsupported-answer template. Test persona in an isolated preview against same tenant-approved corpus before publishing. Tenant-supplied free-text instructions are constrained and linted; cannot change security, sources, recipient, tool permissions or factuality.

## 4. Sources and ingestion
### Initial supported inputs
| Input | Handling | Explicit limits |
| --- | --- | --- |
| Microsoft Word DOCX | Extract paragraphs, headings and tables with page/section locator where available | Legacy .doc requires a separate safe-conversion adapter/approval; reject macros |
| Microsoft Excel XLSX | Extract sheet names, tabular headers, rows, labels and units | Formula cached result fidelity warning; never execute macros, formulas or external links |
| Plain text TXT | UTF-8 text with encoding detection/rejection rules | Size limit, sanitize control characters |
| PDF | Text-based extraction with pages/tables where feasible | Scanned/image PDFs are reported unsupported/pending OCR unless OCR is implemented and validated |
| Website URL(s) | Admin explicitly submits HTTPS URLs; fetch content through bounded ingestion worker | No arbitrary live web search in chat; strict URL allowlist, redirects/SSRF protection and crawl scopes |

Additional formats (CSV/Markdown may be easy extensions; PPTX, images, OCR and legacy Office) are optional until approved; do not claim "any file" works before adapter tests. Parse safely with file validation, malware scanning, quota, size/time limits and sandboxed libraries. Never execute uploaded content, spreadsheets, macros, HTML scripts or embedded references.

### URL-ingestion policy
Require admin authorization, HTTPS scheme, tenant-approved domains, DNS/IP checks on every redirect and request to block localhost/private/link-local/metadata targets, content-type/size/time/depth caps, robots/terms review, no credential crawling, no default recursive link following, dedupe/canonicalization, capture retrieval timestamp/URL/title/provenance and private staging. Allow explicitly scoped optional same-domain crawling only with a separate bounded feature and source review. A web link becomes an approved **snapshot**; live chat never follows arbitrary user URLs for facts.

### Knowledge lifecycle
Upload/submit URL → validate and quarantine → parse/extract → classify/sanitize sensitive or secret content → normalize text and provenance → deterministic chunks → separate embedding-model call → pgvector upsert under tenant/source/version → quality review → approval/publish → active retrieval. Track pending, processing, review_required, active, failed, retired and revoked states. Immutable versioning; updates don't partially override active knowledge; revoke immediately excludes the source before eventual deletion. Deduplicate by tenant/source/content and processing pipeline fingerprint; show job progress/errors in admin.

**Visibility:** public_for_chat vs internal_admin_only (and finer roles if needed). A visitor receives only approved published public chunks. "Never share data outside the org" means no inter-tenant leakage and no external exposure of internal content. Public visitors necessarily receive knowledge explicitly published as public by the tenant; an organization must approve that publication. Sending selected text to an external Azure-hosted AI/embedding service is a cross-boundary disclosure that must be approved by tenant/data owner, governed by provider privacy terms/region and minimized. Do not promise absolute "data never leaves the organization" with a cloud model; use private hosting if policy forbids any external processing.

## 5. Public web chat — Next.js + React + Tailwind
- Responsive accessible chat page/widget, message list, typing/loading/error/retry, session initialization, citations, source title/location where public, copy/reset, language-aware display and explicit unknown-answer response.
- The chat session binds to a verified tenant deployment/domain or signed embed/config token, **not** an arbitrary client-chosen tenant ID. Anonymous visitor sessions are short-lived and rate-limited; no access to internal docs or dashboard APIs.
- Public bootstrap supplies only published persona name/greeting/languages, tenant-safe branding and opaque chat config; never secrets, raw instructions, private source IDs or admin data.
- User messages are sanitized and PII-masked by Node. Conversation memory is scoped, masked, retention-limited and never shared with another tenant.
- A conversational greeting, simple clarification, or evidence-lack message is allowed without documents. **Every substantive answer about tenant products/services, factual advice, amounts, claims or policies must be directly supported by active approved tenant evidence.** No generic world-fact fallback as a substitute for knowledge; no browser search at response time.
- Cite approved source/version/location. Conflicting/outdated/unavailable evidence → explicitly cannot verify, request clarification or a human-approved next step. Streaming may be added only after an evidence-and-leakage-safe design.

## 6. Backend — Node.js/Express/TypeScript
One server-owned trust boundary: admin auth, tenant resolution, RBAC, session and channel scope, input validation, PII token vault, chat orchestration, retrieval and citation validation, persona config, AI Foundry connector, workflow action gate, source management/jobs and observability. Controllers thin, services modular, SQL parameterized, migrations versioned, runtime schemas strict. Public, admin and internal endpoints separated. All tenant queries scoped before data retrieval; PostgreSQL RLS where feasible plus testable application authorization.

### Conversation pipeline
Resolve tenant+audience → validate/rate-limit → mask identifiers → retrieve permitted current chunks with tenant+ACL predicates → build bounded evidence and tenant's constrained persona → call GPT-4.1-mini → validate citation IDs and claim/evidence sufficiency → classify optional action intent → Node policy/consent check → authenticated n8n call only if authorized → permitted token rehydration to correct recipient → redacted audit/output. No source or insufficient evidence means no factual answer.

## 7. Agent personalities
Per-tenant persona is **presentation**, never knowledge, authority or permission:
- Fields: personaId/version, name, welcomeMessage, defaultLanguage, allowedLanguages, tone (professional/friendly/etc.), formality, style guidance, responseLength, forbidden phrases where policy permits, empty-evidence message, active/draft.
- Priority: immutable platform/security/grounding rules > tenant source access and published factual evidence > constrained tenant persona > end-user style preference. Tenant input cannot impersonate system instructions or enable tools/out-of-scope content.
- Requested/allowed language changes expression only: if source evidence is in English and tenant allows Arabic, translation may rephrase only the same verifiable facts, retain identifiers/amounts and citations, and explicitly abstain if fidelity is uncertain.
- Change history, authorized publishing, validation and rollback required.

## 8. PII/privacy and integrations
Detect and replace customer identifiers with opaque session/tenant-scoped tokens before model/embedding calls; encrypted reversible mappings reside in restricted Node/PG vault, not general chat logs, n8n or vector chunks. Restore only a verified allowed token for the same session/purpose/recipient at Node's final boundary. Prevent cross-tenant reidentification. Minimize source content sent to Azure and obtain data-processing approvals. n8n receives validated, minimal payload/opaque refs and cannot bypass permission, evidence or recipient checks. Real external communications/CRM lead capture require explicit consent, configured destination and confirmed workflow completion.

## 9. Operational and security requirements
Dev/staging/prod isolation, HTTPS, secure cookies, safe env/secret management, locked dependencies/containers, DB backups/restore, source and vault encryption, API and admin abuse throttling, CSRF/CORS controls, workload health checks, alerting, PII-free logs, bounded retries, tenant quotas, admin audit, deletion policy and prompt injection/SSRF/IDOR tests. Existing publicly bound HTTP n8n Compose is not deployable as-is for production.

## 10. Minimum viable journey
1. Platform admin signs in and creates organization A; creates admin account and configures domain.
2. Admin A logs in; configures agent "Ava", friendly English+Arabic style and welcome text.
3. Admin A uploads a DOCX, XLSX, TXT, text-based PDF and approves a permitted HTTPS page; sees five source indexing status records.
4. After verifying extraction and approving source versions for public chat, admin A publishes corpus and persona.
5. Visitor on A's chat page asks supported question → accurate cited response in allowed language.
6. Visitor asks unsupported or another tenant's question → no invented facts, no cross-org disclosure.
7. Tenant B is onboarded with separate documents/persona; A's visitor and admin cannot access B knowledge, including by ID guessing, chat prompt injection or query manipulation.
8. Admin sees accurate tenant metrics/jobs and platform operator sees authorized aggregate platform status.
9. Optional approved intent triggers a mock private n8n action exactly once after confirmation; do not assert CRM/live external integration yet.

## 11. MVP acceptance (must be automated)
- Tenant A/B isolation in SQL, API, vector retrieval, source/file storage, persona, telemetry, chat history, tokens and n8n actions.
- Admin authentication and role boundaries; platform admin separate from tenant admins; no public access to admin APIs.
- Every supported format produces auditable extractable chunks; unsupported/unsafe formats fail visibly. URL SSRF blocked even across redirects/rebinding.
- Knowledge revocation removes answerability immediately. Conflicts, unknown topics and missing citations abstain.
- Multilingual persona stays within evidence and authorized language policy.
- PII absent from LLM/n8n call payloads, embeddings and logs; rehydration only after scoped authorization.
- End-to-end sample tenant onboarding→published sources→chat response→dashboard monitoring validated against a synthetic fixture.
- System deployability and tests verified, not assumed; external Azure/n8n live tests are separately marked blocked until real credentials are available.

## 12. Explicit exclusions / pending decisions
No fine-tuning; no unbounded web crawler/search; no arbitrary uploaded code execution; no internal document publishing by default; no automated external messaging without consent; no unapproved CRM. Decide tenant URL binding/auth, cloud processing region and consent, admin SSO, initial file limits, embeddings model/dimensions, database RLS layout, URL crawl policy, and SLOs through documented ADRs.
