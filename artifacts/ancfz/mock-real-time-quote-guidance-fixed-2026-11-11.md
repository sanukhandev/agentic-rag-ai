# ANCFZ mock real-time quote guidance — fixed replay

Date: 2026-11-11
Environment: local Docker API/model-gateway with synthetic inputs
Scope: package discovery, package detail, quote guidance; no real CRM/payment/signature/provider operation

## Outcome

The pending-contact interruption is fixed. While `lead_contact_name` is pending, `What packages do you offer?` now returns the approved package list with Growth, Premium and Starter details and the purposeful follow-up `Which package would you like to explore first?`. The reply is citation-backed and does not create an action.

The replay then selected Growth and returned approved pricing, but the quote request correctly remained gated by the active contact requirement. No quote was generated until the required contact and explicit action confirmation are supplied. No CRM lead was created.

## Reliability note

One first attempt returned HTTP 500 with `V2_MODEL_INVALID_RESPONSE` on the goal-confirmation turn. Retrying the same user intent succeeded and the remainder of the replay completed. This is a transient model-response reliability issue, not a package-evidence or safety-guard failure, and remains a deployment risk to monitor.

## Review verdict

**Improved and safer, but not full seven-stage acceptance.** The specific unstable package interruption is resolved and covered by a regression test. Remaining scope includes richer package-detail answers, quote completion after contact/action confirmation, and provider-backed Account, document, payment/invoice and contract verification.
