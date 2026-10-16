# Agentic RAG AI

## Local Development Environment — Clean Baseline

This document records the verified local environment following a successful test-data reset. The environment retains only the accounts required for platform administration and n8n access.

> **Security notice:** This document contains **local development credentials**. Keep it in a private, access-controlled location. Do not commit it to a public repository or reuse these passwords in staging or production. Replace plaintext credentials with secret-manager or environment-based references before sharing.

## 1. Environment Status

| Check | Status | Details |
| --- | --- | --- |
| Local data reset | Complete | Existing test data was flushed successfully. |
| Platform administrator | Retained | One admin account. |
| n8n users | Retained | One owner and two members. |
| Tenant data | Empty | No tenants exist. |
| Knowledge sources | Empty | No sources remain. |
| Customer conversations | Empty | No sessions or messages remain. |
| Automation data | Empty | No actions or workflows remain. |
| Service health | Passed | All checked services returned HTTP `200`. |
| VM deployment | Not performed | Changes are limited to the local environment. |

## 2. Local Access Credentials

### Platform Administration

| Service | URL | Username | Password | Role |
| --- | --- | --- | --- | --- |
| Admin dashboard | [http://127.0.0.1:4200/](http://127.0.0.1:4200/) | `admin@techcarrot.ae` | `techCarrot@2026` | Platform admin |

### n8n Workflow Automation

**n8n URL:** [http://127.0.0.1:5678/](http://127.0.0.1:5678/)

| Account | Username | Password | Role |
| --- | --- | --- | --- |
| Owner | `admin@techcarrot.ae` | `techCarrot@2026` | Owner |
| Member 1 | `user1@techcarrot.ae` | `techCarrot@2026` | Member |
| Member 2 | `user2@techcarrot.ae` | `techCarrot@2026` | Member |

### PostgreSQL

| Configuration | Value |
| --- | --- |
| Host | `127.0.0.1` |
| Port | `54329` |
| Username | `agentic` |
| Password | `agentic_local_only` |
| Scope | Local development only |

## 3. Application and API Endpoints

| Service | Local URL | Purpose |
| --- | --- | --- |
| Admin dashboard | [http://127.0.0.1:4200/](http://127.0.0.1:4200/) | Platform administration and tenant onboarding |
| Customer web app | [http://127.0.0.1:3000/](http://127.0.0.1:3000/) | Customer-facing chat interface |
| Backend API | [http://127.0.0.1:4000/](http://127.0.0.1:4000/) | Application API |
| Liveness check | [http://127.0.0.1:4000/api/v1/health/live](http://127.0.0.1:4000/api/v1/health/live) | API process health |
| Readiness check | [http://127.0.0.1:4000/api/v1/health/ready](http://127.0.0.1:4000/api/v1/health/ready) | API dependency/readiness health |
| n8n | [http://127.0.0.1:5678/](http://127.0.0.1:5678/) | Workflow automation |

**Validation result:** All services checked during the local reset returned HTTP `200`.

## 4. Retained Integration Capabilities

The following implementation remains in the repository, despite the local-data reset:

- Backend-authorized n8n connection
- Signed callbacks
- Confirmation handling
- Idempotency safeguards
- Workflow audit functionality
- Workflow-run dashboard

These capabilities are **retained in code**, but their presence does not imply that workflow definitions or test runs have been recreated.

## 5. Reset Scope

The following data was removed from the local environment:

- Tenants and associated knowledge sources
- Chat sessions and messages
- Actions and workflows

**Intentionally preserved:** Platform administrator account and three n8n accounts (one owner, two members).

**Not performed:** VM deployment or creation of new workflow definitions. The environment was deliberately left in a login-only baseline state.

## 6. Next Steps

1. Sign in to the [admin dashboard](http://127.0.0.1:4200/) using the platform administrator account.
2. Create the first tenant and configure its basic settings.
3. Onboard knowledge sources and complete their ingestion/vectorization workflow when available.
4. Open the [customer web app](http://127.0.0.1:3000/) to validate tenant-specific chat behavior.
5. Create or restore n8n workflow definitions only when workflow testing is required.
6. Revalidate API health and workflow integration after introducing new tenant data.

## 7. Known Limitation

The customer chat has **no tenant configured** in the current clean baseline. Consequently, it will remain empty until a tenant is created and configured through the admin dashboard.

---

**Environment:** Local development (`127.0.0.1`)  
**Baseline:** Login-only, no tenant or workflow data  
**Deployment status:** Local validation completed; VM deployment not performed