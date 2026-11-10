# Development Session ID Chip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the active web chat session ID in a development-only header chip with an accessible copy button and visible copied feedback.

**Architecture:** Reuse the existing `sessionId` state in `apps/web/app/page.tsx`. Add one pure display formatter in the web chat utilities for deterministic, testable presentation, and keep clipboard state local to the page. No API or conversation code changes.

**Tech Stack:** Next.js, React, TypeScript, Vitest, Tailwind utility classes.

**Spec:** `docs/superpowers/specs/2026-11-09-dev-session-id-chip-design.md`

## Global Constraints

- Preserve the existing public Chat API and conversation behavior.
- Keep tenant/session identity authoritative in the existing session state; do not create a second identifier.
- Do not expose secrets, raw model output, or customer conversation data.
- Keep the change development-only and avoid new dependencies.
- Preserve responsive layout and accessible button labels.

## Review Focus

- No active session: the chip must not suggest a session exists and its copy action must be unavailable.
- Long UUID: the visual value must remain compact while the full value remains available to assistive technology/title text.
- Clipboard unavailable or rejected: the UI must not claim a copy succeeded.
- Session reset/new session: copied state must clear and the displayed ID must follow the existing `sessionId` state.
- Production build: the development-only control must not render when `NODE_ENV` is production.

---

### Task 1: Add the dev-only session ID chip

**Files:**
- Modify: `apps/web/app/chat-utils.ts` — add `formatSessionIdForDisplay(sessionId: string | null): string`.
- Test: `apps/web/app/chat-utils.test.ts` — cover null, short, and UUID-like values.
- Modify: `apps/web/app/page.tsx` — render the gated header chip, add session-copy state/action, and clear that state on reset.

**Interfaces:**
- Consumes: existing `sessionId: string | null` state, existing `navigator.clipboard` capability, existing header and Tailwind conventions.
- Produces: a development-only chip labeled `Session ID`, a copy button with the full ID in its accessible label/title, and `Copied` feedback only after a successful clipboard write.

- [ ] **Step 1: Write the failing formatter tests**

  Add a test named `formats the development session ID without exposing a long UUID in the chip` asserting:
  - `formatSessionIdForDisplay(null)` returns `Not started`.
  - a short ID is returned unchanged.
  - a UUID-like ID is shortened to its leading and trailing segments with an ellipsis.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `npm run test --workspace @agentic-rag/web -- apps/web/app/chat-utils.test.ts`

  Expected: FAIL because `formatSessionIdForDisplay` is not exported yet.

- [ ] **Step 3: Implement the formatter and chip**

  Add the minimal formatter in `apps/web/app/chat-utils.ts`. In `page.tsx`, add a dedicated `sessionCopied` state and a `copySessionId` handler that returns when there is no ID or clipboard API, awaits `navigator.clipboard.writeText(sessionId)`, and sets feedback only after success. Render the control only when `process.env.NODE_ENV !== 'production'`; disable it when `sessionId` is null and use the formatter for the visible value. Reset `sessionCopied` in `reset`.

- [ ] **Step 4: Run the focused web tests**

  Run: `npm run test --workspace @agentic-rag/web -- apps/web/app/chat-utils.test.ts`

  Expected: PASS with the existing web utility tests plus the new formatter test.

- [ ] **Step 5: Run typecheck and web build**

  Run: `npm run typecheck --workspace @agentic-rag/web` and `npm run build --workspace @agentic-rag/web`

  Expected: both commands exit 0 with no TypeScript or Next.js build errors.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/web/app/chat-utils.ts apps/web/app/chat-utils.test.ts apps/web/app/page.tsx docs/superpowers/specs/2026-11-09-dev-session-id-chip-design.md docs/superpowers/plans/2026-11-09-dev-session-id-chip.md
  git commit -m "feat: show dev chat session id"
  ```
