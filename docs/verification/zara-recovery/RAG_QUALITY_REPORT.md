# RAG Quality Report

**Status:** PARTIAL PASS — core regression recovered; corpus quality is not full acceptance.

## Inventory

- ANCFZ active public sources: 8
- ANCFZ active public chunks: 1,013
- Revoked sources observed during baseline: 0
- Source identity/version checks: PASS in unit coverage and public cited responses

## Regression observations

| Query | Baseline | Recovery smoke result |
| --- | --- | --- |
| Tell me about company formation | Generic fallback after `invalid_question` | Grounded cited source response |
| How does it work? after formation context | Generic fallback after unsupported/polarity rejection | Grounded cited contextual response; exact wording varied by Azure run |
| Initiation after knowledge turns | No goal state | Pending `anc.company_formation` confirmation |

Claim-level tests cover numeric values, provider outcomes, polarity and source-bound paraphrase proofs. No lexical-overlap threshold is used as an acceptance gate.

## Remaining quality risk

The current corpus contains fragmented retrieval-ready records and the contextual answer can select a narrow supported detail rather than a complete process overview. A reviewed source-quality pass and three fixed Azure evaluations are still required.
