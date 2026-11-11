# ANCFZ 15-Use-Case Conversation Review — Fixed Run 3

Date: 2026-11-10
Branch: `test/fix-latest-main-changes`
Base under test: `origin/main` at `795d5df`
Tenant: `anc` / ANCFZ
Environment: local Docker Compose, synthetic data only
Runner: `scripts/live-session-hardening.mjs`
Artifact: `15-use-case-conversations-fixed3-2026-11-10.json`

## Executive result

The corrected run completed all 15 journeys and 94 customer turns with no runner failures. The package/quote regression is materially improved: Starter and Growth selections now resolve to grounded package answers, and quote turns reuse the selected package. The conversation is **not fully stable or acceptance-ready** because 15 turns still matched the runner's generic-like quality heuristic; a broader transcript scan found 18 generic-shaped replies.

This is a semantic-quality result, not a transport result: all 15 cases returned HTTP 200/non-empty answers, but several answers still failed to address the customer's actual question.

## Measured results

| Measure | Fixed run 3 |
|---|---:|
| Journeys | 15/15 runner pass |
| Customer turns | 94 |
| Assistant turns | 94 |
| Runner duplicate answer count | 13 |
| Generic-like turns, runner heuristic | 15 |
| Generic-shaped turns, broader text scan | 18 |
| Fallback flags | 0 |
| Action-proposal turns | 2 |
| CRM leads | 0 |
| Published catalog versions | 1; existing `anc:r12` |

The two action requests were `crm.lead.create / lead.create / awaiting_confirmation`; no CRM lead or external provider operation was created.

## Database verification

Read-only PostgreSQL inspection of the latest 15 ANCFZ sessions reported:

| Entity | Count |
|---|---:|
| Sessions | 15 |
| User messages | 94 |
| Assistant messages | 94 |
| Intent-turn assessments | 94 |
| Action requests | 2 |
| CRM leads | 0 |
| Sessions with pending offers at query time | 0 |
| Sessions with pending requirements at query time | 0 |

The published catalog remained `anc:r12:f9a46f1822603a66c0c98a94876b2fe1cb4ff3d42894f44b8816e686da935751`. No catalog write was performed.

## Case review

| # | Case | Result | Review |
|---:|---|---|---|
| 1 | `starter-package-quote-documents` | Runner pass | Starter selection and quotation are now grounded. Bare `Yes` after the quotation still falls into a generic reply; the later document question switches back to goal confirmation rather than using the selected-package context. |
| 2 | `greeting-firm-setup-clarification` | Runner pass | Greeting is clean, but setup, “How are you?”, and clarification turns remain generic instead of answering or asking a targeted question. |
| 3 | `firm-documents-and-consent` | Runner pass | Name/email state can persist with suffixed synthetic tokens, but the conversation still has a weak contact/consent progression in this journey. |
| 4 | `consulting-no-visa` | Runner pass | The no-visa constraint is not reliably reflected in package guidance; later contact/consent continuity remains weak. |
| 5 | `repeated-quote-request` | Runner pass | The second-option/continue/quote sequence still produces generic replies and repeated quote intent is not consistently resolved. |
| 6 | `package-comparison-visa-count` | Runner pass | Growth selection and its quote now resolve correctly. Comparison language and a request for five visas are still not handled as constrained requirements. |
| 7 | `social-commerce-package-selection` | Runner pass | Package-list output can still repeat for “tell me more” and quotation language when no canonical package selection is established. |
| 8 | `overseas-it-founder` | Runner pass | The later visa/business-detail turn remains generic; the abstention is safe but does not provide a useful bounded next step. |
| 9 | `uk-founder-remote-formation` | Runner pass | Overseas/physical-presence questions and no-visa vs one-visa comparison remain generic or return an unfiltered package list. |
| 10 | `growth-quote-document-followup` | Runner pass | Growth detail, quote, and document follow-up are materially better and no unavailable-information flag was emitted; the path still needs a full manual quality pass for continuity. |
| 11 | `ajman-founder-contact-consent` | Runner pass | Suffixed contact tokens are accepted and contact facts persist in some runs, but the package turn can still abstain while the contact cursor is active. |
| 12 | `two-shareholders-one-visa` | Runner pass | Starter package evidence is grounded, but the two-shareholder/one-visa constraint is not reflected in the recommendation. |
| 13 | `cosmetic-installments-human-handoff` | Runner pass | Installment and human-handoff requests still abstain without a useful handoff path; the later Free Zone LLC correction is recognized. |
| 14 | `correction-arabic-information-only` | Runner pass | Information-only mode is preserved, but guarantee wording and same-session Arabic price continuity need stronger evidence continuity. |
| 15 | `typos-licence-office-and-shareholders` | Runner pass | Typos are tolerated, but flexi-desk, bank-account, mainland-licence and cheapest-package questions still receive generic or unfiltered responses. |

## Fixes verified in this run

- Package/quote routing now covers `quote`, `quotation`, natural package names and explicit selection language.
- Package lists persist a tenant/catalog-scoped pending offer.
- Package selection matching ignores the shared `ANCFZ` brand token and uses package-specific tokens, so verbose published package keys resolve to the correct option.
- Selected package evidence is reloaded for the next quotation/detail turn.
- The model envelope exposes executable V2 read-tool names rather than raw catalog binding aliases.
- Synthetic contact fixtures now use the production token shape, such as `[EMAIL_1]` and `[PHONE_1]`; production extraction remains strict.
- The response guard remains fail-closed for conflicting or unsupported evidence.

## Remaining root-cause candidates

1. **Supporting-intent coverage is incomplete.** Comparison, visa-count, overseas, office, installment and handoff language still reaches generic/no-evidence paths because the shared turn classifier does not map those phrases to a bounded approved topic or requirement.
2. **Offer reply classification is incomplete.** Ordinal replies such as “the second option”, bare affirmative replies, and “tell me more” are not consistently resolved against the active package offer.
3. **Pending requirement precedence is too broad.** Active contact/goal cursors can override a valid package or knowledge turn, making the assistant ask for workflow progress instead of answering the current question.
4. **Requirement constraints are not carried into package ranking.** “No visa”, “five visas”, “two shareholders”, and “cheapest” are captured inconsistently or not converted into a constrained package query.
5. **Grounded continuity is not guaranteed across language and guarantee questions.** A previously verified price can be unavailable on the next turn, and an estimate can be repeated without explicitly rejecting a guarantee claim.

## Verification commands

- `npm test` — Admin 71, Web 16, API 618, chat-utils 6, contracts 6 passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed.
- `python -m pytest tests -q` from `services/model-gateway` — 45 passed.
- `python -m pytest tools/ingestion -q` — 36 passed.
- `node --check scripts/live-session-hardening.mjs` — passed.
- `docker compose ps` and API health inspection — `agentic-api` healthy; local Compose services running.
- `git diff --check` — passed.

## Verdict

**IMPROVED, but not fully stable.** The highest-priority package-list → selection → grounded-detail regression is fixed and safety boundaries remain intact. The 15-case suite still exposes generic conversational behavior and missing supporting-intent handling, so the branch is not ready for semantic acceptance or provider-backed seven-stage verification.

No commit, push, merge, catalog publication, real CRM write, payment, signature, or provider operation was performed.
