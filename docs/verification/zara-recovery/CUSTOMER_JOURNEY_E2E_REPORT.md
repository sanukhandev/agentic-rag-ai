# Customer Journey E2E Report

## Public five-turn regression

**Result:** PASS on a fresh authorized public API session after the recovery build.

1. `hello` → Zara greeting.
2. `Tell me about company formation` → grounded cited ANCFZ response.
3. `How does it work?` → grounded cited contextual response.
4. `I want to start company formation` → explicit confirmation prompt; pending key `anc.company_formation`; no action.
5. `No, not now` → informational acknowledgement; pending prompt cleared; no action.

## Public 25-turn conversation persistence harness

**Result:** PASS after fixing the package-tool citation boundary.

- Route: public Nginx → API → Python model gateway → PostgreSQL.
- Tenant: `anc` with synthetic conversation content.
- Turns answered: 25/25.
- Durable unique customer messages: 25.
- External CRM, document, invoice and signing outcomes: not exercised by this harness.

The first run stopped at turn 12 with PostgreSQL `22P02` because synthetic `tool-*` evidence was queried as a UUID source. That failure and its regression test are recorded as ZARA-005 in the root-cause report.

## Full company-formation journey

**Status:** NOT RUN. Lead creation, qualification, document/SF-02, package, quotation, Salesforce readback, restart/replay and browser acceptance remain unverified.
