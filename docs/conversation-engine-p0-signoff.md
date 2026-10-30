# Conversation Engine v2 — approved P0 decisions and sign-off boundaries

**Date:** 2026-10-30 (UAE). **Status:** FIVE PRODUCT DECISIONS APPROVED BY CUSTOMER; detailed technical and provider readiness still must be verified. **Architecture baseline:** merged PR #81. **Work branch:** `feat/conversation-engine-v2`. **Tracker:** [v2 issues](conversation-v2-issue-index.md).

## Locked product decisions (do not ask again)

| ID | Approved user decision | Binding implementation rule | Pending factual verification |
| --- | --- | --- | --- |
| D1 | **Reuse existing Azure GPT deployment** | Private Python agent uses configured Azure OpenAI GPT **model deployment** for planning, tool continuation and persona composition, not the retired saved Foundry Agent. | Confirm resource endpoint, deployment ID, model/tool/Responses API support, secrets and quota; do not fabricate values. |
| D2 | **New v2-only intent catalog contract** | New engine, importer, validator, Admin and runtime accept **schema v2 only**. No v1-only workbook accepted as a v2 document or silent compatibility fallback. | Freeze exact v2 sheet headers/typed schema and reference workbook; audit any v1-to-v2 migration separately. |
| D3 | **Published Zara persona; English only** | ANCFZ sessions use the published/selected Zara persona version and English (`en`) across every customer reply, error and fallback. Other tenants keep their own published personas/languages. | Verify Zara's actual published Admin personaVersionId and approved offline templates. |
| D4 | **First release: seven stages using verified sandbox/mock providers** | First end-to-end acceptance can use **contract-verified local mocks and/or independently verified sandbox providers** with explicit per-stage evidence tiers. No production CRM writes, real charges or legally binding signing required to approve initial release. | Confirm adapter/provider contracts and sandbox/mock availability. |
| D5 | **Company-formation journey finishes after verified Contract stage; registration tracked separately** | Stage 7 completion of the approved contract policy marks **seven-stage journey fulfilled**. Legal company registration is a separate status and must not be claimed without authoritative registry evidence. | Approve signed-contract/mock evidence details and a separate registration tracking/handoff owner. |

## Authority and components

One **Python Conversation Agent** coordinates two logical model responsibilities: **Planning & Intent Engine** and **Natural Persona Composer**. Node runs **Response Guard**, **Session & Conversation Manager**, **Trusted Tool Gateway** and **Workflow & Event Engine** (PostgreSQL, Redis Streams, n8n). Seven logical components are **not** seven independent agents. Python may request approved Node RAG/catalog/requirements/status tools **before** producing the one natural, coherent Zara response. Node validates, persists and controls all side effects.

The ANCFZ sequence remains **Lead Generation → Lead Qualification → Account Creation → Package Selection → Document Upload/SF-02 → Payment Details & Invoice → Contract**, with discovery and knowledge-only conversation **before** Stage 1. CRM Lead capture is not the primary customer goal and is never forced for a knowledge-only visitor.

## Provider/acceptance vocabulary

- **SIMULATED:** deterministic mocked workflow, signed/correlated mock callback and verifiable stored fixture data. Do not call a mocked response a live provider result.
- **SANDBOX VERIFIED:** separately checked record or authenticated callback from an approved sandbox provider.
- **PRODUCTION VERIFIED:** live provider state only with separate explicit authorization.
- **RECONCILIATION / BLOCKED:** no proof; stage remains open.
- **JOURNEY FULFILLED:** all seven published stage-completion gates satisfied, including verified Stage 7 contract according to the selected mock/sandbox test environment.
- **LEGAL REGISTRATION:** independent `legalRegistrationStatus` is pending/unverified until official registration proof exists. Never silently derive it from a completed contract.

For first-release reporting, any mocked stage means **SEVEN_STAGE_SIMULATED**, with every mocked stage named. `SEVEN_STAGE_SANDBOX_VERIFIED` requires independently verified sandbox providers across the whole journey.

## P0 approval boundaries

**Product decisions D1–D5: LOCKED.** Engineering can immediately work on P0 schema/contracts and P1–P4 synthetic fixtures without waiting for absent external providers. **Technical P0 is not complete** until reviewed v2 schemas/workbook, Node/Python contracts, Azure deployment capability verification, test/rollback plan and stage evidence matrix are recorded. The provider-specific details that block P5–P7 are tracked in [ANCFZ business/provider readiness](ancfz-business-provider-readiness.md).

| Gate | Sign-off target | Status |
| --- | --- | --- |
| Architecture and D1–D5 | Customer-approved architecture decisions | **APPROVED** |
| v2-only catalog schema and Admin contract | Reviewed reference workbook/typed JSON, rejection fixtures | **ENGINEERING REVIEW PENDING** |
| Node/Python turn/tool/response/error protocol | Matching TS/Pydantic contracts, CAS and negative tests | **ENGINEERING REVIEW PENDING** |
| Azure GPT deployment capability | Private, authorized sanitized check and quota confirmation | **CONFIG VERIFICATION PENDING** |
| Zara persona publication and English fallback | Actual published persona ID and templates | **TENANT CONFIG PENDING** |
| Stage/business/provider evidence | Approved synthetic/sandbox stage policies and adapters | **INPUTS PENDING** |
| Deployment/rollback | Feature flag, preservation rules, exit-gate validation | **TEST PLAN PENDING** |

**Do not reinterpret approved product decisions because a provider is currently missing.** Preserve historical catalog records, previously applied PostgreSQL migrations, customer data, existing actions/consents and rollback compatibility. Strict v2-only means **new v2 engine inputs only**; it does **not** authorize deleting old active v1 sessions, data or provider state.

## Workflow for implementation and sign-off

See the 43 issue tasks in [issue index](conversation-v2-issue-index.md), and follow [Codex master prompt](codex-v2-master-prompt.md) when starting implementation. Complete each issue using focused tests, audited commit/push, GitHub verification evidence and issue closure. **Final full seven-stage E2E remains a manual-only hold issue #124**, not an automated CI test.

This document records **customer product-level approval**, not an organizational security/legal or provider readiness approval.
