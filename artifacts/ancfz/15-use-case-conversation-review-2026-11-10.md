# ANCFZ 15-Use-Case Conversation Review

Date: 2026-11-10
Branch: `test/fix-latest-main-changes`
Commit under test: `795d5df`
Tenant: `anc` / ANCFZ
Environment: local Docker stack, synthetic conversations only
Runner: `scripts/live-session-hardening.mjs`

## Executive result

The run completed all 15 journeys and 94 customer turns. The transport-level result was **14/15 pass, 1/15 fail**. The transcript review finds that the conversational result is **not ready for acceptance**: the API usually returned HTTP 200, but frequently did not answer the customer’s actual question or preserve the selected package/requirements.

No external business side effects were created during this run:

- 15 sessions created
- 94 user turns and 94 assistant turns persisted
- 0 action requests
- 0 CRM leads
- No provider operation was initiated through an action request in this run

## Automated evidence

| Measure | Result |
|---|---:|
| Journeys completed | 15/15 |
| Basic runner pass | 14/15 |
| Basic runner failure | 1, case 10 turn 3 |
| Customer turns | 94 |
| Assistant turns | 94 |
| Duplicate answer digests | 19 |
| Generic/non-answer replies observed | 25 |
| Approved package-list replies | 14 |
| Safety abstentions | 5 |
| Offline-information fallback | 1 |
| Action requests / CRM leads | 0 / 0 |

The basic runner checks status, non-empty answer text, obvious internal/mock markers, fallback markers and duplicate digests. It does **not** determine whether the answer addressed the user’s request; the transcript review below does that.

## Case-by-case review

| # | Case | Runner | Review result | Main finding |
|---:|---|---|---|---|
| 1 | `starter-package-quote-documents` | PASS | Needs revision | Selecting Starter produced a generic reply; the quote was repeated after “Yes”; documents then redirected to goal confirmation instead of answering the document question. |
| 2 | `greeting-firm-setup-clarification` | PASS | Fail, substantive | “How can I open a firm?”, “What essentials…?” and the clarification all received generic prompts; no useful answer or targeted clarification was delivered. |
| 3 | `firm-documents-and-consent` | PASS | Needs revision | Name capture worked, but the email turn and following consent were not recognized; the conversation stalled on `lead_contact_channel`. |
| 4 | `consulting-no-visa` | PASS | Fail, substantive | The customer explicitly requested a package without a visa, but the assistant recommended Starter with one visa. Email and explicit contact consent were then ignored. |
| 5 | `repeated-quote-request` | PASS | Fail, substantive | “The second option”, proceed, quote, and repeated quote requests produced a generic loop; four duplicate answer digests were recorded. |
| 6 | `package-comparison-visa-count` | PASS | Fail, substantive | Growth selection, quote request, and Growth/Premium comparison were not acknowledged. A request for five visas returned the full Growth package with two visas. |
| 7 | `social-commerce-package-selection` | PASS | Fail, substantive | The package list was repeated for “tell me more” and again for the quotation request; the selected package was never established. |
| 8 | `overseas-it-founder` | PASS | Needs revision | The question about starting before travel was safely abstained from, but no useful bounded answer or follow-up was offered; the later visa fact also received a generic reply. |
| 9 | `uk-founder-remote-formation` | PASS | Fail, substantive | Overseas/physical-presence questions and the quotation request were generic. “Compare no visa vs one visa” returned all packages rather than the requested comparison. |
| 10 | `growth-quote-document-followup` | **FAIL** | Fail, substantive | Growth details returned “The approved information is temporarily unavailable.” The later quote request was generic; the final document answer was useful but earlier turns had already stalled. |
| 11 | `ajman-founder-contact-consent` | PASS | Fail, substantive | Name capture worked, but email/phone and explicit consent were not applied. The later package request returned a safety abstention while the contact requirement remained pending. |
| 12 | `two-shareholders-one-visa` | PASS | Needs revision | The two-shareholder/one-visa requirement was not reflected in the recommendation. Package listing and Starter quote worked, but without acknowledging the requested structure. |
| 13 | `cosmetic-installments-human-handoff` | PASS | Fail, substantive | Installment question and “Can I talk to a human?” both received safety abstentions with no handoff path. The later Free Zone LLC update was recognized. |
| 14 | `correction-arabic-information-only` | PASS | Fail, substantive | The “2 visas” correction and information-only preference were recognized. However, “guaranteed in 2 hours?” repeated the two-hour estimate without explicitly rejecting the guarantee, and the final Arabic price question contradicted the immediately preceding verified Premium price. |
| 15 | `typos-licence-office-and-shareholders` | PASS | Fail, substantive | Visa/licence options were answered with document requirements; flexi desk, bank account and mainland licence questions received generic prompts; “cheapest package” returned all packages instead of the cheapest option. |

## Highest-priority defects

### 1. Contextual intent routing is not reliable

The most common failure is a generic answer such as “I can help you work through that” when the customer asked for a package, quote, comparison, document list, human handoff or business-policy answer. This occurred 25 times in 94 assistant turns and creates false green HTTP results.

Representative examples:

- “I will go with Growth” → generic help prompt.
- “Can I get the quote for Growth now?” → generic help prompt.
- “Can you prepare a proper quotation with the full breakdown?” → generic help prompt.
- “Can I talk to a human?” → safety abstention, no handoff option.

### 2. Package selection is not bound to the conversation

The assistant lists packages successfully, but often fails to bind a customer selection to the next turn. “Starter”, “Growth”, “the second option” and “this package” do not reliably produce a selected package, tailored detail or quote. Package-list output is then repeated instead.

### 3. Requirements and contact consent stall

Name capture works in the tested paths, but email/phone and explicit consent frequently fail to advance the pending requirement. Cases 3, 4 and 11 show the assistant asking for the same contact channel or returning a generic prompt after valid synthetic contact input and consent.

### 4. Specific constraints are contradicted or ignored

- “Without a visa” received Starter with one visa.
- “Five visas” received Growth with two visas.
- “No visa vs one visa” received the unfiltered package list.
- “Two shareholders and one visa” was not reflected in package guidance.
- “Cheapest package” received all packages rather than the minimum-priced option.

### 5. Knowledge-only and correction behavior needs stronger grounding continuity

The information-only correction case correctly stopped workflow capture, but two issues remain:

- A two-hour estimate was repeated in response to a question explicitly asking whether the result was guaranteed. The reply should state that the estimate is conditional and not a guarantee.
- The assistant gave Premium as AED 7,899.00, then refused to verify the same Premium price in Arabic on the next turn. This is a same-session evidence/language continuity defect.

### 6. Safe abstention is too broad in several ordinary support paths

Abstention is preferable to an invented fact, but the current response often stops without a useful next step. This affects overseas setup, installment payments, human handoff and some package/visa questions. The fallback should distinguish “not verified” from “not supported” and offer an approved next action or handoff where available.

## Positive observations

- Greeting responses were consistent and did not expose internal keys or raw JSON.
- Package prices and visa counts were generally consistent when the package was directly named.
- The information-only correction (“No, I only need information”) was honored and did not trigger a CRM action.
- The final document answer in case 10 was concrete and useful.
- The Free Zone LLC structure update in case 13 was acknowledged.
- No action proposal, CRM lead or provider operation was created accidentally.
- No obvious hardcoded/test/mock response marker appeared in the customer-visible replies.

## Acceptance assessment

**Verdict: PARTIAL / FAILED FOR CONVERSATIONAL QUALITY.**

The run demonstrates that the local API and model path can complete 15 synthetic sessions without transport failure, and it preserves the no-side-effect boundary. It does not demonstrate dependable goal-first conversation delivery. In particular, the following acceptance areas remain open:

- intent classification and clarification
- package selection and quote continuity
- requirement fulfillment and consent progression
- knowledge-only answers and same-session evidence continuity
- useful abstention and human handoff
- one purposeful, context-aware follow-up

This run does not verify the seven external business stages, provider callbacks, payment settlement or contract signature. It also does not constitute a human persona-quality score; the findings here are transcript-level engineering observations.

## Review artifacts

- [Runner report](15-use-case-conversations-2026-11-10.json) — redacted user messages, assistant previews/digests, status and flags.
- [Masked database transcript](15-use-case-db-transcript-2026-11-10.json) — persisted 15-session conversation content used for this review.
- [Runner source](../../scripts/live-session-hardening.mjs) — the 15 synthetic journeys and automated checks.

## Recommended next verification

Fix the shared intent/continuity path before expanding the test suite. Then rerun these same 15 journeys with per-turn assertions for selected package, requested visa count, document answer, contact consent, information-only mode, guarantee language, handoff, and Arabic continuity. Keep the side-effect assertions at zero for this review harness.
