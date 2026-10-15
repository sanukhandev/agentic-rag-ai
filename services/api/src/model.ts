import type { Citation } from './types.js';

export interface ModelEvidence { citation: Citation; content: string; }
export interface ModelDraft {
  answer: string;
  citationIds: string[];
  proposedIntent: 'lead.capture' | null;
}

export interface ChatModel {
  draft(input: { maskedMessage: string; evidence: ModelEvidence[]; personaName: string }): Promise<ModelDraft>;
}

export class DeterministicGroundedModel implements ChatModel {
  async draft(input: { maskedMessage: string; evidence: ModelEvidence[]; personaName: string }): Promise<ModelDraft> {
    const wantsLead = /\b(contact|call|email|interested|demo|quote)\b/i.test(input.maskedMessage);
    if (input.evidence.length === 0) {
      return { answer: `I’m ${input.personaName}. The approved knowledge does not establish an answer to that question, so I won’t guess.`, citationIds: [], proposedIntent: wantsLead ? 'lead.capture' : null };
    }
    const evidence = input.evidence[0];
    return {
      answer: `${evidence?.content.slice(0, 500) ?? 'The approved source does not contain enough detail.'}${wantsLead ? ' I can prepare a contact request for your confirmation.' : ''}`,
      citationIds: evidence ? [evidence.citation.chunkId] : [],
      proposedIntent: wantsLead ? 'lead.capture' : null,
    };
  }
}

export class AzureFoundryModel implements ChatModel {
  constructor(private readonly endpoint: string, private readonly deployment: string, private readonly apiKey: string) {}

  async draft(): Promise<ModelDraft> {
    if (!this.endpoint || !this.deployment || !this.apiKey) throw new Error('Azure AI Foundry is not configured.');
    throw new Error('Azure AI Foundry adapter is intentionally not called without a verified deployment contract.');
  }
}

export const validateCitations = (draft: ModelDraft, evidence: ModelEvidence[]): Citation[] => {
  const allowed = new Map(evidence.map((item) => [item.citation.chunkId, item.citation]));
  return draft.citationIds.map((id) => allowed.get(id)).filter((citation): citation is Citation => Boolean(citation));
};
