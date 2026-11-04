# Customer Journey E2E Report

## Public five-turn regression

**Result:** PASS on a fresh authorized public API session after the recovery build.

1. `hello` → Zara greeting.
2. `Tell me about company formation` → grounded cited ANCFZ response.
3. `How does it work?` → grounded cited contextual response.
4. `I want to start company formation` → explicit confirmation prompt; pending key `anc.company_formation`; no action.
5. `No, not now` → informational acknowledgement; pending prompt cleared; no action.

## Full company-formation journey

**Status:** NOT RUN. Lead creation, qualification, document/SF-02, package, quotation, Salesforce readback, restart/replay and browser acceptance remain unverified.
