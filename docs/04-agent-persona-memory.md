# 04 — Agent persona, accounts, ticket memory and events

**Status:** target agent-centric domain only. The target contains **no Tenant** concept.

## Agent-owned configuration
The application `agent_id` is the security partition. Agent has a public key/slug, admin role bindings, Foundry project + named agent/version, persona and policy revisions, approved knowledge base, intent/offerings catalog pins, tools and workflows. No model/browser input may create authority over another Agent. An active ticket pins the published revisions.

## Identity and account access
Guest tickets may access only approved public agent knowledge. When customer provides an email, Node performs agent-scoped lookup without disclosing existence, offers time-limited OTP challenge via server-owned UI, and verifies in HTTP. OTP never enters the model conversation. Upon verification, link a permitted existing account or ask explicit opt-in to create a new one. Guest-to-account ticket binding must be audited and ownership-checked. Same email may belong to different agent accounts.

## Authoritative ticket state
`tickets` include immutable ticket number, agent ID, owner (guest/account), inferred subject/intent, state, current revision, pinned config and open/closure timestamps. `ticket_messages` are ordered by per-ticket sequence, with original client ID, role, accepted/published status and privacy-safe content. `ticket_events` are append-only and feed SSE. Facts, summarized context, private attachments, operation history, provider refs, consent and closure confirmations are linked to ticket, not to CRM identity.

## Memory layers
| Layer | Storage | Role |
| --- | --- | --- |
| Recent ordered turns | PostgreSQL | Replayable source messages |
| Verified facts/corrections | PostgreSQL | Typed values/provenance and conflict resolution |
| Compact AI summary | PostgreSQL | Versioned, derived only from valid facts/messages |
| Active context projection | Redis | Revision-tagged TTL cache for quick turns |
| Foundry history reference | Bounded external binding | Optional model optimization, not authoritative |
| OTP challenge and turn coordination | Redis + persistent audit | Expiring and rate-limited security controls |

Use a transaction to durably accept each incoming message **before acknowledgment** and deduplicate by (agent, ticket, client_message_id). Async summary/transcript projections have their own idempotent workers; they cannot overwrite newer revisions. Per-ticket lease or optimistic revision prevents parallel turns from producing conflicting replies.

## Ticket state machine
`open → in_progress ↔ waiting_for_customer ↔ waiting_for_operation → resolved → closed`. The customer must explicitly request closure. A farewell, disconnect or model judgment is not sufficient. Mark closure requested and hold if provider result is still unknown. Reopen only according to published agent policy and verified ownership.

## Server Sent Events
Node exposes authorized ticket event stream, with event ID, ticket sequence/revision and types: ticket.created, ticket.subject.updated, message.accepted, agent.response.completed, auth.challenge.required, auth.session.verified, document.processing.completed, ticket.summary.updated, operation.queued/completed/failed, ticket.closed. HTTP sends user commands. SSE resumes from Last-Event-ID using PostgreSQL ledger. Redis stream/pubsub provides ephemeral fan-out; it is not the replay authority.

## Privacy
Do not keep raw OTP, credentials, unrestricted customer documents or full private identity fields in the model context or Redis metrics. Encrypt permitted sensitive fields, mask logs, configure retention and require ticket ACL on every replay. Never store undisclosed chain-of-thought scratchpad as customer transcript.
