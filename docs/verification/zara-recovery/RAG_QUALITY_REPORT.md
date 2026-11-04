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
| How does it work? after formation context | Generic fallback after unsupported/polarity rejection | Grounded cited contextual response in the final Docker replay; the current corpus still narrows this to the verified registration-time statement |
| Initiation after knowledge turns | No goal state | Pending `anc.company_formation` confirmation |

Claim-level tests cover numeric values, provider outcomes, polarity and source-bound paraphrase proofs. No lexical-overlap threshold is used as an acceptance gate.

## Remaining quality risk

The current corpus contains fragmented retrieval-ready records and the contextual answer can select a narrow supported detail rather than a complete process overview. A reviewed source-quality pass and three fixed Azure evaluations are still required.

## Final recovery observations

- Published ANCFZ Catalog V2 revision 3 (`anc:r3:1de595abd94fc134b5e457113e927c323a29b89da60ffa2cf9dae0574c0d0858`) adds the observed natural formation alias without repinning existing sessions.
- Query-aware projection now removes standalone document lists and incidental “additional documents” notes from broad process questions while preserving the original citation identity.
- General source language such as “can be completed” is no longer classified as a completed customer/provider outcome; actual customer completion claims remain fail-closed.
- Focused RAG/claim/coordinator coverage passes. This is not evidence that the entire ANCFZ corpus has been reviewed or that the formal Azure quality gate passes.

## Additional recovery check

Retrieval-only instructional scaffolds are now filtered from final ranked evidence when a chunk contains only template guidance (for example, “Use this knowledge domain” or “Response pattern”). The regression test passes. Public five-turn smoke still returns grounded evidence, but response completeness remains a quality risk; this is not a claim of corpus-wide quality.
