# PII masking and vault

Visitor PII is tokenized before model, retrieval, Redis, workflow, and log boundaries. The reversible token map remains session-scoped and encrypted by `TokenVault`. Token allocation is collision-safe across turns, including multiple values in one message and international names.

Assistant rehydration is limited to the authorized assistant response path. Workflow payloads cannot rehydrate tokens. Administrative CRM access uses the separate server-side purpose and is never exposed as a generic public decryption API. Unknown model placeholders are rejected.

Production startup fails closed when `PII_VAULT_KEY` is absent, a placeholder, or shorter than 32 characters. Rotation is supported by decrypting valid records with the old vault and saving them to the next vault; retention and deletion periods remain policy-controlled and are not invented by the application.
