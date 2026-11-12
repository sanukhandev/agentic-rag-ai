import type { ConversationRepository, PrivacyBoundary, ReadToolCatalog } from '../contracts.js';
import { ConversationTurnEngine } from '../turn-engine.js';
import type { ClaimVerifier } from '../contracts.js';
import { ReadOnlyP2ProposalValidator } from './proposal-validator.js';
import { HttpP4ModelGateway } from './p4-model-gateway.js';

/**
 * Candidate-only assembly. P6 will attach it to a feature-gated authenticated
 * endpoint only after the real encrypted privacy vault and UAT are complete.
 */
export function createP4CandidateEngine(input: {
  repository: ConversationRepository;
  tools: ReadToolCatalog;
  verifier: ClaimVerifier;
  privacy: PrivacyBoundary;
  pythonUrl: string;
  serviceKey: string;
}): ConversationTurnEngine {
  return new ConversationTurnEngine(
    input.repository, new HttpP4ModelGateway(input.pythonUrl, input.serviceKey),
    input.tools, input.verifier, new ReadOnlyP2ProposalValidator(), input.privacy,
  );
}
