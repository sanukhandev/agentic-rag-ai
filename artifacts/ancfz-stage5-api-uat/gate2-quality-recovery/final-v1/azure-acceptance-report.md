# Azure GPT-5.4 acceptance

Result: `GATE_2_GPT54_DIALOGUE_VERIFIED`

The real configured Azure deployment was `gpt-5.4`. The fixed 23-model-turn
suite accepted 21 model-authored responses: **21/23 = 91.30%**, above the
required 20/23 (85%). This is model-response acceptance, not a subjective
human-quality score. Eligible-dialogue-only acceptance was not measured because
the existing fixed set has no independent eligibility labels.

The run completed 34 Azure requests, 13 trusted tool calls, zero provider
errors, and 31/31 workflow assertions. Two candidates were rejected safely and
were not delivered. The complete redacted transcript is adjacent to this
report.
