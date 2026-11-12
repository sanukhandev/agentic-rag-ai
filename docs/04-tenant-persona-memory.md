# 04 — Tenant persona and conversation memory

**Status: target behavior and data contracts.**

## Tenant configuration
Every tenant has independent identities, data, approved content and published configuration. The assistant's display name, language set, tone, style, brand guidance, escalation rules and knowledge/tool policies belong to a versioned tenant persona. A session pins a published persona revision and relevant catalog revision. Draft edits cannot silently affect open conversations.

Tenant-specific assistant examples must remain data, not hardcoded system prompts. An ANCFZ assistant is one example; customers of another tenant must never inherit its name, services, policies or prompts.

## Persona resolution
1. Node derives the tenant from trusted channel authentication or verified routing; it never accepts model-selected tenant identity.
2. Node checks the authenticated user's access to the selected conversation.
3. Node loads the published, authorized persona and catalog revision (or the session's existing pins).
4. Python receives only the permitted persona fields and model instructions in a signed, scoped turn envelope.
5. The model answers as that assistant in the customer's selected/appropriate supported language.
6. Node checks for identity/policy leakage without imposing scripted wording or a rigid one-question format.

## Three-layer memory
| Layer | Contents | Authority |
| --- | --- | --- |
| Recent turns | A bounded set of actual customer and assistant messages | PostgreSQL turn ledger, reconstructed by Node |
| Durable customer context | Validated requirements, customer corrections, goal candidates, stage/action status, consent and evidence provenance | PostgreSQL structured state |
| Compact summary | Relevant completed conversation topics, pending question, verified decisions and unresolved ambiguity | Versioned, validated summary maintained by Node |

A summary is an optimization, not a replacement for verified facts or actual provider status. The model must receive both relevant recent history **and** the durable summary. A provider-issued receipt may establish an action outcome; the assistant's recollection cannot.

## Suggested records
- Tenant, user or anonymous principal, session, conversation, owner and access controls.
- Ordered turns with client message ID, assistant response, timestamps, provenance and response guard result.
- Persona/catalog revision pins, model profile and last authorized context revision.
- Facts: typed key, value or encrypted reference, confidence class, origin, observed turn, timestamp and superseded status.
- Goals: candidate key, supporting evidence, ambiguity state and associated requirements; not implicit workflow authorization.
- Actions: proposed, awaiting_authorization, queued, executing, verified_completed, failed or reconciliation_required.
- Summaries: text plus creation timestamp, context version and source turn range, with prompt-injection-resistant formatting.
- Consent: action purpose, lawful basis where applicable, scope, actor, timestamp, version and revocation policy.

## Continuation and correction
- Authenticated cross-session resume requires explicit ownership/ACL checks; a guessed session ID cannot retrieve another user's history.
- Anonymous-to-authenticated session attachment requires identity proof, an audited binding and no cross-tenant reassignment.
- Later customer corrections supersede old assertions; preserve their audit trail and do not regress to stale summary values.
- If a summary conflicts with verified structured facts, verified facts win and the summary is regenerated or repaired.
- Summaries must not carry external document instructions forward as authoritative system policy.

## Storage, privacy and lifecycle
Encrypt sensitive fields and backups; mask application logs, model/tool traces and support views. Apply tenant-configurable retention and deletion policies subject to legal requirements. Use Redis only for expiring cache/coordination; loss of Redis must not erase conversation state. Protect against concurrent replies with optimistic version checks or serialized turn processing. Do not persist model scratch reasoning or undisclosed raw thought traces.
