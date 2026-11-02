# Five-stage durable lifecycle

| Stage | Durable result | Evidence |
|---|---|---|
| Lead Generation | completed | mock provider action, provider verified |
| Lead Qualification | completed | valid facts and qualification decision |
| Account Creation | completed | linked mock Account provider evidence |
| Package Selection | completed | confirmed selection and quotation |
| Document Upload | completed | OCR, complete document set and SF-02 mock receipt |
| Billing & Invoice | awaiting_customer | intentionally not executed |
| Contract | not_started | intentionally not executed |

Last completed stage: `document_upload`. Current active and next pending stage:
`billing_invoice`. The acceptance run stopped at Stage 5 and performed no
payment, invoice or contract action.
