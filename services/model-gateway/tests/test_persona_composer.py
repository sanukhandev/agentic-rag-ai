import json
from datetime import datetime, timedelta, timezone

from gateway.persona_composer import composer_instructions, validate_composed_response
from gateway.v2_contracts import TurnEnvelopeV2


def envelope(languages=None):
    return TurnEnvelopeV2.model_validate({
        "schemaVersion": 2, "requestId": "request-12345678", "clientMessageId": "message-12345678", "scopeRef": "scope-12345678", "sessionRevision": 1, "intentRevision": 1, "catalogVersionId": "catalog-12345678", "personaVersionId": "persona-12345678", "customerMessageMasked": "Hello", "latestTurns": [], "persona": {"personaVersionId": "persona-12345678", "assistantName": "Tenant Assistant", "assistantRole": "Advisor", "permittedLanguages": languages or ["en"], "tone": ["warm"], "speakingStyle": "Clear", "fallbackTemplateVersion": "fallback-12345678"}, "catalogDigest": "a" * 64, "intentProjection": {"primaryGoalKey": None, "goalConfirmed": False, "currentStageKey": None, "pendingRequirementKey": None}, "toolAllowlist": [], "budgets": {"maxModelRequests": 2, "maxToolCalls": 0, "maxToolRounds": 0, "deadlineAt": (datetime.now(timezone.utc) + timedelta(seconds=10)).isoformat()},
    })


def response(language="en", answer="Hello, how can I help?"):
    return {"schemaVersion": 2, "personaVersionId": "persona-12345678", "language": language, "answer": answer, "citationIds": [], "nextQuestion": "How can I help?", "nextQuestionKey": None, "reasonNoQuestion": None, "decisionRef": "decision-12345678"}


def test_composer_uses_dynamic_persona_and_hides_internal_protocol():
    text = composer_instructions(envelope())
    assert "Tenant Assistant" in text
    assert "Zara" not in text
    assert "tool names" in text


def test_response_validator_accepts_pinned_language_and_rejects_wrong_language_or_metadata():
    current = envelope()
    valid, reason = validate_composed_response(response(), current)
    assert valid is not None and reason is None
    invalid_language, reason = validate_composed_response(response("ar", "مرحبا"), current)
    assert invalid_language is None and reason == "persona_mismatch"
    leaked, reason = validate_composed_response(response(answer=json.dumps({"sessionId": "internal"})), current)
    assert leaked is None and reason == "metadata_leak"
