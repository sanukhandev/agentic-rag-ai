# Security, privacy and PII tokenization

## Mandatory invariant
**Azure AI Foundry and n8n must not receive plaintext customer information by default.** Node is the trusted privacy gateway. Encryption, tokenization and masking are different mechanisms; use them together where needed. Only a correctly authenticated/authorized Node process can re-identify an allowed token for a specific response, channel and purpose.

Omnichannel clients must use a tenant/channel credential issued by the authenticated admin API. Node stores the credential secret encrypted, verifies a five-minute HMAC timestamp window and one-time nonce, resolves tenant scope from the credential, and then applies the same session, PII, intent and workflow controls as web chat. HTTPS remains mandatory for any non-local deployment.

## Customer-data lifecycle
1. At the ingress boundary identify customer PII and secrets (names, email, telephone, address, account identifiers, free-text disclosures). Treat detectors as fallible; augment pattern-based rules with classification and blocked categories.
2. Assign high-entropy opaque placeholders such as [PERSON_1], [EMAIL_1] or protected random tokens **scoped to a tenant, session, audience and TTL**. Collision/replay cannot cross sessions. Do not encode the original value in a token or use unsalted hashes as reversible pseudonyms.
3. Persist original values encrypted at rest using app-level envelope encryption / managed KMS where feasible; separate key access and DB role from retrieval/ingestion roles. Encrypt backups. Rotate and audit keys.
4. Persist token map in a protected table with purpose, owner/session, authorized recipients, expiration and deletion state. Keep mappings out of model calls, embeddings, application metrics and n8n.
5. Send only masked language, approved knowledge excerpts and minimal policy context to Azure. Remove secrets from ingestion corpus before embedding.
6. Before returning a generated message, validate token references against that exact authorized session; reject unknown, cross-tenant or maliciously fabricated placeholders. Resolve only tokens approved for the recipient and channel. For an action, resolve only within Node's secure adapter when the destination genuinely requires original information and consent/contract permits.
7. On TTL/retention expiry delete mappings, original details and linked copies as required by policy. Deletion also applies to backups under retention controls.

**Important limitation:** tokenization does not automatically eliminate every indirect identifier. Free-text context, uploaded documents, query embeddings, citations, analytics and model-provider settings must be reviewed for residual re-identification risk.

## Threat model and controls
| Threat | Required control |
| --- | --- |
| Prompt injection in files/chat | Treat retrieved content as data; fixed system policy, sanitized tools, output/evidence gate |
| Hallucinated business facts | Citation/source version enforcement and no-evidence refusal |
| Cross-tenant leak | Server-resolved tenant, DB row-level policy where appropriate, SQL filters, tests |
| LLM leaks customer identity | Pre-model masking, restricted context, telemetry redaction, leak tests |
| Token forgery/reuse | Cryptographically random placeholders, scoped TTL, allowlisted rehydration |
| Unauthorized workflow | Node allowlist, RBAC/ABAC, confirmation, independent policy checks |
| n8n webhook abuse | Private network, TLS, signed requests/service auth, allowlisted origin and minimal payload |
| Malicious uploads | File magic/size limits, scan, no macro execution, parser sandbox and quotas |
| Secrets in git/logs | Env secret manager, secret scanning, no credential output, rotation |
| Repeated action/replay | Signed/authenticated callbacks, durable idempotency and audit |
| SSRF via document URLs | No arbitrary file/resource fetching; outbound egress allowlist |
| Supply chain compromise | Lockfiles, dependency audits, pinned images, automated scanning |

## Master Compose — deployment defaults
The shared `docker-compose.yml` keeps PostgreSQL, Redis, n8n and the application services on the private Compose network. The `docker-compose.vm-dev.yml` and `docker-compose.local-dev.yml` overlays publish only the required ingress/data ports: VM Nginx on the configured application port, or loopback-only Nginx/PostgreSQL/Redis for local development. Local bind mounts under `data/` preserve state across image rebuilds. The example environment uses localhost HTTP and `N8N_SECURE_COOKIE=false` because it has no TLS. These defaults are not a production security baseline.

Before a public or real-customer rollout:
- Keep the default private bind; for controlled staging, put n8n behind an authenticated HTTPS reverse proxy before changing the bind address.
- Enable TLS, secure cookies, strong user auth/access control, workflow credential vault and restricted administrative access.
- Set correct public HTTPS editor/webhook URLs if needed, enforce webhook authentication, IP/rate limits and network controls.
- Pin a tested n8n image version; back up n8n_data securely; restrict container permissions and egress.
- Rotate any previously exposed workflow credentials, inspect historical access, and review provider/network policy.
- Do not allow the model or browser to call the n8n editor directly.

## Identity, consent and governance
Separate visitor session, authenticated customer and admin identities. The server resolves tenant claims; anonymous visitors have only temporary scoped session capabilities. CRM mutation, outreach, bookings or sharing customer details requires clear business purpose, consent/other lawful basis, correct destination and audit; no silent blanket consent. Adopt jurisdiction-specific privacy review, DPA, retention schedule, cross-border data-transfer policy and model-provider data-processing configuration before launch.

## Access and operational rules
Use service-specific DB roles: application records, knowledge search, ingestion write, token vault and migrations; do not share superuser credentials. Encrypt internal traffic and backups; validate CORS/CSRF, sessions, rate limits and admin MFA. Audit access to reversible mappings (who/why/when), but audit **metadata**, never plaintext values. Security incident runbooks must support revocation, quarantine, notification and safe rollback.

## Go-live blockers
Public HTTP n8n, missing auth, unsecured key management, absence of tests for prompt injection/cross-tenant leaks/token rehydration, unapproved model data region, unreviewed PII in embeddings, and missing source ACL enforcement are launch blockers.

## Multi-tenant publication and external processing clarification
Enforce strict cross-organization isolation for sources, files, vectors, session history, personas, analytics, token vault and actions. Tenant-scoped authentication and SQL/pgvector/RLS guardrails apply even when IDs are guessed or prompts are malicious. Classify sources as explicit `public_for_chat` or internal; only published public content is returned to outside website visitors. Internal material may not be exposed outside its authorized organization.

Azure AI Foundry and separate embedding deployments are external processing boundaries unless hosted within an approved organizational environment. Sending permitted source excerpts to a cloud model **does transmit content to a processor**; implement tenant-level processing approval, appropriate agreements, region and minimization, or choose private/local models if org policy truly forbids external transmission. Never assert absolute non-disclosure with a cloud dependency. Source URLs must be independently validated against SSRF, malicious redirects and private-network addresses on every request.
