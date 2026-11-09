# ANCFZ Lead-to-Quote Flow Design

## Intent

Complete the local ANCFZ customer journey through a verified development quote PDF without weakening the existing V2 conversation engine, persona guard, Node action gateway, or provider fail-closed rules.

## Goals

- Make contact consent and Lead submission explicit UI button actions. Typed `yes`, `confirm`, or similar text may acknowledge the conversation but must not authorize either side effect.
- After the Lead path is ready, present the approved package options as grounded, selectable chat cards with package name, included visas, inclusions, availability, and approved price.
- When the customer selects a package card, persist the selection against the session's opportunity and trigger the catalog-approved package/quote workflow exactly once.
- Generate a development-only quote PDF through the private PDF service, persist its verified artifact metadata, and return a session-scoped download attachment in chat.
- Keep the existing natural persona responses and one-purposeful-follow-up behavior for non-action turns.
- Keep only the local workflows needed for this slice: Lead creation, package/quote preparation, and quote PDF delivery. Back up the n8n database before removing unused local workflow records.

## Non-goals

- Documents, payment, invoice, account conversion, contract, or external production CRM activation.
- Treating n8n HTTP 202, a local PDF, or a mock provider ID as real Salesforce completion.
- Bypassing Node authorization, catalog pinning, action idempotency, or provider evidence checks.
- Deleting repository workflow templates or historical database backups.

## Current constraints and decisions

- The existing n8n database has the ANCFZ V2 Lead workflow record, but the package/quote and PDF records are inactive drafts. The package draft currently points at a placeholder provider and the PDF draft references an unimplemented Node endpoint.
- The existing web client already renders `actionProposal` confirmation cards. Consent will use an explicit typed proposal in the same guarded response contract, with a dedicated consent action that cannot dispatch a CRM workflow. Lead submission remains a separate confirmation action.
- Package options will use the existing approved package store and pinned catalog scope. The selection card will carry an opaque offering ID and display-only approved fields; the browser will never calculate or submit a price.
- The package action will use the existing `package.confirm` catalog binding and n8n claim/callback envelope. Node will create the approved quote and request the private PDF artifact only after the selected package and action identity are verified.
- The quote download will be session-authorized, tenant-scoped, and served by the API from private storage. The response will expose only a safe file name, MIME type, artifact reference, and download URL.
- Local quote/PDF output will be labeled development/mock evidence. It will not advance later production stages or claim a verified Salesforce Lead unless the configured provider workflow independently supplies readback evidence.

## Alternatives considered

1. **Recommended: existing Node gateway plus local n8n/PDF boundary.** Reuse the current action gateway, catalog bindings, package lifecycle store, n8n claim/callback pattern, and private PDF service. Add only the missing chat selection contract, quote artifact persistence/download, and hardened state transitions. This preserves the target architecture and is testable locally.
2. **External provider first.** Configure Salesforce quote/PDF contracts and credentials before implementing the chat path. This is the deployment shape but is blocked by missing approved provider contracts and credentials, so it cannot validate the requested local journey now.
3. **API-only quote shortcut.** Create the quote and PDF directly from the chat controller. This is smaller but bypasses the requested workflow boundary and would make later provider replacement harder; it is rejected.

## Acceptance

- A new formation conversation shows a consent button before consent is persisted; typed consent alone never creates a Lead action.
- After the Lead details are complete and consent is button-confirmed, exactly one Lead submission button is shown. After a terminal provider failure, no new Lead button appears on unrelated messages.
- Asking for packages returns the approved package cards and a clear selection question, with no CRM or quote side effect.
- Selecting one package creates one idempotent package/quote action, persists the selected package, and does not accept an offering ID or price outside the pinned approved catalog.
- The quote workflow produces one verified development PDF artifact, and the customer receives a downloadable attachment in chat.
- Duplicate clicks, replayed messages, stale sessions, wrong tenants, wrong opportunities, expired package prices, missing consent, and provider failures remain fail-closed and do not create duplicate quote artifacts.
- Existing knowledge-only, persona, TTS, and Lead regression tests remain green.
