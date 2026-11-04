/**
 * Conservative, per-source deterministic support for source-close clauses.
 *
 * This is NOT semantic entailment: a meaningful paraphrase must be validated
 * by an independent source-bound grounding proof. The old one-common-token
 * predicate is insufficient to establish factual support.
 */
const filler = new Set([
  'the','a','an','and','or','but','is','are','was','were','be','been','being',
  'i','me','my','you','your','we','our','they','their','that','this','those',
  'these','there','of','to','for','with','from','by','on','at','in','as','it','its',
  'have','has','had','will','would','could','should','can','may','might',
  'said','says','stated','states','currently','now','still','right','yet',
  'show','shows','showing','requested',
]);
const canonical = (token: string): string => {
  // Acknowledging a customer-stated fact does not assert a provider outcome.
  if (/^not(?:e|ed|ing)$/u.test(token)) return 'confirm';
  const bare = token.replace(/(?:ing|ed|es|s)$/u, '');
  const aliases: Record<string, string> = {
    cost: 'price', pric: 'price', fee: 'price', charg: 'price',
    contain: 'include', includ: 'include', requir: 'require',
    need: 'require', document: 'document', doc: 'document',
    updat: 'correct', correct: 'correct', confirm: 'confirm',
    request: 'action', process: 'process',
    registr: 'register', register: 'register', creat: 'create', create: 'create',
    pay: 'pay', paid: 'pay', purchas: 'purchase',
  };
  return aliases[bare] ?? bare;
};
const tokens = (value: string): string[] => value.normalize('NFKC').toLocaleLowerCase('en-US')
  .replace(/[_-]/gu,' ')
  .match(/[\p{L}\p{N}]+/gu)?.filter(token => !filler.has(token))
  .map(canonical).filter(token => token.length >= 2 && !filler.has(token)) ?? [];

/**
 * A citation supports a claim without independent entailment only when every
 * material term in that claim appears in that SAME source. Stop words and a
 * tiny reviewed synonym table are ignored; a shared topic word cannot pass.
 * Sentence-boundary, numeric, polarity and provider rules remain in provenance.
 */
export const supportsV2SourceCloseClause = (claim: string, sourceText: string): boolean => {
  // Formation is an already established journey label; stage assertions must
  // match the *same actual stage key* in authoritative evidence.
  const authoritativeStage = sourceText.toLocaleLowerCase('en-US').match(
    /\bauthoritative journey is currently at ([a-z_]+)\b/u)?.[1];
  // An authoritative nonterminal journey stage establishes that this journey
  // is not yet complete; it does NOT establish a provider operation's outcome.
  if (authoritativeStage && new Set([
    'lead_generation', 'lead_qualification', 'account_creation',
    'package_selection', 'document_upload', 'billing_invoice',
  ]).has(authoritativeStage)
    && /^i can confirm your request is not complete from the approved information i have[.]?$/iu.test(claim.trim())) {
    return true;
  }
  const claimedStage = claim.toLocaleLowerCase('en-US').match(
    /\bjourney is currently at ([a-z_]+)\b/u)?.[1];
  if (authoritativeStage && claimedStage && authoritativeStage === claimedStage) {
    const cleaned = claim.replace(/\bcompany[- ]formation\b/giu, '');
    const availableStage = new Set(tokens(sourceText));
    return tokens(cleaned).every(token => availableStage.has(token));
  }
  const wanted = tokens(claim);
  if (wanted.length === 0) return false;

  // Source excerpts often contain several independent prices, visa quantities
  // or provider outcomes. Never assemble a claim from terms distributed across
  // unrelated sentences or records. Reordering material terms can reverse a
  // relationship, even when every word is present in the excerpt.
  const statements = sourceText.split(/(?<=[.!?])\\s+|[;\\n]+/u)
    .flatMap(part => part.split(/[,]\\s+(?=(?:the\\s+)?(?:package|plan|offer|application|invoice|payment|account|contract)\\b)/iu))
    .flatMap(part => part.split(/\\s+(?:and|but|while)\\s+(?=(?:the\\s+)?(?:package|plan|offer|application|invoice|payment|account|contract)\\b)/iu))
    .map(part => part.trim()).filter(Boolean);
  const claimedNumbers = claim.match(/\\b\\d+(?:[.,]\\d+)?\\b/gu) ?? [];
  return statements.some(statement => {
    const available = tokens(statement);
    const statementNumbers = statement.match(/\\b\\d+(?:[.,]\\d+)?\\b/gu) ?? [];
    // A statement with more numbers than the claim needs independent
    // entailment: otherwise "Alpha costs 40; Beta costs 80" can prove
    // "Alpha costs 80" through the whole chunk's combined vocabulary.
    if (statementNumbers.some(number => !claimedNumbers.includes(number))) return false;
    let cursor = 0;
    return wanted.every(token => {
      const index = available.indexOf(token, cursor);
      if (index === -1) return false;
      cursor = index + 1;
      return true;
    });
  });
};
