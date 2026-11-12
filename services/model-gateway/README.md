# Python conversation-planner gateway — initial implementation

Private FastAPI model gateway for the **planned** Node → Python → GPT architecture.
Currently implements authenticated `plan`, `normalize`, and bounded CRM `summarize`
operations with typed Pydantic contracts, structured JSON output, evidence-ID allowlist
and provider-neutral model retry budget. The summary operation accepts masked CRM context only;
it is not a document OCR endpoint.
The Node API remains responsible for tenant/session/intent/catalog scope, allowed tool
execution, verified RAG citations, consent and async n8n events.

## Provider configuration

Set `AI_PROVIDER` to `openai` or `azure`, then provide the active profile through
`AI_MODEL`, `AI_BASE_URL`, and `AI_API_KEY`. OpenAI defaults to
`https://api.openai.com/v1` and the local profile uses `gpt-5.4`. Azure requires
an OpenAI-compatible model resource endpoint ending in `/openai/v1`; its deployment
profile is `gpt-5.4` when that is the deployed name. Switch providers by changing
environment configuration and restarting the gateway.

For rollback, Azure also accepts the existing `AZURE_OPENAI_BASE_URL`,
`AZURE_OPENAI_DEPLOYMENT`, and `AZURE_OPENAI_API_KEY` variables when the `AI_*`
values are absent. `MODEL_MODE=mock` remains the offline test mode.

Configure `MODEL_GATEWAY_SERVICE_KEY` as an unrelated, long private Node↔Python
credential. Never commit values or place provider credentials in the Node/UI runtime.

Retry rule: the OpenAI SDK is configured with `max_retries=3` (one initial
call and up to three transient retries). No additional Node retry loop.
A semaphore and minimum interval bound concurrency and cost; real quota
still depends on deployment and should be managed centrally in a later phase.

**Not complete:** this initial code does not replace the existing Node chat
orchestrator's lead-first gating, doesn't implement a tool-calling loop or the
User Intent Document, and has not completed a live seven-stage acceptance.
