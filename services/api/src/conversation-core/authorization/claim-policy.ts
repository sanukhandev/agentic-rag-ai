/**
 * Claim classification owned by the new conversation engine.
 *
 * This is NOT semantic entailment. It classifies what requires independent
 * verification; the grounding service assesses the support of each claim.
 * Lexical overlap is never used to accept/reject supported paraphrases.
 */
const businessSubject = /\b(?:company|business|entity|licen[sc]e|visa|registration|permit|package|price|cost|fee|document|contract|invoice|payment|account|lead|refund|application|government|authority|eligib\w*|requirement|process|timeline|processing)\b/iu;
const consequentialPredicate = /\b(?:require(?:s|d)?|must|need(?:s|ed)?|includ(?:e|es|ed)|cost(?:s|ing)?|priced|fee|pay(?:ment|able|s|ing)?|eligible|available|approved|completed|created|registered|issued|signed|processed|guaranteed|take(?:s)?|within|takes?|days?|weeks?|months?|refund(?:s|ed)?|provid(?:e|es|ed)|allow(?:s|ed)?|prohibit(?:s|ed)?|valid|mandatory|optional|expires?|renew(?:al|ed)?)\b/iu;
const outcomeAssertion = /\b(?:has|have|was|were|is|are|successfully)\b.{0,48}\b(?:created|approved|completed|signed|paid|issued|registered|processed|refunded|activated)\b/iu;
const conversationalOnly = /^(?:hello|hi|hey|good (?:morning|afternoon|evening)|thank you|thanks|you're welcome|how can i help|i can help|i can explain|what can i help|please tell me|could you tell me|would you like|which (?:one|option)|tell me more|i'm not sure|i don't have verified information|i cannot verify|i'm unable to verify|sorry)/iu;

export function hasConsequentialAssertion(text: string): boolean {
  const s = text.trim();
  if (!s || /^[^\n.!?]*\?$/u.test(s)) return false;
  if (conversationalOnly.test(s) && !businessSubject.test(s.slice(60))) return false;
  return outcomeAssertion.test(s)
    || (businessSubject.test(s) && (consequentialPredicate.test(s) || /\b\d+(?:[.,]\d+)?\b/u.test(s)))
    || /\b(?:always|never|guaranteed|officially|legally required)\b/iu.test(s);
}

function independentClauses(message: string): string[] {
  return message.split(/(?<=[.!?])\s+|[;\n]+/u)
    .flatMap(part => part.split(/\s+(?:and|but|while)\s+(?=(?:the|your|our|a|an|this|that)\s+(?:company|license|package|account|payment|contract|lead|registration|document|invoice))\b/iu))
    .map(s => s.trim()).filter(Boolean);
}

export function extractConsequentialClauses(message: string): string[] {
  return independentClauses(message).filter(hasConsequentialAssertion);
}
