# ANCFZ single-journey function-calling verification

This is the focused acceptance path for one synthetic customer session. It is separate from the excluded 200-message benchmark and does not impose a 25-turn minimum.

## Architecture

The customer uses the existing Chat API. Node authenticates the tenant and session, masks PII, loads the pinned persona/catalog/journey state and approved evidence, and invokes the named Foundry agent. If the Responses API returns a `function_call`, Node validates it against the version-controlled registry, derives all identity scope from the trusted session, runs a read-only handler, audits a bounded result, and resumes the same Foundry conversation with `function_call_output`. Node still owns intent resolution, consent, lifecycle gates, outbox dispatch and callback reconciliation.

The registry currently contains:

| Function | Server-owned data | Side effect |
| --- | --- | --- |
| `search_knowledge` | tenant, channel visibility and approved pgvector scope | none |
| `get_journey_state` | session, pinned catalog and lifecycle revision | none |
| `get_available_packages` | catalog version, validated activity/entity facts | none |
| `get_document_requirements` | current opportunity, selected package and safe document status | none |
| `get_action_status` | current opportunity and verified action callback state | none |

The model cannot provide tenant IDs, session IDs, opportunity IDs, remote provider IDs, document contents, payment details or contract-signing commands.

## Candidate and serving boundary

Version 4 remains the rollback and serving baseline. The initial v5 candidate was rejected during independent validation because strict Responses schemas require every declared property to be listed in `required`; it was not promoted. A corrected v6 candidate was created from the v4 model and instruction digest with the five function definitions, and the Foundry endpoint selector remained fixed at v4. v6 is invoked only through an explicit `agent_reference` in an isolated test runtime; the normal local override continues to expect v4.

The v6 live metadata verification recorded model `gpt-4.1-mini`, no OpenAPI attachment, five strict function tools, and selector `FixedRatio: v4 / 100%`. The first successful v6 Responses cycle returned a real `function_call` for `get_journey_state`, accepted a real `function_call_output`, and returned non-empty `output_text` on the same conversation.

## Chat API evidence

The isolated candidate API was exercised through `POST /api/v1/chat/sessions` and `POST /api/v1/chat/messages`. A fresh session bound to v6 and a targeted customer message produced a real `get_journey_state` call; the internal audit record was `foundry.function_call.completed`. The public response retained exactly the existing keys: `messageId`, `sessionId`, `answer`, `grounded`, `conversational`, `citations`, `actionProposal`, `pendingPromptId`, `pendingIntentKey`, `pendingRequirementKey`, and `requestId`.

The normal v4 runtime was then rebuilt and smoke-tested. A new Chat API session persisted a binding with agent version 4 and returned the same response key set. Foundry conversation identifiers and function-call details are not exposed in the public response.

## Journey runner

Run the focused runner with:

```powershell
npm run qa:ancfz-single-journey
```

The runner creates one synthetic session, uses the API-reported pending requirement keys to supply synthetic answers, checks opportunity continuity, performs one approved knowledge interruption, corrects a qualification fact, retries one message with the same client message ID, captures redacted function-call audit evidence, and records the current lifecycle state. It does not assume assistant wording or mark a stage complete from an HTTP response, n8n execution, mock payment or generated contract.

## Seven-stage evidence boundary

| Stage | Node implementation | External proof required | Current acceptance boundary |
| --- | --- | --- | --- |
| Lead Generation | catalog, consent, action gateway and durable opportunity | verified Salesforce Lead identity and callback | sandbox test may run when explicitly enabled |
| Lead Qualification | catalog facts, provenance, correction and stage guard | server-verified qualification evidence | implemented; must precede Account |
| Account Creation | existing confirmation and `crm.account.convert` gateway | verified Account, Contact and Opportunity IDs | blocked when account workflow/provider is unavailable |
| Package Selection | approved offering, quote and selection routes | approved quote and pinned selection revision | no invented prices |
| Document Upload | secure upload, consent, OCR and SF-02 routes | reviewed OCR result and verified Salesforce attachment | binary upload alone is insufficient |
| Payment & Invoice | invoice route and payment separation | invoice artifact/provider acknowledgment; settlement state | mock payment is reported as `mock_paid`, never real settlement |
| Contract | draft route and confirmation gates | provider contract and verified signature evidence | no real signing performed |

The acceptance verdict is provider-verified only when all required evidence exists. Missing Salesforce, invoice or signing-provider acknowledgments are recorded as blockers; no remote IDs are fabricated.

## Security and recovery checks

Unit coverage verifies unknown function rejection, strict argument rejection, server-derived scope, bounded execution, audit recording and same-conversation output handling. The existing tenant/session authorization, PII masking, action idempotency, stale-revision and callback reconciliation tests remain in force. API restart recovery uses the durable Foundry binding; candidate test sessions must not reuse v3/v4 conversations.
