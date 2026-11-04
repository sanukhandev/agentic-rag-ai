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
  'these','of','to','for','with','from','by','on','at','in','as','it','its',
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
  .match(/[\p{L}\p{N}]+/gu)?.map(canonical)
  .filter(token => token.length >= 2 && !filler.has(token)) ?? [];

/**
 * A citation supports a claim without independent entailment only when every
 * material term in that claim appears in that SAME source. Stop words and a
 * tiny reviewed synonym table are ignored; a shared topic word cannot pass.
 * Sentence-boundary, numeric, polarity and provider rules remain in provenance.
 */
export const supportsV2SourceCloseClause = (claim: string, sourceText: string): boolean => {
  const wanted = tokens(claim);
  if (wanted.length === 0) return false;
  const available = new Set(tokens(sourceText));
  return wanted.every(token => available.has(token));
};
