# Document ingestion, embeddings and retrieval

## Authoritative source policy
Only admin-approved, active, tenant-authorized documents are knowledge evidence. Original provenance, checksum, ownership, version, access policy, approval timestamp, effective/expiry dates, page and section must be recorded. A business answer must be traceable to specific approved source chunks. When two active sources conflict, do not choose arbitrarily; flag uncertainty or request owner review.

## Extensible file pipeline
No system can accurately support literally every file type by default. Define a parser registry and explicit supported MIME extensions. The MVP supports **DOCX (Word), XLSX (Excel), UTF-8 TXT, Markdown, CSV, JSON, JSONL/NDJSON, text-based PDF and admin-approved HTTPS webpage URL snapshots** after proving safe parsing and provenance. PPTX/HTML-as-file, legacy .doc/.xls and OCR/image formats remain extensions requiring explicit tested adapters. URL ingestion is bounded and authorized; see below. Scanned PDFs require dedicated OCR and quality checks. Reject unsupported, encrypted, corrupt or suspicious files with a visible reason.

## Pipeline stages
1. **Receive**: admin identity, tenant, source catalog, expected MIME, size, upload cap, ACL, effective dates, version and permitted audience.
2. **Validate**: magic bytes, content type, size, decompression limits, AV/malware checks, path traversal and zip bombs, external link or macro execution disabled. Private staging only.
3. **Extract**: sandboxed parser; no network fetching from embedded references; capture page/sheet/slide/headings/tables and extraction warnings.
4. **Normalize**: preserve meaningful structure and source location; no silent dropping of table headings, units, dates or disclaimers. Remove unsafe hidden instructions from control plane.
5. **Sanitize**: identify private data, credentials and regulated content; reject or tokenize/redact according to source classification and explicit approval. Never pass raw customer PII to third-party embedding endpoints.
6. **Chunk**: deterministic chunk strategy tuned to document structure; record offsets, page, section, content hash and exact source version. Use overlap conservatively and retain heading context.
7. **Embed**: use an explicitly selected **embedding model/deployment distinct from GPT-4.1-mini**; store model ID, dimensions, preprocessing version, vector creation time and chunk checksum. Embedding size must match pgvector column/index; model changes require versioned re-indexing. Credential-free local PostgreSQL runs may use a deterministic fallback at the configured dimension; production requires the configured Azure embedding provider.
8. **Index**: transactional upsert by tenant + source version + chunk fingerprint; safe retries, progress and failure states; use pgvector index appropriate to verified workload. Long-running embedding work renews its ingestion lease and reports only job/stage/counter metadata through the Redis ingestion stream; PostgreSQL remains authoritative. Migrated sources remain blocked from publication until replacement embeddings are written successfully.
9. **Evaluate and publish**: run corpus-specific sample questions with expected evidence; atomically mark new version active and retire old version. Never serve partial uploads as authoritative.
10. **Lifecycle**: revoke, re-index, delete, retention, tombstones, re-run on parser/model changes, and audit provenance.

## Retrieval
- Normalize and mask incoming text before embedding/query logging.
- Perform SQL-level tenant isolation and allowed-source filters **before returning rows**. Post-filtering only in the application is insufficient.
- Use vector similarity, optional lexical search, reranking and top-k/token limits. Record sanitized retrieval diagnostics.
- Never use similarity alone as a truth guarantee. Require an evidence sufficiency gate that checks relevance, conflicting facts, approved validity, and citation alignment.
- Cite source document/version + page/section + chunk IDs in user-visible answers where appropriate.
- Do not use deleted, unapproved, expired, quarantined, tenant-foreign or private-to-others chunks.
- A citation is valid only if it refers to evidence actually supplied to and used by the answer model. Do not generate plausible-looking source references.

## Idempotency and isolation
Re-uploading unchanged file content should not create duplicate active chunks. Fingerprint includes normalized contents, parser/chunker/embedding versions, tenant, ACL scope and relevant metadata. Maintain file-level/ingestion job statuses: pending, processing, awaiting_review, active, failed, retired, quarantined. Roll back on failure; provide actionable error messages to admins.

## Quality checks
Use test corpora: small FAQ, contradictory pricing versions, expired terms, tenant A vs B, PII-bearing DOCX, large CSV, scanned PDF, corrupted archive and adversarial prompt-injection source. Compare top-k recall, citation precision, unsupported answer rate and latency. Publish no version that fails agreed critical checks.

## Unresolved
Choose embedding deployment, upload storage, parser libraries, permitted external processing jurisdiction, vector dimensions, initial supported formats and quality thresholds before building this pipeline.

## Initial URL source security (mandatory)
Links are submitted by an authenticated tenant admin. Capture explicitly permitted HTTPS URL/hostname; enforce DNS/IP restrictions against loopback, private, link-local, multicast, metadata services and internal hostnames, including each redirect and DNS rebinding risk. Refuse credentials in URL, unsafe schemes, oversized pages, non-text types and fetch timeouts. Apply robots/terms policy. Do not recursively crawl by default; any crawl requires an explicitly bounded scope and approvals. Save URL/time/title/content checksum as source provenance. Only published snapshots are searchable; chat itself must not perform general web retrieval. Source ACL distinguishes `public_for_chat` from `internal_admin_only`; anonymous chat gets only approved public chunks.
