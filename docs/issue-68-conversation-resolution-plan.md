# Issue 68: conversation resolution repair

Status: verified repair implemented and locally validated; broader observability and turn-interpreter refactors remain follow-up hardening.
Branch: `feat/knowledge-retrieval-continuity`.
Baseline: `83c4075`. Review date: 2026-10-27.

## Implemented repair

- Catalog phrase normalization now treats generic preference wording such as "would like to" and "I'd like to" consistently with "want to" before tenant-published signal matching. No tenant names or tenant-specific business vocabulary were added.
- Introduction masking supports `I'm`, `I am`, `i m`, and `im`, preserves the conversational introducer, rejects common business-request openers, and remaps multiple new placeholders without token collisions.
- The conversational classifier recognizes masked greeting/introduction turns and leading-thanks farewells before generic acknowledgement handling.
- Optional malformed model follow-up metadata no longer discards an otherwise valid grounded core answer. Core answer, citation and actionable-intent fields remain boundary validated.
- Generic slot words such as `company` no longer populate an unrelated catalog slot from the whole request. The pending prompt requirement key now identifies the actual backend-selected contact slot.
- A grounded knowledge interruption retains and visibly resumes the backend-owned pending slot question. Unsupported model offers cannot replace an approved factual answer or create hidden follow-up state.
- Regression coverage now exercises the fresh entry path without pre-seeding a selected intent, PII variants and collisions, paraphrased catalog matching, mixed knowledge/slot composition, malformed optional model metadata, and grounded-answer preservation.

## Local validation evidence

- Full monorepo tests: Admin 45, Web 14, API 192, chat-utils 3, and contracts 3 passed. Two API files containing 8 environment-gated Redis/PostgreSQL tests were skipped.
- Full monorepo lint, typecheck, and production build: passed.
- Compose deployment verification and repository secret scan: passed.
- Docker API image: rebuilt from this branch and health-checked through the local nginx route.
- Browser journey: greeting -> masked introduction -> paraphrased company request -> grounded offers interruption -> pending email resumption -> farewell. The offers turn returned two verified sources and retained the email question.
- API journey `48e217ab-31bc-4e35-96b1-9e9c608bc7e9`: the same interruption preserved `slot:email`; contact collection advanced to `slot:phone` and explicit consent; consent refusal created no action; a later documents question returned two verified sources; farewell closed the session.

No Salesforce or other external CRM submission was attempted during this repair validation.

## Verified live evidence

- Local `.env` contains two identical `CATALOG_QUERY_NORMALIZATION_ENABLED=true` entries. The API container reports `true`; the `anc` tenant database flag is also true.
- Live API session `d6d49fed-782e-49f3-8c5a-50a18bca9811`: greeting works; combined greeting/introduction, company request, and offers question all return generic abstention with no pending requirement. A subsequent `yes please` returns two citations. This is not a consistently functioning journey.
- An isolated call through the running Azure adapter successfully normalizes `i would like to start a company` to `I would like to start a company` in 2079 ms. Passing that result to the published catalog resolver returns `no_signal`, score 0.
- The same adapter returns `I want to start a company` in 2066 ms. The same resolver selects `anc.setup.new_company`, score 75, with missing requirements and no authorized action.
- `maskPii('hey zara i m tom')` produces no NAME token; `conversationalIntent` returns null. Introduction handling and privacy need repair before further live identity tests.
- Catalog and knowledge exist. Their presence does not prove that any specific query retrieved sufficient relevant evidence.

## Why the previous change was insufficient

The previous patch only adds context and a clarification response for knowledge questions during an already active journey. Initial greetings mixed with introductions and initial service requests do not meet those conditions. Unit tests manually populated the selected intent and pending prompt, so they did not prove the entry path.

The normalizer is explicitly instructed not to choose an intent. Its rewritten string is nevertheless used as input to phrase-based intent matching. Valid natural paraphrases can therefore produce no intent even when Azure succeeds. Earlier explanations attributing the failure solely to disabled normalization are superseded by the live evidence above.

Other code-level gaps requiring coverage:

- Conversational and knowledge flags are computed before normalization and remain separate from catalog resolution.
- The route uses many overlapping booleans to choose response mode and apply final validation. A harmless conversational draft can be replaced by a factual abstention.
- The adapter maps malformed draft responses to the same generic abstention used for missing evidence. Normalization failures similarly lose their specific failure reason.
- The normalizer sends active catalog intents/signals and history under a three-second timeout. Timeout risk is distinct from the verified successful-call/no-match failure.
- Retrieval ranking requires lexical overlap; citation sufficiency is based on citation membership, numbers, and limited word overlap. Neither establishes semantic relevance alone.
- A generated follow-up question does not necessarily establish a persisted offer. Short acceptance needs a specific stored referent.

## Target behavior and authority

Masked visitor turn + authoritative pending prompt + validated slots + bounded masked summary/recent turns + published catalog -> validated turn interpretation -> deterministic journey decision -> optional authorized retrieval -> composed response -> mode-specific validation -> atomic state/message persistence.

The model may propose a conversational purpose and catalog candidates. Node owns catalog eligibility, slot validation, consent, action authorization, and workflow dispatch. Semantic confidence never grants consent or directly authorizes a side effect. Source evidence is required for business claims, but not for acknowledging visitor facts or asking a clarification.

## Ordered implementation

### 1. Make failure reasons observable

Files: `app.ts`, `model.ts`, existing monitoring helpers and tests.

- Record bounded reason codes for normalization disabled/timeout/invalid output, no catalog candidate, ambiguous candidate, empty retrieval, invalid citations, unsupported draft, and composition failure.
- Include request/session correlation, catalog version, selected mode, counts and timing. Do not log messages, names, normalized text, source content, secrets or raw model responses.
- Preserve current public response contract; use existing authorized diagnostics for operational detail.
- Acceptance: each observed abstention can be attributed to a stage instead of inferred from its wording.

### 2. Repair masking and turn interpretation

Files: `privacy.ts`, `model.ts`, `types.ts`, `app.ts`, their tests.

- Handle supported introduction variants such as `I'm`, `I am`, `i m`, and `im` with greeting prefixes; preserve the non-identity remainder of mixed turns. Protect against masking business requests as names.
- Check existing tokens, multiple identities, Unicode names, negation and malicious placeholders. Prove no unmasked identity reaches the model in covered cases.
- Extend the existing bounded interpretation/normalization call to return a strict typed proposal: turn purpose, retrieval query, catalog candidate keys with evidence, and ambiguity. Reuse one call where possible rather than adding a model call per decision.
- Validate keys against the current tenant's published/pinned catalog. Preserve quantities, negation and tokens. Reject invented candidate IDs and unsupported slot claims.
- Retain deterministic handling for unambiguous greetings and pending answers. On model failure, use existing reliable catalog matching or ask a context-specific clarification; do not classify all unknown turns as knowledge questions.
- Acceptance: unseen paraphrases work in two synthetic tenant catalogs without tenant names/business vocabulary in routing code. Mixed greeting + service request keeps the service request.

### 3. Give one backend decision ownership of the turn

Files: `app.ts`, existing `intent-journey.ts`, `conversation-state.ts`, catalog resolver and tests.

- Reuse the journey reducer and produce one explicit decision: social reply, collect/correct requirement, clarify intent, answer knowledge, resolve offer, request consent, report action state, or farewell.
- Resolve pending answers and corrections before starting a new collection. A knowledge interruption preserves the pending requirement; a genuine switch follows catalog transition policy.
- Integrate validated semantic candidates with explicit backend qualification policy. Do not fake phrase matches or inflate model confidence into catalog score. Keep semantic candidate confidence separate from action readiness.
- Never infer submission from `yes` unless the persisted prompt is the relevant consent/confirmation request. General follow-up acceptance stays conversational.
- Acceptance: no repeated known name/contact question, no accidental lead from a knowledge question, no lost pending requirement after interruption.

### 4. Separate retrieval from response wording

Files: `app.ts`, `knowledge.ts`, `model.ts`, relevant store search/tests only if evidence warrants a query change.

- Build focused retrieval text from the current factual question and relevant confirmed context. Keep summary/history bounded and separate from factual evidence.
- Evaluate actual rejected candidates before adjusting lexical-overlap/rank thresholds. Use synthetic relevant, irrelevant, revoked and cross-tenant cases; do not simply weaken grounding to eliminate abstentions.
- Compose normal replies from the approved decision and tenant persona. Validate social/collection replies without demanding citations; validate factual sections with authorized evidence.
- Distinguish an unavailable answer from an ambiguous question. A clear unsupported question needs an honest specific limitation, not an endless clarification loop.
- Persist follow-up offers with stable IDs/options whenever wording offers a next step. A single-option acceptance advances it; multiple options require a focused choice.
- Acceptance: offers/procedure questions retrieve relevant evidence where present; unsupported questions remain honest; `yes please` resolves to the actual preceding offer.

### 5. Preserve workflow and post-capture continuity

Files: existing action completion/chat composition paths, state reducer and tests.

- Continue using current consent, idempotency, outbox, workflow-binding and verified callback gates.
- After registration/completion, retain the opportunity, requirements and pending offer. Compose the next catalog-supported conversational step; do not imply Salesforce success before verified completion.
- Do not create another lead for a related follow-up. Use document requirements only when catalog policy, purpose and consent permit them.
- Acceptance: one opportunity across multiple related intents; a declined consent produces zero external writes; follow-ups remain active until farewell.

### 6. Verify the complete deployed local conversation

- Unit tests: privacy variants, interpretation boundaries, model timeout/invalid JSON, unknown catalog keys, prompt ownership, factual vs non-factual response validation.
- API tests: start new sessions with greetings; never inject selected intent/state to substitute for entry-path tests. Use unique client message IDs and craft each next message from the actual preceding answer.
- Required journeys: greeting + introduction; paraphrased request; requirements before contact; knowledge interruption; detail correction; consent rejection; approval and async status; post-capture question; single/multiple follow-up acceptance; unsupported question; no sources; unrelated intent; farewell; cross-tenant access; duplicate request.
- Run a long live Azure/RAG conversation on the local Docker build, then browser-check the same behavior. Record turn IDs, modes, citations, pending requirement/state and timings, with PII masked.
- Provider-side CRM creation is a separately labelled verification with approved test data/consent and a confirmed returned ID. Mock success is not live-provider evidence.
- Review original stashed changes individually for relevant fixes; do not restore the entire stash blindly.
- Build from the main project directory using its existing `.env` and data mounts. Verify running flags, image/code version and active catalog before acceptance.

## Completion gates

All entry-path and continuation tests pass; ordinary social turns never produce knowledge abstention; a paraphrased service request selects or clarifies an eligible catalog intent; required information survives interruptions; factual answers remain grounded; consent and tenant boundaries hold; one logical opportunity remains linked; the browser reproduces the passing API journey. Report any remaining provider or data blocker explicitly.

No guarantee of every possible utterance is claimed. Uncertain or unavailable paths must fail transparently while preserving context. Passing mocked/unit tests alone does not complete this issue.
