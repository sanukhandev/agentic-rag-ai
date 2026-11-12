# New conversation core — isolated replacement candidate

**Not connected to the existing public chat route.** This is a clean new boundary
that must pass adapter integration and security tests before the current
conversation controllers can be removed.

- `contracts.ts`: typed tenant context, verified facts, durable summary, and
  model/Node interface boundaries.
- `turn-engine.ts`: one response owner (model), typed validation, idempotency,
  immutable revision checks, durable summary in the actual model envelope,
  and **no** automatic external action execution.
- `read-tool-registry.ts`: allowlisted, schema-validated, tenant-authorized
  read tool execution with size and error limits.

These contracts deliberately do **not** implement PostgreSQL, Azure calls,
LangGraph, semantic entailment or n8n. Implement adapters and run full
contract/tenant-isolation tests before this runtime can replace live chat.

Do not introduce deterministic customer dialogue scripts, direct provider writes,
RAG mutations or a second response planner when integrating this module.
