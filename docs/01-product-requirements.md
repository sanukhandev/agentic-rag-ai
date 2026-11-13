# 01 — Agent-centric product requirements

**Status:** target behavior; code and database remain on the previous architecture until implementation.

## Primary domain
An **Agent** owns its Foundry agent/version, persona, private RAG, published intent catalog, offerings/products/services, tool allowlist, workflow bindings, accounts and support tickets. The target contains no Tenant domain. ANCFZ is sample Agent data.

## Actors
Guest customer (public approved knowledge and limited ticket), verified customer (agent-scoped tickets/account), Agent administrator (publishes Agent configuration and reviews tickets), platform administrator (agent provisioning and infrastructure), operator (scoped events/reconciliation).

## Customer journey
1. Greet naturally; create a durable ticket on first accepted interaction with immutable ticket ID and default subject.
2. Use \`find_intents\` to discover goals from conversation and \`get_intent_requirements\` for applicable facts, documents and prerequisites. Update the ticket header subject after validating intent.
3. Ask follow-ups only if materially useful; answer agent-specific business facts from approved Foundry IQ/canonical offerings. Greeting and farewell do not need citations.
4. Reuse verified facts, recent turns and durable summary. Multiple topics/intent corrections can exist within one open ticket.
5. Optional email-based identity: Node performs agent-scoped lookup and secure OTP challenge; no account enumeration or OTP in model context. Existing accounts link after verification; new accounts require verified opt-in.
6. Optional private uploads: OCR/Document Intelligence extracts source-linked structured fields; model produces a user-reviewable summary. Customer docs are not added to shared RAG.
7. With confirmed required facts and purpose-specific consent, propose \`create_lead\`, \`generate_quote\` and other agent-published operations. Node independently authorizes + outboxes; n8n completes and provider evidence updates ticket.
8. SSE updates ticket number, subject, agent responses, auth, extraction, action state, quote link and audit status. Commands use authorized HTTP, not SSE.
9. Only explicit customer confirmation closes a ticket; pending unknown outcomes must reconcile. Customers may resume according to agent access policy.

## Agent administration
Draft → validate → preview/test → publish immutable revision → activate. Version persona, model/agent binding, knowledge approval, intents, requirements, offerings and prices, tools and workflows independently. Pin versions to in-progress tickets. JSON/YAML import/export must never execute URLs/scripts.

## Non-functional requirements
Strict \`agent_id\` partition for all storage/cache/RAG/callbacks; durable intake and replayable events; per-ticket turn sequencing; bounded function budget; typed schemas; idempotent provider actions; encrypted PII; operational telemetry; model accuracy and human-quality evaluations.

## Exclusions
No global tenant concept, fixed ANCFZ journey, enforced routine goal confirmation, direct model-to-n8n writes, model-owned OTP/identity, auto-publishing customer docs to shared knowledge, vector columns in target PostgreSQL, raw web browsing, or claims of completed work based only on webhook 200.
