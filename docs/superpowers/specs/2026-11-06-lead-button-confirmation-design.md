# Lead Button Confirmation Design

## Intent

Once contact consent and required Lead details are present, Zara should present the existing server-backed Lead confirmation card. The button is the primary authorization path; arbitrary or ambiguous typed messages must not authorize submission. The existing explicit typed confirmation fallback remains for compatibility and still calls the same action confirmation path.

## Scope

- Reuse the current `ActionGateway` proposal and `/api/v1/chat/actions/:id/confirm` endpoint.
- Create an `awaiting_confirmation` Lead action on the consent-completion turn, or on a later turn while the same Lead confirmation requirement remains pending and no pending action exists.
- Return the existing `actionProposal` payload so web and admin chat clients render their current confirmation button.
- Preserve idempotency, tenant/session/opportunity checks, and provider fail-closed behavior.

## Non-goals

- No new frontend component or API endpoint.
- No arbitrary typed-message shortcut for side-effect authorization.
- No direct CRM row creation or n8n activation.

## Acceptance

- A consent-completion turn returns an `actionProposal` with an `awaiting_confirmation` action.
- The action remains unapproved until the existing confirmation endpoint is clicked.
- A later knowledge/package question does not create a second Lead action.
- Existing typed confirmation and action-gateway tests remain green.
