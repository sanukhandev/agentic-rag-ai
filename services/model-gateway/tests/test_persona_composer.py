import json
from datetime import datetime, timedelta, timezone

from gateway.persona_composer import composer_instructions, validate_composed_response
from gateway.v2_contracts import TurnEnvelopeV2


def envelope(languages=None, facts=None):
    return TurnEnvelopeV2.model_validate({
        "schemaVersion": 2, "requestId": "request-12345678", "clientMessageId": "message-12345678", "scopeRef": "scope-12345678", "sessionRevision": 1, "intentRevision": 1, "catalogVersionId": "catalog-12345678", "personaVersionId": "persona-12345678", "customerMessageMasked": "Hello", "latestTurns": [], "persona": {"personaVersionId": "persona-12345678", "assistantName": "Tenant Assistant", "assistantRole": "Advisor", "permittedLanguages": languages or ["en"], "tone": ["warm"], "speakingStyle": "Clear", "fallbackTemplateVersion": "fallback-12345678"}, "catalogDigest": "a" * 64, "intentProjection": {"primaryGoalKey": None, "goalConfirmed": False, "currentStageKey": None, "pendingRequirementKey": None, **({"confirmedCustomerFacts": facts} if facts else {})}, "toolAllowlist": [], "budgets": {"maxModelRequests": 2, "maxToolCalls": 0, "maxToolRounds": 0, "deadlineAt": (datetime.now(timezone.utc) + timedelta(seconds=10)).isoformat()},
    })


def response(language="en", answer="Hello, how can I help?"):
    return {"schemaVersion": 2, "personaVersionId": "persona-12345678", "language": language, "answer": answer, "citationIds": [], "nextQuestion": "How can I help?", "nextQuestionKey": None, "reasonNoQuestion": None, "decisionRef": "decision-12345678"}


def test_composer_uses_dynamic_persona_and_hides_internal_protocol():
    text = composer_instructions(envelope())
    assert "Tenant Assistant" in text
    assert "Zara" not in text
    assert "tool names" in text
    assert "Never use words such as 'usually'" in text
    assert "masked contact placeholders" in text
    assert "exactly once" in text


def test_composer_restricts_topic_keys_to_pinned_catalog():
    current = envelope()
    current.catalogV2 = __import__("gateway.v2_contracts", fromlist=["CatalogV2Projection"]).CatalogV2Projection(
        versionRef="anc:r2:verified-catalog", businessGoals=[], turnIntents=[], signals=[],
        knowledgeTopics=[{"topicKey": "knowledge.company_setup", "goalKey": "anc.company_formation", "citationRequired": True}],
        requirementKeys=[], enabledReadToolKeys=[],
    )
    instructions = composer_instructions(current)
    assert "catalogV2.knowledgeTopics" in instructions
    assert "not by an IntentSignals targetKey" in instructions


def test_prefetched_public_evidence_is_given_explicit_citation_first_priority():
    from gateway.v2_contracts import ApprovedKnowledgeSnippetV2

    current = envelope()
    basic = composer_instructions(current)
    assert "The server supplied approvedKnowledge excerpts" not in basic
    source = ApprovedKnowledgeSnippetV2(
        citationId="chunk-12345678",
        sourceRef="source-12345678",
        sourceVersion="version-12345678",
        text="Choose your business activity and submit the required documents.",
    )
    current.approvedKnowledge = [source]
    instructions = composer_instructions(current)
    assert "The server supplied approvedKnowledge excerpts" in instructions
    assert "Copy the exact citationId" in instructions
    assert "list formation steps only if a cited excerpt actually supports each step" in instructions


def test_repair_composer_demands_verbatim_single_source_and_never_reasks_customer():
    from gateway.v2_contracts import ApprovedKnowledgeSnippetV2, KnowledgeRepairV2

    current = envelope()
    current.approvedKnowledge = [ApprovedKnowledgeSnippetV2(
        citationId="chunk-12345678",
        sourceRef="source-12345678",
        sourceVersion="version-12345678",
        text="Choose your business activity and submit the required documents.",
    )]
    current.knowledgeRepair = KnowledgeRepairV2(reason="unsupported_claim", strategy="source_close")
    instructions = composer_instructions(current)
    assert "copy ONE complete factual sentence" in instructions
    assert "VERBATIM" in instructions
    assert "ONLY that excerpt's exact citationId" in instructions
    assert "nextQuestion and nextQuestionKey to null" in instructions
    assert "reasonNoQuestion to 'knowledge_answer'" in instructions
    assert "planning to null" in instructions
    assert "never cite unrelated excerpts" in instructions
    assert "do not call tools" in instructions
    assert "final natural-language persona composer" not in instructions
    assert "Ask at most one relevant next question" not in instructions


def test_response_validator_accepts_pinned_language_and_rejects_wrong_language_or_metadata():
    current = envelope()
    valid, reason = validate_composed_response(response(), current)
    assert valid is not None and reason is None
    invalid_language, reason = validate_composed_response(response("ar", "مرحبا"), current)
    assert invalid_language is None and reason == "persona_mismatch"
    leaked, reason = validate_composed_response(response(answer=json.dumps({"sessionId": "internal"})), current)
    assert leaked is None and reason == "metadata_leak"


def test_response_validator_repairs_only_bounded_model_placeholders_from_verified_context():
    current = envelope(facts={"entity_type": "LLC"})
    candidate = response(answer="Thanks for clarifying. I have your company structure noted as LLC.")
    candidate["citationIds"] = ["[ID_1]entity_type", "[ID_2]"]
    valid, reason = validate_composed_response(candidate, current)
    assert valid is not None and reason is None
    assert valid.citationIds == ["customer-fact-entity_type"]


def test_response_validator_repairs_stage_placeholders_only_from_authoritative_stage():
    current = envelope()
    current.intentProjection.currentStageKey = "account_creation"
    candidate = response(answer="Your journey is currently at [ID_1] stage. What would you like to clarify about the [ID_2] stage?")
    candidate["nextQuestion"] = "What would you like to clarify about the [ID_2] stage?"
    valid, reason = validate_composed_response(candidate, current)
    assert valid is not None and reason is None
    assert "[ID_" not in valid.answer
    assert "Account creation" in valid.answer
