# Intent identification, confidence and explicit customer confirmation

**Status: TARGET.** Node owns intent interpretation and final decisions; Python proposes structured language interpretations. Every tenant has a reviewed, published, **version-pinned** catalog. ANCFZ is the first acceptance tenant only.

## Per-turn pipeline

1. Load current User Intent Document, active opportunity, pending requirement and tenant catalog version.
2. **Capture turn identity** (`clientMessageId`, message hash, session/version). Return previously persisted response and decision if already processed.
3. Deterministically normalize superficial spelling/whitespace and score catalog candidates using phrase, keyword, synonym, exclusion, relation and recent confirmed-intent signals. Inspect whole phrases; avoid substring false positives and negated matches.
4. When semantic ambiguity is material, ask private Python `/interpret` for strict JSON: normalized wording, explicitly observed intent keys from the allowed candidate list, evidence spans, extracted facts, negation, corrections, follow-up/knowledge question classification, and uncertainty. The model must not invent unseen catalog IDs or provider URLs.
5. For RAG questions, Python `/normalize` may generate search query/tokens without changing quantities, negation, business activity, entity type, dates, or recognized identity/intent context. Node checks the rewrite and can fall back to deterministic original input.
6. Node merges deterministic evidence and validated model suggestions, computes scored candidates, persists all candidate decisions in the User Intent Document, then selects/retains/clarifies **one** primary intent.
7. If no current intent is confirmed and a candidate passes calibrated selection policy, **ask the customer to confirm** the visible intent title; do not immediately collect action-specific requirements unless catalog explicitly defines permitted pre-confirmation discovery. Confirmation is separate from processing consent.
8. Once confirmed, keep this intent until explicit switch, terminal completion or approved catalog transition; return to the pending requirement after a knowledge interruption. Ask exactly one next relevant question. If candidate confidence falls, clarify before changing intent; do not silently reset the opportunity.
9. Only Node's catalog/side-effect gate authorizes an eligible workflow proposal; intent confidence does not authorize data transfer or payment.

## Score design

Persist a breakdown instead of a fake single model probability:

- `signalScore`: weighted positive phrase/keyword matches, with negative/exclusion penalties.
- `contextScore`: validated prior confirmed intent and current pending-requirement continuity. Do not let accumulated history falsely dominate a clear new explicit request.
- `factCompleteness`: validated catalog slot coverage (reported separately; do not use to imply semantic certainty).
- `modelSupport`: normalized observation consistency and evidence spans, not uncalibrated self-declared probability.
- `selectionScore`: bounded, documented combination using catalog-defined weighting and thresholds.
- `confidenceBand`: `high`, `medium`, `low` from empirically evaluated thresholds; separate `modelReportedConfidence` is optional/diagnostic and is **never** authorization.
- `ambiguityMargin`: top-two score difference, exclusions, conflicting evidence and negations.
- `decision`: `candidate`, `clarify`, `await_intent_confirmation`, `confirmed`, `continuation`, `knowledge_interruption`, `switch_requested`, `rejected`, `no_match`.

Thresholds and scoring weights must come from catalog/policy version, not Python/model invention. Tune with synthetic labeled utterances and check precision/recall/confusion metrics; test false positives on ambiguous "yes", "no", "start company", visa/package queries and negated intent. Stop classification when catalog disallows a candidate.

## Structured example (illustrative)

```json
{
  "catalogVersionId": "opaque-pinned-version",
  "turnId": "opaque-turn",
  "normalizedUserUtterance": "I want to register a company with two visas",
  "candidates": [
    {
      "intentKey": "catalog-approved-key",
      "matchedSignalIds": ["signal-1", "signal-2"],
      "signalScore": 72,
      "contextScore": 8,
      "selectionScore": 80,
      "confidenceBand": "high",
      "ambiguityMargin": 24,
      "missingRequiredFactKeys": ["catalog-fact-key"]
    }
  ],
  "primaryIntentKey": "catalog-approved-key",
  "status": "await_intent_confirmation",
  "nextQuestionKey": "confirm-intent:catalog-approved-key",
  "source": "node-validator"
}
```

Use real repository types and migrations when implementing, not this example's literals.

## Normalization safeguards

A normalization is successful only if it retains all explicitly provided numbers, dates, negations, visa counts, package names, legal structure distinctions, and previous validated business facts. Normalization must not add a price or stage rule or mutate an intent from "I do not want" to "I want". Record the original and normalized digest, tokens, model/schema version, and fallback reason. Normalization is for **retrieval**, not consent or authority.

## Confirmation and follow-up priorities

`external action pending` → accurate status (no advancement), `unconfirmed intent` → one intent confirmation, `pending prerequisite` → one catalog question, `knowledge interruption` → grounded answer + resume question, `ready for action` → one explicit action confirmation, `verified stage completion` → one next-stage question, `terminal` → concise recap with optional non-coercive next step.

If information is unavailable, answer transparently with no fabricated citation. Do not ask the same fulfilled question repeatedly. After an explicit opt-out, do not push next-stage workflow actions.

## Tests

Single- and multi-turn multilingual wording (when enabled), exact phrase and keyword boundaries, exclusions, ambiguous intents, pending answer "yes"/"no", co-occurring intents, fact correction, intent switch/new opportunity, two-tenant catalog isolation, cached result reuse, invalidation after catalog/slot revision, API restart and model failure.
