from __future__ import annotations

from typing import Any


TOOL_DEFINITIONS: dict[str, dict[str, Any]] = {
    "get_conversation_context": {
        "type": "function",
        "name": "get_conversation_context",
        "description": "Read the sanitized current conversation context for the server-authorized session.",
        "parameters": {"type": "object", "additionalProperties": False, "properties": {}, "required": []},
        "strict": True,
    },
    "get_persona": {
        "type": "function",
        "name": "get_persona",
        "description": "Read the pinned tenant persona for the current server-authorized session.",
        "parameters": {"type": "object", "additionalProperties": False, "properties": {}, "required": []},
        "strict": True,
    },
    "get_intent_catalog": {
        "type": "function",
        "name": "get_intent_catalog",
        "description": "Read the published pinned intent catalog projection for the current session.",
        "parameters": {"type": "object", "additionalProperties": False, "properties": {}, "required": []},
        "strict": True,
    },
    "get_missing_requirements": {
        "type": "function",
        "name": "get_missing_requirements",
        "description": "Read the current server-authorized missing requirements for the active goal and stage.",
        "parameters": {"type": "object", "additionalProperties": False, "properties": {}, "required": []},
        "strict": True,
    },
    "search_knowledge": {
        "type": "function",
        "name": "search_knowledge",
        "description": "Search approved knowledge for the current server-authorized tenant.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "query": {"type": "string", "minLength": 1, "maxLength": 2000},
                "resultCount": {"type": ["integer", "null"], "minimum": 1, "maximum": 5},
            },
            "required": ["query", "resultCount"],
        },
        "strict": True,
    },
    "get_journey_state": {
        "type": "function",
        "name": "get_journey_state",
        "description": "Read the authoritative journey state for the current server-authorized session.",
        "parameters": {"type": "object", "additionalProperties": False, "properties": {}, "required": []},
        "strict": True,
    },
    "get_available_packages": {
        "type": "function",
        "name": "get_available_packages",
        "description": "Read currently eligible approved packages for the current session.",
        "parameters": {"type": "object", "additionalProperties": False, "properties": {}, "required": []},
        "strict": True,
    },
    "get_document_requirements": {
        "type": "function",
        "name": "get_document_requirements",
        "description": "Read approved document requirements for the current session and package.",
        "parameters": {"type": "object", "additionalProperties": False, "properties": {}, "required": []},
        "strict": True,
    },
    "get_action_status": {
        "type": "function",
        "name": "get_action_status",
        "description": "Read the verified status of the current pending action.",
        "parameters": {"type": "object", "additionalProperties": False, "properties": {}, "required": []},
        "strict": True,
    },
}


def definitions_for(allowlist: list[str]) -> list[dict[str, Any]]:
    return [TOOL_DEFINITIONS[name] for name in allowlist if name in TOOL_DEFINITIONS]
