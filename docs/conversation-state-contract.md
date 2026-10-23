# Conversation state contract

Conversation state is persisted with the session and remains backward-readable because new fields are optional. It has three layers:

1. Authoritative fields: selected and candidate intents, catalog version, confidence/evidence, slot values, slot provenance, pending prompt, consent purpose, workflow status, and message sequence.
2. A deterministic masked rolling summary derived from those fields and the latest visitor turn.
3. Recent persisted turns used by the existing chat context path.

Each visitor turn updates state through the existing version/concurrency boundary. Slot provenance records visitor message sequence and correction status. Workflow callbacks are merged only when they are not stale relative to the latest intent and state. Consent is purpose-bound and is not inherited when the intent changes.
