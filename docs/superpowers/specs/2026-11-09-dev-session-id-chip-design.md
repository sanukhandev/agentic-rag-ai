# Development Session ID Chip

## Intent

Make the active chat session easy to correlate with API logs and human review in the development web client by showing the existing session ID beside the chat controls and providing a copy button.

## Goals

- Show the authoritative `sessionId` already held by `apps/web/app/page.tsx`.
- Keep the control development-only so production users do not see internal identifiers.
- Copy the exact session ID through the browser clipboard API and give short visible feedback.
- Keep the control disabled and clearly inactive before a session exists.

## Non-goals and anti-goals

- No API, persistence, session lifecycle, conversation, or security-policy changes.
- No new session ID generation or alternate identifier.
- Do not expose message contents, tenant secrets, or credentials.
- Do not add a diagnostics panel or dependency for this single value.

## Constraints

- Reuse the existing `sessionId` state and `navigator.clipboard` pattern in the page.
- Preserve the current responsive header layout and accessibility conventions.
- Prove the visible formatting and copy-state behavior with a focused web test before implementation.

## Approaches

1. **Header chip (selected):** a compact `Session ID` label, truncated value, and copy button beside the model status. This is visible where developers already inspect the active chat and requires only local UI state.
2. **Diagnostics panel:** a separate expandable developer panel. It is more extensible but adds unnecessary layout and state for one identifier.

The header chip is selected because it is the smallest complete change, preserves the existing page structure, and does not affect customer conversation behavior.

## Open implementation decisions

- Use `process.env.NODE_ENV !== 'production'` as the build-time gate.
- Use a small formatter that preserves the full ID in the button title/accessible label while displaying a shortened value.
- Reuse a dedicated copy state key so message-copy feedback and session-copy feedback cannot interfere.
