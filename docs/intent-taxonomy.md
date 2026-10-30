# Intent taxonomy — customer outcome first, workflow actions second

**Status: TARGET design, not yet implemented.** Applies to **every tenant's published catalog**. ANCFZ is the acceptance tenant, not a code-level rule. The catalog may define different goals, services, prompts, stages, requirements and actions per tenant.

## Distinguish three fundamentally different objects

1. **Primary business goal** (`businessGoalKey`): a durable customer objective such as company formation. A customer confirms this goal; it anchors the opportunity and remains active across questions and stages.
2. **Turn intent** (`turnIntentCategory` + `turnIntentKey`): what the customer is trying to do **on this turn**. A knowledge question, correction, document offer or status request must not replace the business goal.
3. **Execution capability** (`toolKey` / `workflowKey`): an authorized operation attached to a confirmed goal and fulfilled requirements. **CRM lead capture is a capability**, not the default business goal or universal intent.

## Six meaningful categories

| Category | Semantic meaning | Examples of tenant-defined intent keys (illustrative) | Conversation behavior |
| --- | --- | --- | --- |
| **Business Goal** (`business_goal`) | The outcome the customer seeks; belongs to a durable opportunity | `business.company_formation`, `business.visa_support`, `business.license_renewal` | Keep one confirmed primary goal; pursue configured stages until completion or explicit stop |
| **Knowledge & Advisory** (`knowledge_advisory`) | Information or comparison rather than a commitment to transact | `knowledge.license_options`, `knowledge.setup_costs` | Answer only with approved RAG and citations; ask a relevant advisory or active-goal follow-up; never assume CRM consent |
| **Qualification & Requirement** (`qualification_requirement`) | Collect or clarify facts, eligibility, evidence and documents required for a goal | `requirement.business_activity`, `requirement.visa_count`, `requirement.identity_documents` | Extract known facts, request the **single most informative missing requirement**, validate and update the goal |
| **Service Execution** (`service_execution`) | Customer request to perform an eligible business operation | `service.quote_request`, `service.application_submission` | Plan approved ToolBinding; Node checks stage, confirmation, consent, idempotency and external provider evidence |
| **Service Status & Support** (`service_status_support`) | Retrieve progress, amend an authorized request or handle an operational issue | `status.application`, `support.missing_document` | Retrieve authoritative status; continue original goal without a new opportunity |
| **Conversation Navigation** (`conversation_navigation`) | Affirm, deny, correct, pause, resume, switch goals, finish or request a human | `navigation.correct_fact`, `navigation.switch_goal`, `navigation.finish` | Adjust context/pending question safely; do not misclassify "yes" as permission for unrelated actions |

**Category versus entity:** Not every turn creates a new business goal. A user may ask three knowledge questions, correct a visa count and submit a document while still pursuing one company-formation goal. Requirement intents and Service Execution intents are **supporting activities**, not automatically new primary goals. In particular, `lead.capture` / Salesforce Lead creation is a catalog-triggered CRM action when authorized, never a universal primary intent.

## How ANCFZ maps to the taxonomy

- **Primary goal:** customer wants to establish a company; model recognizes and confirms the catalog business goal once, unless the user requests a meaningful switch.
- **Knowledge intent:** customer asks about setup costs, activities, visas, documents or regulations; retrieve and answer from approved ANCFZ knowledge.
- **Requirement intent:** model identifies missing activity, entity type, count, timeline, contact or documentation based on catalog-defined prerequisites and previously provided information.
- **Execution intent:** model proposes the next catalog-authorized operation (Lead creation, Account creation, quote, SF-02 upload, invoice, contract), which Node gates separately.
- **Status intent:** answer "Is my application submitted?" from backend/provider-confirmed state, not model memory.
- **Navigation intent:** correct four visas to three, switch from one service to another, stop, resume or ask for a human.

The seven ANCFZ lifecycle stages are **the configured fulfillment path for a company-formation goal**; they are not seven mutually competing primary intents. Different business goals may have shorter or completely different fulfillment paths.

## Catalog contract (proposed additions, not present implementation)

Keep existing `Intents`, `Signals`, `Slots`, `Relations`, `WorkflowBindings`, `JourneyRequirements`, `JourneyTransitions`, `BusinessStages`, `DocumentPolicies` and current admin publication checks. Evolve safely with validated additive columns/sheets or a canonical normalized JSON schema:

- `IntentCategories`: controlled category enum and version; category-to-business-goal relationship.
- `BusinessGoals`: `goalKey`, display label, supported outcome, scope and completion criteria.
- `IntentSignals`: phrases, keywords, semantic descriptions, exclusions, optional synonyms and their **catalog-approved weight ranges**.
- `RequirementPolicies`: `goalKey`, required fact/document/clarification, validation, source-of-truth, collection strategy, optionality, permitted stage and dependency.
- `ToolBindings`: `goalKey`, `stageKey`, action and n8n registry, required facts, user consent/confirmation, provider callback and verified completion condition.
- `FollowUpPolicies`: informative/advisory follow-up rules, escalation/opt-out, completion question and one-question cap.
- `ScoringPolicies`: threshold definitions, score dimensions, ambiguity margin, tunable model weight ranges, evaluation/calibration version.

**Do not require every intent to collect personal information, documents, a quotation or a CRM Lead.** The published catalog specifies which goal or action needs each item and why.

## Distinguish intent completion from lead creation

An intent is **fully satisfied** when its catalog-defined customer outcome is met (or a knowledge-only question has been answered appropriately), not merely when an ActionRequest or Salesforce Lead is created.

- For knowledge-only interactions: answer with evidence; optionally ask whether the customer wants further help; no forced lead collection.
- For an active business goal: follow configured requirements, verified operations and stage gates; CRM capture is only one conditional step.
- For an external-action blocker: show pending/reconciliation status and offer a legitimate next action; do not claim the goal completed.
- For a completed goal: summarize verified results, ask **"Is there anything else I can help you with?"** once, and if the user asks for another service create a new goal/opportunity only after clarification.

Never retain a false requirement merely to extend the chat or increase lead counts.
