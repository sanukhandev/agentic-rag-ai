# Mock real-time quote guidance check

Date: 2026-11-11
Tenant: `anc` / ANCFZ
Environment: local Docker API, synthetic messages only

## Result

The application does not currently guide a customer directly from a package/quote request to a quote. It first binds the customer to the company-formation goal, requires explicit goal confirmation, then requires lead details and explicit Lead-submission confirmation before the quote workflow can proceed.

## Live sequence 1 — package request before goal confirmation

1. `Hi` → greeting.
2. `I want to open a software consultancy in Ajman. What packages do you offer?` → asks: “Would you like to proceed with start a company?”
3. `I prefer the Growth package. Can you show me the details and price?` → grounded Growth answer, AED 4,999, two visas.
4. `Please prepare a quotation for Growth.` → asks again whether to proceed with start a company.

Finding: package evidence is reachable, but quotation remains gated by goal confirmation.

## Live sequence 2 — goal confirmed, no contact details

1. Goal confirmation → asks for Lead name.
2. `What packages do you offer?` while name is pending → safe abstention.
3. `I prefer the Growth package. Show me the details and price.` → returns only the Growth price, without the complete package explanation.
4. `Please prepare a quotation for Growth.` → advances to email/phone collection.

Finding: pending Lead requirements take precedence over valid package/quote questions and produce partial or non-answer responses.

## Live sequence 3 — synthetic contact completed

1. Goal confirmation → asks for name.
2. `My name is Synthetic Customer` → asks for email/phone.
3. `[EMAIL_5]` → asks for permission to use the contact details.
4. `I consent to use my contact details for this enquiry.` → creates a Lead submission proposal and asks for explicit confirmation.

The run stopped before submitting the Lead. Read-only PostgreSQL verification for this session showed:

- `1` pending `crm.lead.create / lead.create / awaiting_confirmation` action request
- `0` CRM leads
- no quote artifact or provider action

## Verdict

The guardrails work: no side effect occurred without explicit Lead confirmation. The quote path is not yet smooth. The primary issue is pending-requirement precedence: the system prioritizes Lead collection over package exploration and quote guidance, even when the customer is asking a valid package question.
