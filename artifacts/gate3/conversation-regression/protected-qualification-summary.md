# Protected Azure qualification

Deployment: **gpt-5.4**

Protected Gate 2 baseline: **21/23**, with 21 accepted identities preserved in `gate2-protected-baseline.json`.

Official Gate 3 runs:

| Run | Accepted | Result | Workflow assertions | Provider errors |
|---|---:|---|---:|---:|
| 1 | 18/23 (78.26%) | FAILED | 30/31 | 0 |
| 2 | 15/23 (65.22%) | FAILED | 30/31 | 0 |
| 3 | 15/23 (65.22%) | FAILED | 30/31 | 0 |

The protected gate is failed because the threshold and paired-case preservation requirement were not met. These are real Azure runs, not mock substitutions. The failure is retained as evidence; no prompt, guard, denominator or expected-case changes were made to force a pass.
