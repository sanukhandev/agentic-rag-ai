# Final verification and commands

Branch: `feat/conversation-v2-langgraph-stage5-safe`

Final source SHA: `b935dd076dba8808d1bd7306b6eaed9ec022d07f`

Verified commands:

```powershell
docker compose --env-file .env -p anc-mock-uat -f docker-compose.anc-mock-uat.yml config --quiet
docker compose --env-file .env -p anc-mock-uat -f docker-compose.anc-mock-uat.yml up -d --build model-gateway api
node tools/qa/ancfz-stage5-api-conversation.mjs --strict --model-mode=azure --scenario=happy --minimum-turns=25 --output-dir=artifacts/ancfz-stage5-api-uat/gate2-quality-recovery/azure-retest-v13
node tools/qa/ancfz-stage5-api-conversation.mjs --strict --model-mode=mock --scenario=all --minimum-turns=25 --output-dir=artifacts/ancfz-stage5-api-uat/gate2-quality-recovery/mock-final-v1
node tools/qa/anc-final-acceptance-security.mjs
npm test -- --run
python -m pytest -q services/model-gateway/tests
```

The stack remains isolated under Compose project `anc-mock-uat`; only the API
is published on `127.0.0.1:4100`. Operational containers, credentials,
database volumes and `.env` were not modified.

Verdict: `GATE_2_GPT54_DIALOGUE_VERIFIED`.

Separate verdicts: `GATE_1_SECURITY_VERIFIED`, `GATE_3_LIFECYCLE_VERIFIED`,
`GATE_4_SF02_MOCK_VERIFIED`, and
`GATE_4_SF02_SANDBOX_BLOCKED_NOT_CONFIGURED`.
