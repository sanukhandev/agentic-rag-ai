# Tool execution analysis

| Metric | Azure v13 | Mock v1 |
|---|---:|---:|
| Model turns | 23 | 23 |
| Model requests | 34 | 46 |
| Trusted tool calls | 13 | 23 |
| Successful tool-read events | 13 | 22 |
| Provider error events | 0 | 0 |
| Repair-applied turns | 1 | 0 |
| Latency average / maximum | 3,772 / 11,629 ms | 236 / 357 ms |

The tool loop used the real Node gateway with tenant/session/opportunity scope
derived by Node. Python proposed reads only; Node remained authoritative for
facts, consent, lifecycle mutation, idempotency and provider evidence.
