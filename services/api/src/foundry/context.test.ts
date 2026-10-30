import { describe, expect, it } from 'vitest';
import { buildFoundryChatContext, formatFoundryInput } from './context.js';

describe('Foundry context builder', () => {
  it('keeps the outbound context bounded, masked and free of trusted IDs', () => {
    const input = {
      maskedMessage: 'Email [EMAIL_1] about packages',
      personaName: 'Ava',
      persona: { name: 'Ava', greeting: 'Hello', personality: 'Clear', tone: 'Warm', speakingStyle: 'Brief', permittedLanguages: ['en'] },
      followUpContext: { leadCaptured: false, primaryIntentKey: 'package.select', phase: 'package_selection', conversationSummary: 'masked summary', capturedSlots: { business_activity: 'consulting' }, nextRequirement: { requirementKey: 'package', requirementType: 'slot', promptKey: 'package.ask' } },
      evidence: [{ citation: { sourceId: 'source-1', versionId: 'version-1', chunkId: 'chunk-1', title: 'Guide', locator: 'section 1' }, content: 'Approved package evidence.' }],
    };
    const context = buildFoundryChatContext(input);
    expect(context.persona.name).toBe('Ava');
    expect(context.conversation.latestMessage).toContain('[EMAIL_1]');
    expect(context.knowledge.approvedEvidence[0]?.citationId).toBe('chunk-1');
    expect(formatFoundryInput(input)).toContain('[EMAIL_1]');
    expect(formatFoundryInput(input)).not.toContain('tenant-1');
    expect(formatFoundryInput(input)).not.toContain('session-1');
  });
});
