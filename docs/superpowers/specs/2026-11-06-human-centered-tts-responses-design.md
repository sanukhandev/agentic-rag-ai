# Human-centered, TTS-friendly responses

## Goal

Make every customer-visible response easier to hear and understand: acknowledge the user's intent, give the useful answer or status in plain language, and ask no more than one purposeful follow-up when the conversation should continue.

This applies to greetings, knowledge answers, clarifications, requirement collection, document requests, confirmations, queued/pending states, abstentions, errors, handoff, and completion. It does not change the business workflow, evidence policy, persona selection, or action authorization.

## Current problem

Some deterministic fallbacks and source-recovery paths return raw facts or a single direct sentence. The Python repair prompt also intentionally suppresses all conversational framing. Those paths are safe but sound abrupt in chat and in TTS.

## Approach

1. Update the shared Python persona-composer instructions so normal responses use a short, natural structure:
   - brief acknowledgement or context-setting phrase when useful;
   - the grounded answer, status, or requested next step;
   - one relevant question only when a verified requirement or active conversation needs it.
2. Keep the source-grounded repair mode extractive for factual safety, but allow a small non-factual lead-in and a single verified continuation question where the Node policy permits it.
3. Humanize Node deterministic fallbacks at their shared response boundaries, including knowledge/source excerpts, abstentions, language notices, consent and collection prompts, and continuity/reconciliation responses. Use tenant-neutral wording and the pinned persona; do not hardcode Zara.
4. Preserve exact evidence claims, citation IDs, question keys, opt-out wording, and action/confirmation semantics. Do not invent package differences, prices, timelines, provider status, quote readiness, or workflow success.

## TTS constraints

- Prefer short sentences and ordinary punctuation.
- Avoid internal keys, IDs, markdown tables, URLs, and implementation terminology.
- Keep the answer understandable when read alone.
- Keep one final question at most, and make it the same question recorded in structured metadata.
- Do not add conversational filler to farewells, opt-outs, or explicit safety/verification abstentions when it could obscure the user-facing meaning.

## Files and tests

- `services/model-gateway/gateway/persona_composer.py`: revise normal and repair composer guidance.
- `services/api/src/v2-coordinator.ts`: humanize shared v2 source-recovery output without changing evidence selection.
- `services/api/src/model.ts` and/or the existing deterministic fallback call sites: improve tenant-neutral fallback phrasing only where raw direct responses are emitted.
- Existing API/model tests: add assertions for explanatory framing, TTS-safe punctuation, preserved citations, and one follow-up question; retain tests for opt-out, abstention, and workflow confirmation semantics.
- `docs/current-state.md`: record the measured verification result and any remaining runtime limitation.

## Non-goals

- No package-selection, CRM lead, document, quote, payment, or contract workflow changes.
- No new model, dependency, schema, migration, persona, or catalog configuration.
- No automatic paraphrasing of approved factual evidence unless the existing guard accepts it.
