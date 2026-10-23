# Hybrid RAG retrieval

PostgreSQL retrieval now combines authorized vector candidates with PostgreSQL simple full-text candidates using deterministic reciprocal-rank fusion. Tenant, audience, source status, publication, and version filters are applied in the candidate CTE before ranking. The query text is the masked current question plus only relevant confirmed context.

Memory-store tests retain deterministic lexical ordering for local unit coverage. The PostgreSQL path remains the production source of retrieval truth. Citation validation and no-evidence abstention remain enforced by the existing response pipeline; hybrid ranking does not widen source authorization.
