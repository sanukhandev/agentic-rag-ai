# Intent continuity rules

Intent detection is a proposal. The API combines the current normalized turn with persisted state and the published tenant catalog. Node validates slots, confidence, consent, tenant scope, workflow binding, and action state before any side effect.

The current commercial context remains available while a visitor asks an authorized knowledge question. The answer must use the normal tenant-filtered retrieval path and the next pending slot question resumes afterward. A genuine intent switch resets purpose-bound consent and keeps historical turns intact. A correction replaces the active validated slot while retaining provenance of the earlier value.

The catalog remains the source of required slots and prompts; tenant-specific phrases are not embedded in the shared orchestration code.
