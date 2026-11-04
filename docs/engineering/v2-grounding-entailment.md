# V2 claim grounding versus language similarity (experimental)

## Purpose

Separate *textual similarity* (diagnostic only) from *evidence entailment*
(authoritative only after deterministic Node checks and a successful independent review).

This feature is opt-in. The default is disabled; the original V2 guard and
bounded knowledge-repair behavior remain active.

## Runtime contract

- `V2_GROUNDING_ENTAILMENT_MODE=enforce` (API environment) enables one additional
  independent review when the existing V2 guard rejects a cited factual clause
  for `single_source_support_not_established`.
- The reviewer is invoked only when the exact server-prefetched, tenant-scoped,
  approved source IDs, versions and texts match Node's trusted prefetch. The
  review is not used to override other guard failures, including invalid citation,
  question contract, provider outcomes, missing sources, numeric mismatch and
  known polarity mismatch.
- The reviewed model can answer `supported`, `contradicted` or `insufficient`
  per claim. `supported` requires one matching source citation, not a collection
  of unrelated snippets.
- Node creates content-hash-bound proofs for supported claim-to-source pairs.
  The same Node guard reruns, enforcing source identity, revision, numeric
  consistency, negation, verified business outcomes and unused-citation checks.
- No direct business operations, external tool calls or stage transitions are
  permitted in the verifier. Its response cannot authorize a business action.
- At most eight consequential clauses and eight citations are reviewed.
  Verification uses one model request and counts toward the existing
  `maxModelRequests` turn budget. A failed review cannot be treated as accepted.
  The earlier knowledge-repair attempt may be unavailable if the second model
  request is used for the review.
- The private endpoint is `POST /internal/v2/grounding/verify` on the existing
  Python model gateway and requires the internal service key.
- `groundingLexicalOverlapPercent` and `groundingReviewStatus` appear in
  `v2.gpt_first.turn` audit metadata. They do not store response text or excerpts.
  The lexical percentage never influences the acceptance decision.

## Validation / safe release

Do not enable in production solely because the unit tests pass.

1. Assemble a pinned, blinded evaluation corpus of ANCFZ registration questions,
   correct paraphrases, irrelevant retrieval, contradictions, negated requirements,
   mixed-source claims, customer facts, currency/number mistakes, revoked citations
   and positive business-outcome claims.
2. Run a fixed Azure model deployment and the same retrieved source versions
   through both baseline and entailment-enabled paths. Keep case ordering and
   context stable, and repeat the evaluation to detect instability.
3. Require zero critical unsupported action, legal-registration or payment claims
   accepted; no regression in source authorization or tenant isolation; and a
   measurable improvement in correct grounded-answer acceptance before rollout.
4. Monitor review latency, total requests, grounding status, fallback rate, source
   citation provenance, false-positive acceptance and false rejection.
5. Roll back immediately with `V2_GROUNDING_ENTAILMENT_MODE=off` if quality drops.
   Both paths still require approved evidence and Node's deterministic authority.

## Limitations

A structured language-model entailment judgment is *not itself proof of truth*.
It must never override deterministic state or provider outcomes. A relevant
source may be absent because retrieval missed it; the model verifier cannot
recover missing knowledge. Natural paraphrasing and multi-source synthesis
remain subject to the per-source grounding decision. The feature is designed
to reduce false lexical rejections, not raise acceptance at any cost.
