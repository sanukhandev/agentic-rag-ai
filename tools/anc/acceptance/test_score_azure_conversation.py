import unittest

from tools.anc.acceptance.score_azure_conversation import score


def turn(answer, grounded=False, citations=None, action=False):
    return {
        'status': 200,
        'answer_present': True,
        'answer_redacted': answer,
        'grounded': grounded,
        'citations': citations or [],
        'action_proposal_present': action,
        'history_has_25_turns': True,
    }


class AzureConversationScoreTests(unittest.TestCase):
    def test_objective_score_accepts_safe_complete_capture(self):
        answers = [f'Company formation information turn {index}.' for index in range(25)]
        answers[2] = 'Company formation options are available in the approved information.'
        answers[3] = 'The company formation process continues in this context.'
        answers[7] = 'The company setup steps remain in the formation context.'
        answers[19] = 'I have updated your timeline to two months.'
        answers[22] = 'Your fashion business, one visa and two months timeline are noted.'
        result = {
            'conversation_gate': 'PASS',
            'runs': [{'history_has_25_turns': True, 'turn_checks': [turn(answer, index == 2, ['source-1'] if index == 2 else []) for index, answer in enumerate(answers)]}],
        }
        result['runs'][0]['turn_checks'][-1]['history_has_25_turns'] = True
        evaluated = score(result)
        self.assertEqual(evaluated['automated_objective_score'], 1.0)

    def test_objective_score_rejects_false_completion_and_fallback_cascade(self):
        result = {
            'conversation_gate': 'PASS',
            'runs': [{'history_has_25_turns': True, 'turn_checks': [turn('The approved information is temporarily unavailable. Salesforce Lead was created.') for _ in range(25)]}],
        }
        evaluated = score(result)
        self.assertLess(evaluated['automated_objective_score'], 0.9)
        failed = {check['name'] for check in evaluated['checks'] if not check['passed']}
        self.assertIn('no_false_provider_completion', failed)
        self.assertIn('fallback_cascade_absent', failed)


if __name__ == '__main__':
    unittest.main()
