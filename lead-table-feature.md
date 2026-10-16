# Future intent and lead-workflow model

Status: planning only. This document defines the future Excel-driven intent model. No database migration, Excel importer, API, admin UI, or n8n workflow changes are included yet.

## Goal

Allow each organization to configure business intents such as `lead.capture`, `appointment.request`, or `support.ticket` using a reviewed Excel workbook. The chat should use the published intent version to:

1. identify a likely intent from the current message and recent conversation;
2. collect only the fields required by that intent;
3. ask a clarifying question when confidence is ambiguous;
4. require confirmation before a side effect;
5. resolve the intent to a server-approved workflow;
6. send a masked, tenant-scoped payload to n8n; and
7. record the intent version, matched signals, score and workflow outcome for audit and improvement.

The LLM may help classify a masked message, but it must never select an arbitrary webhook or bypass Node authorization.

## Planned conversation flow

```text
User message + last N messages
        |
        v
Normalize text and extract non-sensitive signals
        |
        v
Load tenant-published intent version
        |
        v
Score candidate intents and apply exclusions/relationships
        |
  +-----+------+----------------+
  |            |                |
High score   Ambiguous       No match
  |            |                |
Collect      Clarify         Normal RAG
slots        intent           response
  |
  v
Validate fields + score + consent
  |
  v
Ask confirmation
  |
  v
Node resolves approved workflow key -> n8n -> CRM/workflow result
```

The existing lead flow remains the reference experience:

```text
service/demo/meeting request
  -> ask for name
  -> ask for email or phone
  -> confirm submission
  -> validate and insert CRM lead
  -> summarize the masked conversation
```

## Excel workbook contract

Use one versioned workbook with separate sheets. A flat sheet may be accepted later as an import convenience, but separate sheets prevent repeated workflow and slot data from becoming inconsistent.

### `Intents` sheet

One row per intent.

| Column | Required | Example | Purpose |
|---|---:|---|---|
| `intent_key` | yes | `lead.capture` | Stable machine identifier; lowercase dot notation |
| `display_name` | yes | `Request a service` | Admin and conversation label |
| `description` | yes | `Visitor wants the team to contact them` | Classification context |
| `category` | yes | `sales` | Reporting and grouping |
| `workflow_key` | yes | `crm.lead.create` | Server-side workflow registry key |
| `minimum_score` | yes | `70` | Minimum score before proposal |
| `confidence_threshold` | yes | `0.80` | Minimum classifier confidence |
| `confirmation_required` | yes | `true` | Must be true for side effects |
| `active` | yes | `true` | Whether this row can be published |
| `priority` | yes | `100` | Tie-breaker after score |
| `version_note` | no | `Initial service lead flow` | Human change description |

### `Signals` sheet

One row per keyword, phrase or exclusion. Do not put multiple comma-separated values in one cell.

| Column | Required | Example | Purpose |
|---|---:|---|---|
| `intent_key` | yes | `lead.capture` | Parent intent |
| `signal_id` | yes | `lead-service-001` | Stable row identifier |
| `signal_type` | yes | `phrase` | `keyword`, `phrase`, `entity`, or `exclusion` |
| `value` | yes | `arrange a meeting` | Text to match after normalization |
| `language` | yes | `en` | Language family; use `*` only for language-neutral signals |
| `match_mode` | yes | `exact_phrase` | `token`, `exact_phrase`, or bounded `contains` |
| `weight` | yes | `35` | Contribution to candidate score |
| `relation_group` | no | `meeting_request` | Signals that should be evaluated together |
| `notes` | no | `Requires contact intent, not an info question` | Review guidance |

Example signals:

| intent_key | signal_type | value | weight |
|---|---|---|---:|
| `lead.capture` | phrase | `i would like to get a service` | 40 |
| `lead.capture` | phrase | `arrange a meeting` | 40 |
| `lead.capture` | keyword | `interested` | 15 |
| `lead.capture` | keyword | `hire` | 25 |
| `lead.capture` | exclusion | `what services do you offer` | -50 |

### `Slots` sheet

One row per piece of information the conversation must collect.

| Column | Required | Example | Purpose |
|---|---:|---|---|
| `intent_key` | yes | `lead.capture` | Parent intent |
| `slot_key` | yes | `name` | Stable field name |
| `data_type` | yes | `person_name` | `person_name`, `email`, `phone`, `date`, `text` |
| `required` | yes | `true` | Whether the workflow can proceed without it |
| `alternative_group` | no | `contact` | Use `email OR phone` when values share a group |
| `collection_order` | yes | `1` | Follow-up order |
| `prompt_key` | yes | `lead.ask_name` | Server-owned safe prompt template |
| `validation_rule` | yes | `token:NAME` | Validation identifier, not executable code |
| `retention_class` | yes | `crm_contact` | Retention and privacy policy reference |

For the current lead flow:

| slot_key | required | alternative_group | order |
|---|---:|---|---:|
| `name` | true |  | 1 |
| `email` | false | `contact` | 2 |
| `phone` | false | `contact` | 2 |

### `Relations` sheet

This sheet models co-occurrence and disambiguation. It is not a replacement for the primary intent score.

| Column | Required | Example | Purpose |
|---|---:|---|---|
| `source_intent` | yes | `lead.capture` | Candidate intent |
| `related_intent` | yes | `appointment.request` | Related candidate |
| `relation_type` | yes | `supports` | `supports`, `refines`, `conflicts`, or `requires` |
| `trigger_group` | yes | `meeting_request` | Shared signal group |
| `score_adjustment` | yes | `15` | Bounded bonus or penalty |
| `minimum_cooccurrence` | yes | `2` | Number of related signals required |
| `clarification_prompt_key` | no | `intent.clarify_meeting_or_service` | Prompt for ambiguity |

Example: “I want a service and can we arrange a meeting?” may support both `lead.capture` and `appointment.request`. The system should not silently choose the higher score if both are materially different; it should ask which outcome the user wants.

### `WorkflowBindings` sheet

This is an input to review, not an unrestricted routing table.

| Column | Required | Example | Purpose |
|---|---:|---|---|
| `workflow_key` | yes | `crm.lead.create` | Stable server registry key |
| `n8n_workflow_id` | no | `local-managed-id` | Environment-specific reference |
| `webhook_path` | yes | `lead-capture` | Must match a server allowlist |
| `payload_contract` | yes | `crm-lead-v1` | Versioned masked payload shape |
| `side_effect_class` | yes | `crm_write` | Risk and approval policy |
| `active` | yes | `true` | Deployment switch |

The workbook must not contain secrets, bearer tokens, raw customer data, arbitrary URLs, JavaScript, SQL, or executable n8n expressions.

## Proposed normalized database model

The Excel workbook should be imported into normalized, versioned tables rather than queried at runtime.

```sql
intent_catalog_versions
-----------------------
id, tenant_id, version, status, source_file_hash,
created_by, created_at, published_at

intent_definitions
------------------
id, catalog_version_id, intent_key, display_name,
description, category, priority, minimum_score,
confidence_threshold, confirmation_required, active

intent_signals
--------------
id, intent_definition_id, signal_type, value,
language, match_mode, weight, relation_group

intent_slots
------------
id, intent_definition_id, slot_key, data_type,
required, alternative_group, collection_order,
prompt_key, validation_rule, retention_class

intent_relations
----------------
id, catalog_version_id, source_intent_key,
related_intent_key, relation_type, trigger_group,
score_adjustment, minimum_cooccurrence,
clarification_prompt_key

intent_workflow_bindings
------------------------
id, catalog_version_id, intent_key, workflow_key,
payload_contract, active
```

Use a global catalog (`tenant_id IS NULL`) for shared defaults and an optional tenant catalog for overrides. Resolve tenant version first, then fall back to the published global version. Never mix rows from different catalog versions in one decision.

## Intent resolution rules

1. Normalize case, punctuation, whitespace and common Unicode variants.
2. Match phrases before individual keywords.
3. Prefer exact phrases over bounded keyword matches.
4. Apply exclusions and negation checks before adding positive scores.
5. Add bounded relation bonuses only when the required signals co-occur in the current message or configured context window.
6. Keep the top candidate and runner-up for audit and clarification.
7. Use confidence bands:
   - `high`: meets threshold and has a safe margin over runner-up; continue slot collection;
   - `medium`: ask a clarifying question; do not create an action;
   - `low`: answer normally or abstain; do not trigger a workflow.
8. Treat informational questions differently from requests. “What services do you offer?” should not create a lead; “I want to get your service” should.
9. Require all mandatory slots, minimum score, tenant policy and explicit confirmation before side effects.
10. Revalidate the published catalog version during confirmation so a stale proposal cannot execute against changed routing rules.

Persist decision metadata without raw PII:

```json
{
  "catalogVersion": 3,
  "candidateIntent": "lead.capture",
  "confidence": 0.91,
  "matchedSignalIds": ["lead-service-001", "lead-meeting-002"],
  "excludedSignalIds": [],
  "runnerUp": "appointment.request",
  "score": 82,
  "missingSlots": ["name", "contact"],
  "workflowKey": "crm.lead.create"
}
```

## Excel import and publishing plan

### Phase 1 — Define and validate the template

- Create a downloadable workbook template from the sheet contracts above.
- Validate required columns, data types, enum values, duplicate IDs and stable intent keys.
- Reject formulas, macros, external links, hidden executable content and oversized workbooks.
- Reject unknown workflow keys, webhook paths, prompt keys and validation rules.
- Produce row-level errors without partially publishing data.

### Phase 2 — Import into a draft catalog

- Store the original file hash and uploader audit record.
- Load rows into a draft catalog version.
- Detect duplicate phrases across intents, conflicting weights, unreachable intents and missing slots.
- Provide a dry-run report showing example utterances, matched intent, score and runner-up.

### Phase 3 — Review and publish

- Require tenant-admin or platform-admin approval.
- Publish atomically as one catalog version.
- Keep the prior version available for rollback.
- Make new chat sessions use the published version; existing sessions keep their pinned version where applicable.

### Phase 4 — Observe and improve

- Record accepted, clarified, rejected and manually corrected classifications.
- Track false positives, false negatives, clarification rate, workflow completion and abandoned slot collection.
- Export anonymized examples for review; never export raw PII from chat logs.
- Change weights and phrases through a new version instead of editing production rows in place.

## Workflow execution contract

Node resolves `workflow_key` from the published catalog and the server registry. It sends n8n:

```json
{
  "intent": "lead.capture",
  "catalogVersion": 3,
  "workflowKey": "crm.lead.create",
  "tenantId": "server-derived-tenant-id",
  "sessionId": "authorized-session-id",
  "actionId": "idempotent-action-id",
  "score": 82,
  "validationPass": true,
  "slots": {
    "name": "[NAME_1]",
    "email": "[EMAIL_1]"
  },
  "conversation": "masked conversation JSON"
}
```

n8n must validate the intent, catalog version, workflow key, tenant/session relationship, score, required slots and idempotency key before calling the internal CRM API. n8n must not resolve raw PII or choose another workflow.

## Acceptance scenarios for the future feature

- “I would like to get a service” identifies `lead.capture` and asks for the name.
- “Can we arrange a meeting?” identifies `appointment.request` or asks a clarification question when both service and appointment intents are configured.
- “What services do you offer?” remains an informational RAG question.
- A keyword in a negated sentence does not trigger a workflow.
- An unknown workflow key fails import validation.
- A tenant cannot use another tenant’s catalog version.
- A draft catalog never affects live chat.
- A published version can be rolled back atomically.
- A confirmed action cannot execute after its catalog version is disabled.
- The n8n payload contains masked values only.
- Duplicate confirmation produces one CRM record.

## Explicitly not implemented yet

- No Excel file has been uploaded or processed.
- No `intent_*` tables or migration have been created.
- No intent catalog API or admin UI exists.
- No workflow registry expansion has been made.
- No new n8n workflows have been created.
- No automated training, fuzzy matching or LLM fine-tuning is planned for the first version.
