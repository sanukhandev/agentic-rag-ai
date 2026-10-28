# Live API conversation evidence — 2026-10-28

Target: local Docker Compose stack at `http://localhost`, tenant `anc`.

Configuration used:

- Intent catalog upload: `ANCFZ_Intent_Catalog_Review_Import_Fixed_2026-10-27.xlsx`
- Published catalog version: `70e93416-c567-4e87-870e-47b6476d9d0f` (version 2)
- RAG upload: `OneDrive_1_23-10-2026.zip`
- RAG source: existing source `5ec648ca-51e7-4c1c-81b1-ac724e121e78`, reused by content-hash idempotency and active
- API session: `272af91e-e602-4e1c-9fc2-39fe84469b78`

## Conversation transcript

| # | User message | HTTP | Assistant result | Pending requirement | Citations |
|---:|---|---:|---|---|---:|
| 1 | I want to start a digital marketing company and want to know the steps and cost. | 200 | `What name should I use?` | `slot:name` | 0 |
| 2 | What visa packages are available? | 200 | Approved-knowledge abstention | `slot:name` (preserved) | 0 |
| 3 | I want to continue with the company setup. | 200 | `What name should I use?` | `slot:name` | 0 |
| 4 | We need two visas and a shared office. We plan to start next month with a budget of AED 25000. | 200 | `What name should I use?` | `slot:name` | 0 |
| 5 | My name is Sarah Khan. | 200 | `Thanks. What email address should I use?` | contact collection | 0 |
| 6 | `[EMAIL_1]` (submitted as a real email) | 200 | Phone-number request | contact collection | 0 |
| 7 | `[PHONE_1]` (submitted as a real phone) | 200 | Consent action presented | `slot:contact_consent` | 0 |

The final action was created as:

- Action ID: `f4d6b4ea-5f2d-4812-a044-1ced25a646ef`
- Intent: `anc.setup.new_company`
- Opportunity ID: `4993291a-13c5-4862-9039-6539fe82d731`
- State: `awaiting_confirmation`
- Catalog version: `70e93416-c567-4e87-870e-47b6476d9d0f`

## Persisted-state evidence

After all seven turns, PostgreSQL stored the opportunity-scoped values:

```json
{
  "selectedIntentKey": "anc.setup.new_company",
  "activeIntentKey": "anc.setup.new_company",
  "pendingRequirement": "slot:contact_consent",
  "slotValues": {
    "name": "[NAME_1]",
    "email": "[EMAIL_1]",
    "phone": "[PHONE_1]",
    "interest_summary": "I want to start a digital marketing company and want to know the steps and cost.",
    "company_structure": "I want to start a digital marketing company and want to know the steps and cost.",
    "office_requirement": "We need two visas and a shared office. We plan to start next month with a budget of AED 25000."
  }
}
```

The expected `visa_count`, `timeline`, and `budget_aed` values were not persisted.

## RAG control test

In a fresh session, the same knowledge request `What visa packages are available?` returned HTTP 200 with four citations and grounded content, including the source-backed AED 4,888 starting package and the documented 10-visa package range.

This proves the source and retrieval layers work for a standalone knowledge turn. The active-journey path is the failing boundary.

## Verdict

**FAIL — not acceptance-ready.**

Working behavior:

- Docker services were healthy.
- Tenant/catalog/source selection worked.
- The active opportunity remained stable through the turns.
- Contact PII was tokenized in persisted state.
- Consent remained explicit and the CRM action stopped at `awaiting_confirmation`.

Blocking defects exposed by this live API run:

1. A mixed transactional + knowledge turn does not return the requested grounded answer before asking for contact.
2. A knowledge interruption during an active journey abstains despite the same standalone query retrieving approved evidence.
3. A multi-slot message does not persist visa count, timeline, and budget; it is incorrectly mapped into unrelated slots.

The consent action was intentionally not confirmed, so no CRM/n8n side effect was triggered.

## Reliability-fix rerun (current branch)

After the conversation-path fixes and rebuilding the local API image, session `7ded21b3-1d6c-480f-856f-bf62a0716be7` produced:

| # | Result | Grounded/citations | Pending |
|---:|---|---|---|
| 1 | Mixed company-setup + steps/cost request returned a cited conflict-safe response instead of collecting contact first. | `true` / `4` | unchanged journey context |
| 2 | Visa package interruption returned approved package evidence and preserved the setup journey. | `true` / `4` | unchanged journey context |
| 3 | Resume request returned the catalog requirement for the business description. | `false` / `0` | `slot:interest_summary` |
| 4 | Out-of-order facts were accepted without changing intent. | `false` / `0` | `slot:name` |

Persisted opportunity facts after turn 4 (token-safe):

```json
{
  "timeline": "next month",
  "budget_aed": "25000",
  "visa_count": "2",
  "interest_summary": "We need two visas, a shared office, and would like to start next month with a budget of AED 25000.",
  "company_structure": "I want to continue with the company setup."
}
```

The imported catalog does not currently define an executable `workspace/office` requirement for this journey, so shared-office capture remains a catalog configuration gap rather than an application fallback. The supplied workbook also imports without executable `journeyRequirements`/`journeyTransitions`; contact and consent therefore still use the legacy slot fallback. No CRM action was confirmed and no Salesforce/n8n side effect was executed.
