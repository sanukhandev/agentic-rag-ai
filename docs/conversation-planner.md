# LLM-led conversation planner — summarize, weigh, decide, answer, progress

**Status: TARGET.** The model is the **primary conversational strategist**, not merely a text rewriter following hardcoded Node prompts. Node remains the trusted **executor and validator**. This division lets GPT direct the next conversational action without making unverified side effects or data changes.

**Authoritative contracts:** [conversation-engine-contracts.md](conversation-engine-contracts.md) defines the proposed TurnEnvelope, plan, tool-result and persona output; [conversation-engine-architecture.md](conversation-engine-architecture.md) defines ownership and control flow. The model proposes intent signals and a question, but Node validates allowed keys/weights and does not treat confidence as permission to write.

**Planner vs composer:** planning chooses intent, evidence/tool needs and next move; the final Persona Composer generates customer prose **after required read tools return**. These are logical operations inside one Python agent, not independent customer-facing agents. Enforce per-turn model/token/tool deadline budgets and provide an approved offline persona fallback for failures.

## Agent responsibilities

For **each substantive customer turn** the LLM receives the **published, session-pinned persona envelope** (assistant identity/name, tone, permitted language and style), a compact trusted tenant catalog digest and the latest **User Intent Document** projection containing: confirmed/possible goal, prior decisions, validated facts (and provenance), missing requirements, answered questions, document statuses, stage/provider statuses, customer preferences, previous question and relevant conversation summary. The model then:

1. **Understand and summarize:** maintain a structured, bounded running summary of customer objectives, exact facts, corrections, objections, answered questions, unresolved needs, promised next steps and stage outcomes. Classify the latest utterance without dropping the previous goal.
2. **Identify category and candidates:** choose the turn-intent category, candidate catalog keys, evidence spans, exclusions, uncertainty and whether the turn is a knowledge interruption, requirement answer, new goal or action request.
3. **Weigh competing business goals:** propose signal-specific weight adjustments **within catalog-approved bounds**, explain which factual signals support/oppose each candidate, assess intent clarity and separately assess readiness to fulfill requirements. When ambiguous, ask one targeted question with high expected information gain rather than prematurely picking a goal.
4. **Choose the next move:** from `answer_knowledge`, `clarify_goal`, `confirm_goal`, `collect_requirement`, `request_document`, `request_contact`, `propose_action`, `check_action_status`, `handle_correction`, `offer_handoff`, `complete_goal`, `ask_more_help`, `stop`. It must supply a catalog-backed `reason`, `requiredKey` if applicable and **one** relevant next question or an explicit no-question exception.
5. **Retrieve and answer:** use a separate bounded normalization task for source search where useful, retrieve authorized RAG evidence through Node, and compose answers grounded in returned evidence. A factual answer cannot rely on model parametric knowledge when approved RAG is missing.
6. **Propose needed capabilities:** if catalog prerequisites are met, suggest `toolKey`/input references. Tool proposals never become external writes until Node verifies confirmation, consent, stage and idempotency.
7. **Evaluate goal satisfaction:** when the business goal's published completion criteria are verified, stop unnecessary requirement collection, summarize accurately and ask if the customer needs more help. An answer to a single knowledge question does not terminate a separately active business goal.

Node validates catalog key membership, source IDs, facts, allowable next moves, score bounds, version/tenant, current stage, prior response state, and confirmation before saving the model proposal. If invalid, preserve existing context and ask a safe catalog-appropriate clarification; never silently reset the conversation.

## Persona-guided planning and final response composition

The Python agent must **understand the customer in the persona's style throughout the turn**, not simply repaint technical output at the end. It can request the minimum approved **Node read tools** (RAG, catalog, persona, stage, missing facts, package or provider status) **before** the final answer. Tool results inform its decision but never become customer-facing raw JSON.

After planning and tool continuation, the **Persona Response Composer is the last generative step**. It narrates verified facts naturally in the current tenant's assistant voice, acknowledges known details without repeating an interrogation, and asks **one relevant next question** (or returns an explicit valid exception). It must not display internal intent keys, score percentages, raw SQL, tool IDs or workflow statuses. The **Node Response Guard** then validates citations, persona, language, stage truth and question appropriateness.

For ANCFZ, a published Zara persona might say: "I'll keep the three visas you mentioned in mind. [Grounded options and citations.] What business activity are you planning?" She must not invent options if RAG/packages are unavailable; she also must not repeatedly introduce herself. For another tenant, load that tenant's published voice instead of Zara. Natural replies do not imply human identity, internal private thoughts or invented provider results.

On model/RAG/tool failure, the Node handler returns an **approved persona-versioned fallback** populated only with verified state, not a generic technical dump or a forced lead form. Full requirements: [persona-response-contract.md](persona-response-contract.md), [agent-tool-loop.md](agent-tool-loop.md).

## Proposed planner output (illustrative JSON; keys are not current code)

```json
{
  "turnCategory": "knowledge_advisory",
  "primaryBusinessGoal": {"goalKey": "published-catalog-goal", "status": "confirmed"},
  "conversationSummary": {
    "customerGoal": "Company formation",
    "verifiedFacts": {"visaCount": 3},
    "unresolved": ["business activity"],
    "answeredTopics": ["visa requirements"],
    "pendingQuestionKey": "business-activity"
  },
  "intentAssessments": [
    {
      "catalogIntentKey": "approved-catalog-intent",
      "semanticFit": 92,
      "matchedSignals": ["signal-12"],
      "negativeSignals": [],
      "suggestedSignalWeights": {"signal-12": 1.1},
      "confidenceBand": "high",
      "reason": "Customer expressly requests company registration"
    }
  ],
  "requirements": {"knownKeys": ["visa-count"], "missingKeys": ["business-activity"]},
  "nextMove": {"type": "answer_knowledge", "resumeRequirementKey": "business-activity"},
  "toolProposal": null,
  "responsePlan": {
    "groundedAnswerRequired": true,
    "evidenceIds": ["approved-citation-id"],
    "nextQuestionKey": "business-activity",
    "nextQuestionDraft": "What business activity do you plan to carry out?"
  },
  "goalSatisfied": false
}
```

Only verified facts are written to the ledger. Model-generated summaries, suggested weights, unverified slots and intent scores are **proposals with provenance**; they do not override data recorded by authenticated workflows.

## Weighting design: adaptive reasoning, bounded authority

The LLM should determine **which evidence matters most** for this specific conversation: explicit user phrasing, multiple-turn consistency, requirements collected, stated urgency, corrections, exclusions, and disambiguating answers. The catalog supplies allowed signal keys, base weights, categories and permitted adjustment range. The model proposes adaptations within range; Node clamps them, persists effective scoring-policy version and recomputes the final evidence score.

Maintain **three separate metrics**:
- **Goal identification confidence:** how strongly evidence points to one specific business goal versus alternatives. Record calibrated confidence band/top-two margin, not fake probability.
- **Requirement coverage:** how many of that goal's published prerequisites have been *verified*; missing facts/documents and mandatory approvals tracked separately.
- **Action readiness:** a deterministic Boolean/gate with reason codes; requires correct stage, validated facts, explicit consent/confirmation and approved tool binding, regardless of conversational confidence.

Never use a high identification score as authorization, and never treat a complete contact form as proof of intent satisfaction.

## Follow-up strategy (one relevant question, not scripted repetition)

Choose the question that most reduces uncertainty or unblocks the **confirmed goal**:

- No clear goal → ask a distinguishing clarification.
- Clear but unconfirmed business goal → ask "Are you looking to [verified goal]?"
- Confirmed goal + missing requirement → ask the single highest-priority missing requirement, choosing between clarification, contact, document and qualification fields according to catalog priority/dependency and customer information already known.
- New knowledge question during an active goal → answer from approved RAG and ask the still-pending requirement (or a better contextually relevant variant).
- Waiting on external action → describe verified status; ask only about an allowed next step, otherwise provide a non-question status and do not falsely advance.
- Goal completed → summarize actual outcome, then ask whether further help is needed; don't start CRM capture again.
- Knowledge-only question with no business goal → answer, then ask if they would like help with a related topic; don't force a business opportunity.
- Explicit opt-out / farewell → stop politely; no pushy question.

**All factual responses come from approved RAG or authoritative structured provider/catalog state.** Intent/requirement questions are generated from published catalog definitions and already verified conversation facts, not invented policy or pricing. One answer should contain **at most one primary question**; no stacking multiple requests.

## Sample interaction: one business goal, multiple supporting intents

Customer: "I want to open a company in the UAE with three visas."
Agent: "I can guide you through company setup. Are you looking to register a new company?" (confirm business goal)

Customer: "Yes. What licenses are available?"
Agent: [grounded RAG answer with citations] "What activity will your company carry out?" (knowledge subintent + missing qualification requirement)

Customer: "Software consulting."
Agent: [validated fact; summary updated] "When would you like to begin?" (next high-value requirement)

Customer: "Can I do it without submitting my passport now?"
Agent: [grounded RAG answer or transparent unknown] "Would you like to continue with the information we can complete before the document stage?" (preserve opportunity, do not fabricate document requirement)

Customer: "Yes, please."
Agent: [progresses catalog prerequisites; offers an authorized action **only** when eligible and separately confirmed]

Later, after **verified catalog goal completion**, the agent summarizes provider-confirmed outcomes and asks: "Is there anything else I can help you with?"

No CRM Lead submission is assumed for a knowledge-only visitor.

## Per-turn persistence and failure handling

Node writes one auditable planner assessment per evaluated turn, including model version, allowed candidates, suggested/accepted weights, summary revision, verified/unverified facts, chosen next move, one question key, RAG evidence and optional tool proposal. Replay or duplicate clientMessageId returns the saved decision/answer **without another GPT call or n8n side effect**. Redis accelerates scoped caching, PostgreSQL is source of truth.

On model timeout / max retries, retain the pinned persona, current goal and pending requirement; return an **approved and state-accurate tenant-persona fallback through Node Response Guard**, or a safe generic transport error if the tenant/session has not been established. Never mutate stage/confirmation based on an incomplete model response. Keep existing auth/PII vault/consent safeguards through this migration.
