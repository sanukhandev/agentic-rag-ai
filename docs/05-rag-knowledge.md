# 05 — Foundry IQ private knowledge, ingestion and grounding

**Status:** proposed Foundry IQ architecture; current application-managed pgvector remains until separately rewritten.

## Agent-scoped knowledge
Each Agent publishes approved source versions in a distinct knowledge binding, preferably a dedicated Azure AI Search index and Foundry IQ knowledge base. Index-per-agent separation is defense in depth; Node authorization and Azure RBAC remain mandatory. No web/Bing knowledge tools, arbitrary URL fetch or second direct native agent retrieval path in the target.

## Ingestion
1. Agent admin uploads source (DOCX/PDF/TXT/approved structured content) to agent-scoped private storage.
2. Node validates type/size/malware policy, source provenance, hash and approval state; draft is not searchable.
3. Publish only reviewed versions; Foundry IQ indexer chunks/vectorizes/indexes approved content. Node records ingestion status, revision and knowledge base/index reference.
4. Ready state requires successful index confirmation plus a probe retrieval. Revoke access immediately on source withdrawal; asynchronous index cleanup must not leave revoked facts accessible.
5. Knowledge-base search responds through the agent allowlisted `search_knowledge` function: Foundry → Python → Node → Foundry IQ → Node provenance check → Python → Foundry.

## Governance and ANCFZ sample
The supplied ANCFZ RAG set contains eight subject areas each with source and descriptive variants. Deduplicate rather than index both as separate authorities. Generated retrieval appendix is **metadata**, not independently approved fact. The files mark owner approval pending; obtain sign-off before production publication. Price matrices and offerings should be moved into authoritative agent offering catalog for formal quotes; knowledge explains them, not calculates binding prices.

## Evidence contract
Search result must contain agent/source identity, approved revision/hash, access scope, location/section, extractive snippet, retrieval status and citation. A citation string alone does not prove claim entailment. Node validates cited evidence is current, accessible and actually supports each consequential claim. Spoken/cited conversational pleasantries need no business source; legal/pricing/policy assertions do.

Use Foundry IQ **extractive** results when the model already composes the answer; avoid redundant retrieval-answer synthesis without quality evidence. Evaluate recall, precision, citation grounding, latency and costs per Agent. Unsupported/revoked source requires abstention or a useful clarification.

## Separate customer documents
Ticket uploads (IDs, application forms, business descriptions) remain in private ticket document storage, not the shared knowledge base. OCR/Azure Document Intelligence extracts text/tables/structured fields with source-page IDs and extraction confidence; Node validates/approves relevant facts. `get_document_data` returns minimum verified agent/ticket-scoped fields to Foundry for AI summary. Structured PII is encrypted and not reindexed as business knowledge.

## POC migration safety
Target ordinary PostgreSQL has no vector extension, embedding columns or HNSW indexes. Previous `source_chunks`, vector data and file contents are historical state, not needed by target runtime. Do not change the running PostgreSQL image until migration chain and code are entirely rewritten and validated on a fresh disposable database. Keep a snapshot/backup if existing POC knowledge must be retained.
