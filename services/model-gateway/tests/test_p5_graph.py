"""P5 opt-in model contract: no real network, no provider writes."""
import asyncio
import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from gateway.p4_contracts import P4TurnEnvelope, P5ModelCandidate
from gateway.p4_graph import P4GatewayError, P4LangGraphAgent

CATALOG = {
    "versionId": "catalog-001",
    "goals": [
        {
            "key": "company_setup", "name": "Start a company",
            "description": "Help the customer plan company formation.",
            "keywords": ["open company", "business license"],
            "customerExpressions": ["I want to register a firm."],
            "requiredInformation": ["Business activity"],
            "factRequirementKeys": ["business_activity"],
            "requiredDocuments": ["Passport copy"],
            "orderedSteps": ["Select activity", "Prepare application"],
            "availableActionKeys": ["lead.create"],
        },
        {
            "key": "license_renewal", "name": "Renew license",
            "description": "Guide a customer through renewing an existing business license.",
            "keywords": ["renew license"], "customerExpressions": ["My license expires soon."],
            "requiredInformation": ["License number"], "factRequirementKeys": ["license_number"],
            "requiredDocuments": [], "orderedSteps": ["Check renewal eligibility"],
            "availableActionKeys": [],
        },
    ],
}


def env(p5=True):
    return P4TurnEnvelope.model_validate({
        "requestId": "customer-turn-1", "tenantId": "tenant-001",
        "sessionId": "session-001", "customerMessage": "I want IT consulting.",
        "persona": {"versionId": "persona-001", "instructions": "Be concise."},
        "catalogVersionId": "catalog-001",
        "publishedGoalKeys": ["company_setup", "license_renewal"],
        **({"p5Catalog": CATALOG} if p5 else {}),
        "conversationSummary": "Customer wants a business service.", "latestTurns": [
            {"role": "customer", "text": "I'm considering registering a company."}],
        "verifiedFacts": [], "pendingActionStatus": [],
        "allowedReadTools": [], "readToolScopeRef": "signed-private-scope-" + "s" * 70,
        "limits": {"maxModelCalls": 3, "maxToolCalls": 2, "maxToolRounds": 1, "deadlineMs": 10000},
    })


def reply(goals=None, facts=None, action=None, message="What kind of business would you like to register?"):
    return json.dumps({
        "message": message, "evidenceRefs": [], "goalCandidateKeys": goals or [],
        "proposedFacts": facts or [], "actionProposal": action, "claimSupports": [],
    })


class FakeClient:
    def __init__(self, payload):
        self.payload = payload
        self.requests = []
        self.responses = self

    async def create(self, **kwargs):
        self.requests.append(kwargs)
        return SimpleNamespace(output=[], output_text=self.payload)


class ForbiddenTools:
    async def execute(self, *_args, **_kwargs):
        raise AssertionError("No read tools should execute for an ungrounded clarification.")


def run(payload, envelope=None):
    client = FakeClient(payload)
    result = asyncio.run(P4LangGraphAgent(client, ForbiddenTools(), "gpt-test").run(envelope or env()))
    return result, client


def test_p5_model_sees_pinned_plain_text_goals_and_can_ask_without_confirmation():
    result, client = run(reply(goals=["company_setup"]))
    assert result.candidate.goalCandidateKeys == ["company_setup"]
    assert result.candidate.proposedFacts == []
    assert result.candidate.actionProposal is None
    assert "P5:" in client.requests[0]["instructions"]
    assert "p5Catalog" in str(client.requests[0]["input"])
    assert "private-scope" not in str(client.requests[0]["input"])
    assert client.requests[0]["store"] is False


def test_p5_accepts_customer_sourced_proposal_but_never_executes_a_write():
    payload = reply(goals=["company_setup"],
        facts=[{"key": "business_activity", "value": "IT consulting", "supportingTurnId": "customer-turn-1"}],
        action={"actionKey": "lead.create", "input": {}, "reason": "Customer wants to register."})
    result, _ = run(payload)
    assert isinstance(result.candidate, P5ModelCandidate)
    assert result.candidate.proposedFacts[0].value == "IT consulting"
    assert result.candidate.actionProposal.actionKey == "lead.create"


def test_p5_rejects_nonexistent_goals_and_action_bindings():
    for payload in [
        reply(goals=["unauthorized_goal"]),
        reply(goals=["license_renewal"], action={"actionKey": "lead.create", "input": {}, "reason": "not allowed"}),
        reply(goals=["company_setup"], action={"actionKey": "delete_source", "input": {}, "reason": "not allowed"}),
    ]:
        with pytest.raises(P4GatewayError):
            run(payload)


def test_p5_rejects_invented_facts_and_wrong_customer_turns():
    facts = lambda key, value, turn: [{"key": key, "value": value, "supportingTurnId": turn}]
    for proposed in [
        facts("business_activity", "banking", "customer-turn-1"),
        facts("business_activity", "IT consulting", "assistant-turn"),
        facts("admin_password", "IT consulting", "customer-turn-1"),
    ]:
        with pytest.raises(P4GatewayError):
            run(reply(goals=["company_setup"], facts=proposed))


def test_p5_fails_closed_for_ambiguous_goal_facts_or_invalid_catalog_pin():
    with pytest.raises(P4GatewayError):
        run(reply(goals=["company_setup", "license_renewal"], facts=[
            {"key": "business_activity", "value": "IT consulting", "supportingTurnId": "customer-turn-1"}]))
    invalid = env().model_dump(mode="json")
    invalid["p5Catalog"]["versionId"] = "other"
    with pytest.raises(ValidationError):
        P4TurnEnvelope.model_validate(invalid)


def test_p4_mode_still_rejects_fact_and_action_proposals():
    with pytest.raises(P4GatewayError):
        run(reply(goals=["company_setup"], facts=[
            {"key": "business_activity", "value": "IT consulting", "supportingTurnId": "customer-turn-1"}]), env(p5=False))
