# Gate 3 restart and replay verification

Status: **PASSED — 34/34 checks**

The disposable `anc-mock-uat` stack was exercised with a unique synthetic `example.test` customer. The runner restarted API, model gateway, event worker, event relay and Redis, then resumed the same session.

Verified: session continuity, duplicate and conflicting client message IDs, concurrent account confirmation, package/quotation persistence, document idempotency after worker restart, forged callback rejection, replayed callback idempotency, cross-tenant document rejection, exactly one Lead, exactly one Account, one completed document, one SF-02 mock receipt, and the final stop at `document_upload` with `billing_invoice` active.

Machine-readable evidence: `report.json`.
