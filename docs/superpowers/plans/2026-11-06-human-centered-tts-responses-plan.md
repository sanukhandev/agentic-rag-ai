# Human-centered TTS Responses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make all customer-visible assistant responses short, explanatory, natural to hear, and consistent with the pinned tenant persona without changing business facts or workflow authorization.

**Architecture:** Keep the existing Python composer as the normal generative response layer. Improve its TTS-specific instructions, then improve the existing Node deterministic/source-recovery boundaries that are used when model output is rejected or unavailable. Evidence, citations, question keys, and action semantics remain unchanged except that verified response paths may carry one purposeful follow-up question.

**Tech Stack:** TypeScript, Vitest, Python, pytest, existing Node response guard, existing persona composer.

**Spec:** `docs/superpowers/specs/2026-11-06-human-centered-tts-responses-design.md`

## Global Constraints

- Preserve exact grounded facts and citation IDs; do not invent package differences, prices, timelines, provider status, quote readiness, or workflow success.
- Every customer-visible reply stays in the pinned published tenant persona and permitted language; never hardcode Zara in shared code.
- Prefer short TTS-friendly sentences, ordinary punctuation, and at most one final question.
- Do not add a dependency, schema, migration, workflow action, or quote behavior.

## Review Focus

- Model-generated factual answers: the composer must add natural framing without weakening citation and claim requirements.
- Rejected model/source-recovery answers: deterministic excerpts must stay source-close while no longer sounding like raw database lines.
- Optional follow-ups: one question must remain synchronized with `nextQuestion` and `nextQuestionKey`, and repeated optional questions must still be suppressible.
- Opt-outs, farewells, and abstentions: human framing must not obscure refusal, uncertainty, or conversation closure.
- Arabic/persona configuration: wording changes must not introduce English-only assumptions or a shared Zara identity.

---

### Task 1: TTS-aware Python persona composition

**Files:**
- Modify: `services/model-gateway/gateway/persona_composer.py`
- Test: `services/model-gateway/tests/test_persona_composer.py`

**Interfaces:**
- Consumes the existing `TurnEnvelopeV2` persona, evidence, and question policy.
- Produces the existing `PersonaComposedResponseV2` JSON contract; no field or endpoint changes.

- [ ] **Step 1: Write the failing test**

Add assertions that normal composer instructions require short spoken-language sentences, a brief acknowledgement or context-setting phrase when useful, one useful explanation before a follow-up, and no more than one final question. Keep the existing assertions for persona, citation, and metadata rules.

- [ ] **Step 2: Run the focused Python test and verify it fails**

Run: `python -m pytest services/model-gateway/tests/test_persona_composer.py -q`

Expected: the new instruction assertions fail because the current prompt does not contain the TTS guidance.

- [ ] **Step 3: Implement the minimal composer guidance**

Update the normal composer instruction string with TTS guidance only. Keep factual clauses citation-bound, keep the existing exact question contract, and leave the strict repair path source-close unless a non-factual lead-in remains explicitly allowed by the existing Node guard.

- [ ] **Step 4: Run the focused Python test and verify it passes**

Run: `python -m pytest services/model-gateway/tests/test_persona_composer.py -q`

Expected: all tests pass.

- [ ] **Step 5: Commit**

Commit message: `fix: make persona composition tts friendly`

### Task 2: Humanize Node deterministic and source-recovery responses

**Files:**
- Modify: `services/api/src/v2-coordinator.ts`
- Modify: `services/api/src/model.ts`
- Test: `services/api/src/v2-coordinator.test.ts`
- Test: `services/api/src/model.test.ts`

**Interfaces:**
- Consumes existing approved evidence and deterministic fallback inputs.
- Produces the existing response text, citation IDs, and question metadata.

- [ ] **Step 1: Write the failing tests**

Add tests that:

1. package source recovery starts with a natural explanatory sentence, preserves every approved package line and citation, and asks one package-focused follow-up;
2. generic source recovery starts with a short explanatory lead-in, preserves the selected evidence sentence and citation, and asks one `conversation_focus` follow-up;
3. deterministic grounded knowledge output uses a spoken-language lead-in before verified content; and
4. existing abstention, farewell, and opt-out wording remains semantically unchanged.

- [ ] **Step 2: Run the focused TypeScript tests and verify they fail**

Run: `npm --prefix services/api test -- src/v2-coordinator.test.ts src/model.test.ts`

Expected: the new response-shape assertions fail against the current raw excerpt/deterministic output.

- [ ] **Step 3: Implement the smallest shared wording changes**

In `sourceExcerptResponse`, add tenant-neutral framing and a single purposeful question while retaining source text verbatim and all citation IDs. In the deterministic grounded model, add a short spoken-language lead-in only to evidence-backed answers. Do not change evidence selection, fallback routing, or workflow state.

- [ ] **Step 4: Run the focused TypeScript tests and verify they pass**

Run: `npm --prefix services/api test -- src/v2-coordinator.test.ts src/model.test.ts`

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

Commit message: `fix: humanize deterministic chat responses`

### Task 3: Full verification and current-state evidence

**Files:**
- Modify: `docs/current-state.md`

- [ ] **Step 1: Run the complete API test, typecheck, lint, and build checks**

Run:

- `npm --prefix services/api test`
- `npm --prefix services/api run typecheck`
- `npm --prefix services/api run lint`
- `npm --prefix services/api run build`
- `python -m pytest services/model-gateway/tests -q`

- [ ] **Step 2: Inspect the diff and record exact measured results**

Confirm no workflow, database, credential, or tenant identity changes. Record pass/fail/blocked results and exact paths in `docs/current-state.md`.

- [ ] **Step 3: Commit**

Commit message: `docs: record tts response verification`
