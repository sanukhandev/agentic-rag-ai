# GPT-first development — unit-only validation

Branch: `feat/gpt-first-langgraph-unit-only`. Base: `main` at `7e9212774c9de5ab93195c6f7d4fb408d08f146a`.

## Scope
- Reuse V2 catalog, Python LangGraph, typed tool gateway, evidence guard and stage providers.
- GPT drives dialogue strategy using bounded read-only tool calls; Node owns all durable state and business authorization.
- ANCFZ seven-stage progression remains catalog-driven and requires independent provider evidence.
- Unit tests with mocked Azure, tools, repository and providers only. No E2E, integration, live Azure or mock-provider HTTP test harness is part of this branch's validation.
- Compile, lint, build and static secret checks are permitted; these are not a substitute for external service verification.

## Explicit quality limitation
`UNIT_TEST_VERIFIED` means the isolated functions/contracts passed local or CI unit checks. It **does not** establish 90–95% customer dialogue accuracy, production-readiness, Salesforce completion, or a fully verified seven-stage customer journey.

## Retirement policy
The old Node chat planner and Python V1 adapter must be removed only after a dedicated GPT-first turn controller replaces all imports and the relevant unit tests pass. Keep applied SQL migrations and business-state modules.
