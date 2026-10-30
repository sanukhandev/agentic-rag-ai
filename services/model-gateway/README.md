# Python conversation-planner gateway — initial implementation

Private FastAPI model gateway for the **planned** Node → Python → GPT architecture.
Currently implements authenticated `plan` and `normalize` with typed Pydantic
contracts, structured JSON output, evidence-ID allowlist and Azure model retry budget.
The Node API remains responsible for tenant/session/intent/catalog scope, allowed tool
execution, verified RAG citations, consent and async n8n events.

Configure `AZURE_OPENAI_BASE_URL` as a model resource `https://<resource>.openai.azure.com/openai/v1/`;
`AZURE_OPENAI_DEPLOYMENT` is a deployed model name; `AZURE_OPENAI_API_KEY` is
the model resource key. Configure `MODEL_GATEWAY_SERVICE_KEY` as an unrelated,
long private Node↔Python credential. Never commit values.

Retry rule: the OpenAI SDK is configured with `max_retries=3` (one initial
call and up to three transient retries). No additional Node retry loop.
A semaphore and minimum interval bound concurrency and cost; real quota
still depends on deployment and should be managed centrally in a later phase.

**Not complete:** this initial code does not replace the existing Node chat
orchestrator's lead-first gating, doesn't implement a tool-calling loop or the
User Intent Document, and has not completed a live seven-stage acceptance.
