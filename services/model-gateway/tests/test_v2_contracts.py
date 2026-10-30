import unittest

from pydantic import ValidationError

from gateway.v2_contracts import PersonaComposedResponseV2, ToolRequestV2, TurnEnvelopeV2


class V2ContractTests(unittest.TestCase):
    def test_unknown_envelope_field_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            TurnEnvelopeV2.model_validate({"schemaVersion": 2, "unexpected": True})

    def test_tool_request_is_strict(self) -> None:
        with self.assertRaises(ValidationError):
            ToolRequestV2.model_validate({
                "schemaVersion": 2,
                "toolCallId": "call-12345678",
                "toolName": "search_knowledge",
                "arguments": {"tenantId": "customer-controlled"},
                "scopeRef": "scope-12345678",
                "expectedStateRevision": 1,
                "deadlineAt": "2026-10-30T10:00:00Z",
                "extra": True,
            })

    def test_response_cannot_expose_internal_metadata(self) -> None:
        with self.assertRaises(ValidationError):
            PersonaComposedResponseV2.model_validate({
                "schemaVersion": 2,
                "personaVersionId": "persona-12345678",
                "language": "en",
                "answer": "Ready.",
                "citationIds": [],
                "nextQuestion": None,
                "nextQuestionKey": None,
                "reasonNoQuestion": "farewell",
                "decisionRef": "decision-12345678",
                "internalTrace": "secret",
            })


if __name__ == "__main__":
    unittest.main()
