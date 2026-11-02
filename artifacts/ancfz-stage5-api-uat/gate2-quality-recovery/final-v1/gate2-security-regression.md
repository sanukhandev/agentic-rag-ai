# Security regression

Result: `PASSED` — 9/9 checks.

The isolated HTTP suite verified missing and invalid session credentials,
cross-tenant document configuration/list/upload, cross-session access and
action confirmation, same message ID with conflicting content, and no action or
document side effects from unauthorized requests. The full Node suite also
covered stale revisions, callback replay and document scope.

Machine-readable evidence: `security-regression.json`.
