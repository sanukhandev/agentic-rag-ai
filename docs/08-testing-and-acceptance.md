# 08 — Testing and acceptance criteria

**Status: proposed gates. No result is considered passed until executed against the target branch and environment.**

## Evaluation strategy
Quality must be measured on real provider outputs as well as deterministic unit/integration tests. Synthetic scenario completion and transport health are not evidence that the assistant sounds natural, remembers customers or answers correctly.

Keep a frozen baseline of representative conversations from the currently deployed system before changing orchestration. Re-run the same cases against the new path, with equivalent tenant persona/catalog, RAG sources and model profile. Record actual configuration, code commit, model deployment, prompt revision and tool results for each run.

## Test layers
| Layer | Mandatory scenarios | Evidence |
| --- | --- | --- |
| Typed contracts and tools | Unknown tools, invalid arguments, permission failure, retries and tool budget | Unit tests and contract fixtures |
| Tenant isolation | Tenant A cannot read B's summary, persona, goals, vectors, provider status or cached result | Negative integration tests |
| Conversation memory | Long context, corrections, interrupted session, auth resume, summary conflict | Multi-turn assertions |
| RAG grounding | Supported answer, related-but-insufficient snippet, revoked source, missing knowledge, injection | Per-claim evidence review |
| Intent discovery | Natural phrasings, ambiguity, multiple goals, goal change, knowledge-only visitor | Human-reviewed transcripts |
| Action authorization | Consent, missing prerequisites, duplicates, retries, forged callbacks, provider failure | Database and outbox assertions |
| Persona and language | Name/tone adherence, language switch, concise natural responses | Human rubric and traces |
| Performance | p50/p95 turn latency, token and tool use, queue pressure, timeouts, circuit trips | Load and operational reports |
| Resilience | Azure unavailable, Redis reset, stale cache, partial provider completion | Recovery drills and reconciliation |
| Regression | API/websocket compatibility, current customer/admin UI, DB migration and rollback | CI, smoke, browser E2E |

## Conversation-quality rubric
Score each representative turn for:
1. **Answer relevance:** addresses what the customer asked, rather than reflexively selling or requesting contact.
2. **Grounded accuracy:** tenant-specific facts follow authorized evidence and clearly communicate uncertainty.
3. **Context and memory:** does not re-ask answered questions or lose corrected facts.
4. **Naturalness and persona:** varied, clear, appropriately concise response without repetitive canned phrasing.
5. **Intent appropriateness:** sensible goal recognition, clarification only when useful, correct choice not to trigger an action.
6. **Workflow truthfulness:** status only moves with verified evidence; pending/failure is presented accurately.

A generic fallback is not automatically a valid answer; repeat rate, empty answer rate and unnecessary refusal rate must be reported independently. Requiring a citation for non-factual pleasantries is a scoring defect.

## Initial release targets (to be approved during baseline)
- **Zero** cross-tenant leakage, unauthorized action dispatch, fabricated verified outcomes and security-critical PII disclosure.
- **Zero** unexpected writes to protected RAG documents/vectors during conversation-only evaluation.
- Every action-callback state transition is supported by correlated provider evidence and survives duplicate/replay scenarios.
- Human-reviewed answer relevance and naturalness improve against the frozen baseline. A suggested provisional target is at least **90%** acceptable turns across a representative real-model set, with no regression in grounding and security.
- Demonstrate correct conversation resumption, intent changes and customer corrections on long multi-turn scenarios.
- Prove rollback without losing or corrupting durable conversation or workflow state.

The 90% figure is a **proposed release threshold**, not an achieved or previously certified score. Set sample-size, confidence intervals, scenario balance and adjudication protocol before claiming success.

## Quality test execution
1. Freeze a balanced scenario suite: greetings, advisory-only, implicit goal, ambiguous goal, qualification, price/package, contact consent, documents, payment/status, multilingual turns, interruptions, corrections and adversarial cross-tenant probes.
2. Record baseline using real Azure GPT-5.4 and actual authorized knowledge; label model/provider failures separately from response defects.
3. Run the same suite on candidate; capture normalized transcripts, source/claim decisions, tool calls, action outcomes, latency and token costs.
4. Manually review failures and repeated fallback patterns. A synthetic 'passed' boolean is not a substitute for the rubric.
5. Execute deterministic security, integration and load tests; approve only after all hard gates pass.
6. Canary by tenant, monitor key metrics and retain a documented rollback procedure.

## Reporting
Publish commit SHA, environment, provider profile, test commands, scenario count, failures by reason, percent acceptable, confidence estimate, tool budget, p95 latency and unresolved limitations. Do not claim complete customer journeys based on mocked provider responses.
