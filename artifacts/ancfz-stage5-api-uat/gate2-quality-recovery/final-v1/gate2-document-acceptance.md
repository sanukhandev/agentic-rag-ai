# Document and SF-02 acceptance

Result: `PASSED` for local synthetic intake and deterministic SF-02 mock;
Salesforce sandbox: `BLOCKED_NOT_CONFIGURED`.

- Package and quotation were confirmed before document intake.
- Invalid MIME/signature was rejected with HTTP 422.
- A harmless synthetic PDF was accepted, processed and OCR-completed.
- Duplicate upload was idempotent.
- Durable evidence recorded local processing, OCR completion,
  `documentSetComplete=true`, and `sf02AttachmentVerified=true`.
- The durable audit contained one `document.sf02_attachment_verified` event.
- No real Salesforce endpoint was contacted and no document bytes are included
  in these reports.
