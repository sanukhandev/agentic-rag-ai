#!/usr/bin/env python3
"""Score objective properties of a captured public ANCFZ conversation.

This is not a substitute for the human four-point persona rubric. It reports
deterministic evidence only and fails closed when the capture is incomplete.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

FALLBACKS = (
    'approved information is temporarily unavailable',
    'cannot verify that answer safely',
    'i can help you work through that',
)
INTERNAL_MARKERS = ('search_knowledge', 'get_missing_requirements', 'citationids', 'tooltrace', 'traceback')
COMPLETION_CLAIMS = (
    'salesforce lead was created', 'lead has been created', 'payment was completed',
    'payment is complete', 'contract was signed', 'documents were accepted',
)


def _turns(result: dict) -> list[dict]:
    runs = result.get('runs')
    if not isinstance(runs, list) or len(runs) != 1 or not isinstance(runs[0], dict):
        return []
    turns = runs[0].get('turn_checks')
    return turns if isinstance(turns, list) else []


def _answer(turn: dict) -> str:
    value = turn.get('answer_redacted')
    return value.lower().strip() if isinstance(value, str) else ''


def _check(name: str, passed: bool, evidence: str) -> dict:
    return {'name': name, 'passed': passed, 'evidence': evidence}


def score(result: dict) -> dict:
    turns = _turns(result)
    run = (result.get('runs') or [{}])[0]
    complete = len(turns) == 25 and all(t.get('status') == 200 and t.get('answer_present') for t in turns)
    answers = [_answer(turn) for turn in turns]
    checks = [
        _check('transport_complete', complete, f'{len(turns)}/25 turns have HTTP answers'),
        _check('grounded_formation_answer', len(turns) >= 3 and bool(turns[2].get('grounded')) and bool(turns[2].get('citations')), 'turn 3 grounded flag and citation'),
        _check('formation_context_retained', len(turns) >= 8 and all(any(word in answers[index] for word in ('formation', 'company', 'business', 'licen')) for index in (2, 3, 7)), 'formation context in setup/licensing/steps answers'),
        _check('correction_retained', len(turns) >= 20 and any(word in answers[19] for word in ('two months', '2 months', 'timeline')), 'turn 20 acknowledges corrected timeline'),
        _check('recap_retains_verified_facts', len(turns) >= 23 and any(word in answers[22] for word in ('fashion', 'visa', 'two months', '2 months')), 'turn 23 recap contains customer facts'),
        _check('no_unrequested_action', all(not turn.get('action_proposal_present') for turn in turns), 'no action proposal in the information/consent-only harness'),
        _check('no_internal_payload_leak', not any(any(marker in answer for marker in INTERNAL_MARKERS) or re.search(r'\b[0-9a-f]{8}-[0-9a-f-]{27,}\b', answer) for answer in answers), 'no tool names, trace fields or UUIDs in captured answers'),
        _check('no_false_provider_completion', not any(any(claim in answer for claim in COMPLETION_CLAIMS) for answer in answers), 'no unsupported provider-completion claim'),
        _check('fallback_cascade_absent', sum(any(fallback in answer for fallback in FALLBACKS) for answer in answers) <= 1, 'at most one generic fallback across the run'),
        _check('durable_history', bool(result.get('conversation_gate') == 'PASS' and run.get('history_has_25_turns')), 'public history reports 25 durable user messages'),
    ]
    passed = sum(check['passed'] for check in checks)
    return {
        'automated_objective_score': round(passed / len(checks), 3),
        'automated_objective_checks_passed': passed,
        'automated_objective_checks_total': len(checks),
        'checks': checks,
        'human_persona_quality_review': 'NOT_RUN',
        'provider_completion': 'NOT_VERIFIED_BY_THIS_HARNESS',
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('artifact', type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    result = json.loads(args.artifact.read_text(encoding='utf-8'))
    scored = {**result, 'objective_evaluation': score(result)}
    output = json.dumps(scored, indent=2)
    if args.out:
        args.out.write_text(output + '\n', encoding='utf-8')
    else:
        print(output)


if __name__ == '__main__':
    main()
