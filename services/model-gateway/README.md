# Private model gateway

One authenticated, private FastAPI/LangGraph conversation endpoint at `/internal/conversation/turn`, plus independently scoped grounding review at `/internal/conversation/grounding/verify`.

The model can call only server-authorized read tools; the Node API owns tenant/session identity, RAG access, fact evidence, durable memory, customer authorization, and side-effect approval. The gateway has no direct database or provider write permissions.

Azure OpenAI and OpenAI are configured through private provider environment settings. The gateway rejects missing credentials, untrusted service keys, unauthorized read tools, or malformed model evidence. `MODEL_MODE=mock` is for offline tests only.

The old V2 planner, candidate toggles and legacy endpoints have been removed. This module does not, by itself, certify Salesforce, document, invoice or contract completion.
