# Intent Catalog v2 — strict replacement-only executable contract

**Status:** P0 schema proposal guided by approved D2; exact headers to be frozen through GitHub issue #84 before runtime implementation. **Conversation Engine v2 accepts only new schema v2.** Existing v1 importer may remain isolated for legacy read/rollback but is never a fallback import format for v2. No silent coercion.

## Contract and safe transition

1. Require explicit `schemaVersion=2` in `CatalogManifest`. Reject v1, unversioned, unknown executable policy and unsafe workbook content at the v2 import boundary.
2. A new strict **v2 parser, JSON validator, Admin preview/publish, export and runtime** must preserve every executable policy or fail. No version 1 sheet mapping automatically activated.
3. Keep v1 catalog versions, applied migrations, historical CRM documents, active v1 sessions and consent/action relationships readable throughout audited cutover. Optional v1→v2 conversion creates only a **reviewed candidate**, never an automatically published catalog.
4. A v2 publication is immutable, tenant-scoped, version/hash-pinned and requires authorized Admin approval. Workflow registry paths and secrets remain server-side; workbook values are logical binding keys, not arbitrary URLs.
5. Validate missing/orphan keys, stage dependency cycles, evidence policy, score ranges, tool argument schemas, persona references, source ACL and unknown executable fields. No enabled side-effect binding without authorized provider registry and completion rule.

## Proposed v2 worksheet registry (P0 freeze candidate)

| Sheet | Required policy fields | Validation purpose |
| --- | --- | --- |
| `README` | key, value | Human-facing data provenance |
| `CatalogManifest` | schemaVersion, catalogKey, tenantScope, revision, policyVersion | Exact v2 identity, tenant binding |
| `BusinessGoals` | businessGoalKey, name, description, active, confirmationRequired, completionPolicyKey | Customer outcome, not CRM workflow |
| `IntentCategories` | categoryKey, name, active | Six allowed supporting turn categories |
| `TurnIntents` | turnIntentKey, categoryKey, businessGoalKey, active | Per-turn purposes without primary-goal reset |
| `IntentSignals` | signalId, targetKey, signalType, value, language, weight and adjustment bounds | Explainable, bounded adaptive scores |
| `ScoringPolicies` | scoringPolicyKey, businessGoalKey, threshold, ambiguityMargin, policyVersion | Not fake probability; distinguish uncertainty |
| `RequirementPolicies` | requirementKey, goalKey, **stageKey**, type, required, dependencies, validation, sourceOfTruth | Prevent later-stage requirements blocking earlier stages |
| `BusinessStages` | businessGoalKey, stageKey, stageOrder, entryRequirements, completionEvidencePolicyKey | Ordered deterministic stage machine |
| `ToolBindings` | toolKey, goalKey, stageKey, sideEffectClass, argumentsSchemaRef, requiredKeys, consent, confirmation, registryKey, enabled | Allowed read or externally gated write |
| `WorkflowBindings` | workflowKey, registryKey, providerType, payloadSchemaRef, callbackSchemaRef, evidencePolicyKey, enabled | No raw credential or webhook URL |
| `FollowUpPolicies` | policyKey, goalKey, stageKey, requirementKey, priority, noQuestionReasons | One relevant question when appropriate |
| `KnowledgeTopics` | topicKey, goalKey, sourceScope, citationRequired, active | Approved RAG evidence |
| `PersonaPolicies` | personaPolicyKey, personaVersionId, permittedLanguages, fallbackTemplateRef, enabled | References Admin-published tenant persona; cannot override it |
| `DocumentPolicies` | policyKey, goalKey, stageKey, docType, required, mimeTypes, reviewPolicy, retentionClass, enabled | Secure upload/SF-02 attachment and OCR |

This is a **proposed** 15-sheet schema; issue #84 must approve canonical column naming, list serialization, relation and completion evidence representation. Changes to these details after freezing require schema versioning and tests. Knowledge-only tenants can use appropriately empty stage/tool sheets. Required sheets must have valid headers even if no rows. Only documented optional extension sheets are accepted.

**Six categories:** `business_goal`, `knowledge_advisory`, `qualification_requirement`, `service_execution`, `service_status_support`, `conversation_navigation`. **Example ANCFZ stage keys:** `lead_generation`, `lead_qualification`, `account_creation`, `package_selection`, `document_upload`, `payment_invoice`, `contract`. These are **tenant catalog data**, not generic source-code branching.

## Publication test and stage/consent invariants

- Valid reference ANCFZ v2 workbook imports, previews, publishes to test scope, exports and reimports without losing executable semantics.
- A v1 workbook never passes v2 importer. Unknown policy sheets/fields cannot be silently dropped.
- Stage-5 documents do not block Stage-1 lead; legal registration is tracked separately from Stage-7 contract completion.
- User knowledge-only questions require no CRM Lead or unnecessary PII capture.
- Model confidence and adaptive weights cannot grant action consent. Goal confirmation ≠ action consent.
- Missing/disabled provider registry bindings are not advertised to GPT and cannot dispatch side effects.
- Inactive remote n8n test endpoints stay inactive until intentionally configured and validated.
- Two tenants sharing the same logical goal key cannot access each other's RAG/source/persona/workflow records.

## P0 completion inputs

Canonical v2 JSON schema and Pydantic/TypeScript types, reference workbook with headers, invalid fixture suite, importer/export round-trip, explicit old→new migration mapping, immutable version/pin and Admin publication authorization need engineering validation. **A decision to use v2-only does not mean the schema is already implemented.**
