# Ponytail and Superpowers review summary

## Scope reviewed

Changed source files are limited to the v2 API audit correlation, trusted-tool
evidence conversion, Python evidence extraction, persona instruction, UAT audit
lookup and regression tests. No schema, dependency, lifecycle, provider or
operational-environment rewrite was introduced.

## Review findings

- The shared `toolEvidence` helper is bounded to 16 claims and 1,500 characters
  per item; evidence references are deterministic and tied to the tool and
  published catalog version.
- Python accepts evidence only when the returned `citationId` is present in the
  tool result's `evidenceRefs`; model-supplied citations are not trusted by
  themselves.
- Node checks tool success, scope, source version and approval before exposing
  evidence to the response guard. Provider completion still requires the
  existing verified evidence tier.
- Audit correlation validates the client message identifier and removes stale
  tenant/session-only lookup from the UAT analysis path.
- The model request budget remains bounded; no retry or side-effecting tool
  authorization was added.
- No security check, consent gate, tenant boundary or response-guard rule was
  removed. The one relaxed path is limited to safe non-factual dialogue when
  independently authorized context is present.

## Deferred or skipped

Candidate prose is not retained in the historical or final redacted UAT
artifacts, so a claim-level false-positive review could not be completed. The
Azure quality target remains failed rather than being reclassified. Salesforce
sandbox verification was not run because credentials/endpoint authorization
were unavailable. No subagent review was available in this execution; the
focused tests, typecheck, lint, build and isolated UAT were used as the review
evidence.

## Result

The diff is the smallest demonstrated correction to evidence propagation and
diagnostic correlation. It improves the evidence path without claiming that
Azure conversation quality is accepted.
