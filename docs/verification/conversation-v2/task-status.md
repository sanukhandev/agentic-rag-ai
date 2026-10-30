# Conversation Engine v2 task status

Updated: 2026-10-30
Source of issue state: GitHub `v2-feature` issue state, fetched before issue #82 work.
Branch: `feat/conversation-engine-v2`

`#124` is a manual hold and is never executed or closed automatically. All
other entries below were OPEN at baseline; dependency readiness must be checked
again from GitHub before each task.

| Issue | Phase | Status | Evidence / blocker |
| ---: | --- | --- | --- |
| #82 | P0-01 | CLOSED | `docs/verification/conversation-v2/V2-P0-01.md`; remote commit `983f105681db6d123eb0ca4cd8285fda9fd10b00` |
| #83 | P0-02 | BLOCKED / OPEN | `docs/verification/conversation-v2/V2-P0-02.md`; Azure OpenAI endpoint, deployment, key and private gateway key absent |
| #84 | P0-03 | CLOSED | `docs/verification/conversation-v2/V2-P0-03.md`; remote commit `76505897b6c11b881e3223206dc4203feb0324cc` |
| #85 | P0-04 | CLOSED | `docs/verification/conversation-v2/V2-P0-04.md`; remote commit `a57885c7c676b5d9d94b7a691de805611d23f96e` |
| #86 | P0-05 | CLOSED | `docs/verification/conversation-v2/V2-P0-05.md`; remote commit `a7e437f66e949ff03e3cbe5ce078b57f8d85f1c1` |
| #87 | P1-01 | OPEN | Depends on #84 |
| #88 | P1-02 | OPEN | Depends on #87 |
| #89 | P1-03 | OPEN | Depends on #88 |
| #90 | P1-04 | OPEN | Depends on #84 and #89 |
| #91 | P1-05 | OPEN | Depends on #87–#90 |
| #92 | P2-01 | OPEN | Depends on P0/P1 contracts |
| #93 | P2-02 | OPEN | Depends on #92 |
| #94 | P2-03 | OPEN | Depends on #92–#93 |
| #95 | P2-04 | OPEN | Depends on #92–#93 |
| #96 | P2-05 | OPEN | Depends on #92–#94 and persona publication |
| #97 | P3-01 | OPEN | Depends on #83 and private gateway boundary |
| #98 | P3-02 | OPEN | Depends on #85 and #97 |
| #99 | P3-03 | OPEN | Depends on #85 and #98 |
| #100 | P3-04 | OPEN | Depends on #99 and catalog/RAG contracts |
| #101 | P3-05 | OPEN | Depends on #92–#100 |
| #102 | P3-06 | OPEN | Depends on #100–#101 |
| #103 | P4-01 | OPEN | Depends on #98 and persona contract |
| #104 | P4-02 | OPEN | Depends on #103 |
| #105 | P4-03 | OPEN | Depends on #104 |
| #106 | P4-04 | OPEN | Depends on #92–#105 |
| #107 | P4-05 | OPEN | Depends on #103–#106 |
| #108 | P5-01 | OPEN | Depends on #88, #99 and #106 |
| #109 | P5-02 | OPEN | Depends on #108 and existing outbox/event path |
| #110 | P5-03 | OPEN | Depends on #109 and callback policy |
| #111 | P5-04 | OPEN | Depends on #99–#110 |
| #112 | P6-01 | OPEN | Depends on #108–#111 and provider inputs |
| #113 | P6-02 | OPEN | Depends on #112 and catalog policy |
| #114 | P6-03 | OPEN | Depends on #113 and verification inputs |
| #115 | P6-04 | OPEN | Depends on #114 and approved price source |
| #116 | P6-05 | OPEN | Depends on #115 and SF-02 provider evidence |
| #117 | P6-06 | OPEN | Depends on #115–#116 and mock/sandbox policy |
| #118 | P6-07 | OPEN | Depends on #117 and signing evidence policy |
| #119 | P6-08 | OPEN | Depends on #118; legal registration remains separate |
| #120 | P7-01 | OPEN | Depends on implementation/test contracts |
| #121 | P7-02 | OPEN | Depends on #120 and fault/security fixtures |
| #122 | P7-03 | OPEN | Prepare only; do not run final seven-stage scenario |
| #123 | P7-04 | OPEN | Depends on #120–#122 and rollback evidence |
| #124 | P7-05 | MANUAL HOLD | User-triggered final seven-stage acceptance only |

## Protocol

For each issue: verify GitHub prerequisites, implement the smallest complete
change, run focused tests and security checks, update `docs/current-state.md`
and a redacted issue artifact, commit only intended files, push the branch,
verify the remote SHA, comment evidence on GitHub, then close the issue. A
blocked external dependency stays OPEN and is recorded here with exact evidence.
