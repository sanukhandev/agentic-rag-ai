# Agentic E2E harness

This runner sends real customer messages to the running Docker Compose API. It creates a new synthetic identity reference per scenario, reads durable session state through the Postgres container, and records strict assertions without treating provider failures as success.

Run from the repository root:

```text
npm run qa:agentic-e2e
```

The report is written to `artifacts/agentic-e2e/`. Transcripts and identity documents are not stored.
