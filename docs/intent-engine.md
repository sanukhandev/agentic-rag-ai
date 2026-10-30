# Intent engine — LLM-led, catalog-grounded goal recognition

**Conversation Engine v2 alignment:** the Python Planning & Intent Engine is logical component 2 within **one** agent runtime. It may propose signal-specific evidence adjustments but cannot commit catalog scores, stage transitions, verified facts or actions; Node re-evaluates proposals using pinned catalog policies. Confidence, requirement coverage and action readiness are independent. Define typed proposals using [versioned contracts](conversation-engine-contracts.md) and implement them after [P1 catalog v2 and P2 durable state](conversation-engine-delivery-plan.md). The customer receives only a final approved persona-composed reply, not scoring metadata.

**Status: TARGET.** The existing `services/api/src/intent-catalog.ts` uses weighted string matches, deterministic confidence and continuity heuristics. This spec defines the replacement **conversation-planner-assisted** reasoning design. Read [intent taxonomy](intent-taxonomy.md) and [conversation planner](conversation-planner.md) first.

## Primary principle

**An intent is not synonymous with capturing a CRM Lead.** The persistent object is the **customer's business goal** (e.g., company setup). On each customer turn the LLM also classifies the **turn intent category** (knowledge, requirement, service operation, status, navigation). These can coexist without switching the primary goal. Creating a CRM Lead is only one catalog-approved side-effect capability when prerequisites and consent are satisfied.

## Inputs to each substantive turn

- Latest user text and bounded sanitized history; exact current pending question and customer replies.
- Persisted versioned **User Intent Document**: goal status, confirmed/unconfirmed/alternative candidates, per-turn evidence, validated facts, corrections, known answers, remaining requirements, stage, workflow/action status, and concise conversation summary.
- Published catalog digest scoped to the tenant: `BusinessGoals`, `IntentCategories`, `Intents`, `Signals` (phrases/keywords/exclusions), `Relations`, `Requirements`, `BusinessStages`, `ToolBindings`, user-visible prompts and completion criteria.
- Approved RAG topics/citations and provider status **only after authorized retrieval**, never arbitrary model knowledge.
- Model task/prompt/policy/catalog versions and runtime budget.

## LLM-driven per-turn cycle

1. **Understand** the message in context. Distinguish a direct answer to the pending question, a new question, correction, opt-out, status check, new goal or request for action.
2. **Classify turn intent category** from the six-category taxonomy. Knowledge/advisory or requirement sub-intents normally do not replace the current business goal.
3. **Rank goal candidates** by interpreting catalog phrase/keyword matches, exclusions, customer wording and running summary. LLM proposes which signals matter and optional bounded weight adjustments, with evidence spans and uncertainty. Node recomputes and validates score bounds and membership in the pinned catalog.
4. **Assess three axes separately**: (a) semantic identification confidence in one goal, (b) verified requirements coverage, (c) deterministic action readiness. Score changes per turn, including new facts, corrections, priorities and exclusions. Track top-two ambiguity margin.
5. **Select next move**. No goal → clarify; strong candidate → explicitly confirm goal; goal confirmed → answer knowledge or ask the highest-value missing requirement; action ready → propose catalog tool and separate confirmation; provider pending → report actual status; goal fully achieved → summarize and ask if more help needed.
6. **Normalize query for RAG** when useful, preserving negation, prices/visa counts, dates and verified facts. Retrieve evidence and answer from approved sources; then ask one purposeful follow-up. Do not invent facts or pretend a missing document was submitted.
7. **Persist** accepted decision, candidate weight evidence, LLM summary, turn category, fact provenance, pending question, cache status and action reference. Use revision-aware transaction and append-only assessment.
8. **Continue context** across interruptions, replies such as "yes", corrections, n8n callbacks and restarts without re-asking already fulfilled requirements.

## Example score model — adapt to evidence, not fake probability

For each catalog goal candidate persist:
- `catalogSignalEvidence`: matched phrase/keyword IDs, negated/excluded signals and positive/negative reasoning.
- `llmProposedWeights`: contextual relative importance per published signal, **bounded by `ScoringPolicies`**; include reason tied to actual user words.
- `effectiveEvidenceScore`: Node-validated and normalized selection ranking; cannot invent signal IDs or exceed catalog bounds.
- `semanticConfidenceBand` and `ambiguityMargin`: require calibration against labeled tenant examples. Model self-rated confidence is only a hint, not a probability.
- `requirementCoverage`: separately evaluated verified slots/documents/approval coverage.
- `actionEligible`: separate Boolean from catalog prerequisite, consent, confirmation, stage and active workflow binding checks.

**Do not** increase semantic confidence purely because the visitor provided a phone number. Do not switch a confirmed company-formation goal when the visitor asks "What documents are needed?" or "What is the invoice status?"

## Question selection

The LLM chooses the **one highest information-gain question** among allowed unanswered catalog requirements. It may ask for a clarification, company type, activity, budget, timeline, visa count, document, contact, or action confirmation **only if required**. Respect customer preference and previous answer; do not ask for a document or personal information simply to generate a lead.

If the customer asks a factual question, answer first from approved RAG or verified structured data. During an active goal, append one relevant unresolved requirement question. If only a knowledge question exists, ask whether they would like additional help. If a goal is complete, confirm customer satisfaction and ask if another service is needed.

## User confirmation and switching

- Explicit customer confirmation establishes the active **business goal**; it does **not** approve CRM submission, payment, document transfer or signing.
- Active goal remains pinned through supporting intents until explicitly replaced, completed, or a catalog-approved transition occurs.
- Goal switching uses a new/approved opportunity identity and **new** purpose-based consent; never reuse predecessor documents, action idempotency or stale requirements.
- Negative responses and corrections override prior assumptions and recalculate dependent recommendations.

## Testing and metrics

Test knowledge-only with **zero CRM calls**, two similar business goals, unclear "yes/no", conflicting context, corrected visa count, repeated questions avoided, document-dependent goals, personal-details-only-when-required, missing RAG abstention, intent-category accuracy, model weighting bounds, cached replay, two-tenant isolation, consent denial, goal completion and next-service inquiry. Measure goal precision/recall, wrong-goal confirmations, requirement redundancy, high-information question usefulness and stage completion—**not just number of leads captured**.
