# Conversation V2 fail-closed hardening plan

## Intent

Close the LangGraph/tool-calling gaps found in the safety review without
replacing the current Node guard or introducing a new persistence model.
Unsupported model output must never reach a customer through the legacy path.

## Goals

- Keep V2 and LangGraph disabled unless explicitly enabled for named tenants.
- Preserve Node as the final authority for citations and customer-visible text.
- Carry bounded, tool-produced approved evidence into the Node guard.
- Reject lexical contradictions and unsupported extra claims.
- Prevent action status from crossing opportunity boundaries.
- Add regression tests for each previously demonstrated failure.

## Non-goals

- No new tenant fallback-template storage in this patch.
- No change to side-effect action workflows.
- No claim of mathematically perfect LLM entailment; the runtime must abstain
  when deterministic checks cannot establish support.

## Approach

Use the existing contracts and guard. Add a small evidence envelope to the
Python result, validate its shape and citation ownership in Node, and make
the app fail closed when an attempted V2 turn cannot produce an approved
fallback. Tighten the existing evidence helper instead of adding a second
grounding system.

## Implementation tasks

1. Add failing tests for fail-closed rollout defaults, V2 legacy-bypass
   prevention, tool evidence propagation, contradiction rejection, and
   opportunity isolation.
2. Extend the Python/Node V2 result contract with bounded approved evidence
   and have both bounded and LangGraph agents collect it from successful
   read-only tool results.
3. Merge only validated tool evidence into the coordinator guard context;
   never trust model-provided citation IDs alone.
4. Change V2 rollout and Python LangGraph defaults to fail closed, and stop
   the app from silently entering the legacy model path after a V2 attempt.
5. Strengthen claim checks for negation, numeric/date conflicts, and
   unsupported additional sentences.
6. Require an opportunity scope for action status queries and run focused,
   full local verification.

## Verification

- Focused Node V2 Vitest suite.
- Full Node test suite if available from the package scripts.
- Python LangGraph/agent/contract tests.
- Compose and secret checks already used by this branch.
- Report missing external-provider verification separately.
