import type { ConversationRepository, PrivacyBoundary, ReadToolCatalog, ClaimVerifier } from '../contracts.js';
import { ConversationTurnEngine } from '../turn-engine.js';
import { HttpP4ModelGateway } from './p4-model-gateway.js';
import { P5CatalogEnvelopeEnricher, P5PinnedCatalogReader } from './p5-catalog.js';
import { P5ProposalValidator, type P5ActionStateReader } from './p5-proposal-validator.js';

/**
 * P5 opt-in candidate. P4 factory remains unchanged; no public endpoint,
 * CRM mutation, provider dispatch or removal of the production V2 engine.
 * P6 must provide a tenant/session-authenticated action-state reader and the
 * existing durable encrypted privacy boundary before runtime enablement.
 */
export function createP5CandidateEngine(input: {
  repository: ConversationRepository;
  tools: ReadToolCatalog;
  verifier: ClaimVerifier;
  privacy: PrivacyBoundary;
  catalogReader: P5PinnedCatalogReader;
  actions?: P5ActionStateReader;
  pythonUrl: string;
  serviceKey: string;
}): ConversationTurnEngine {
  return new ConversationTurnEngine(
    input.repository, new HttpP4ModelGateway(input.pythonUrl, input.serviceKey),
    input.tools, input.verifier,
    new P5ProposalValidator(input.catalogReader, input.actions),
    input.privacy,
    undefined,
    new P5CatalogEnvelopeEnricher(input.catalogReader),
  );
}
