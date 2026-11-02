import { createHash } from 'node:crypto';

export interface V2ClaimSource {
  citationId: string;
  text: string;
  sourceVersion: string;
  sourceRef?: string;
  kind: 'source' | 'customer_fact';
}

export interface V2ClaimProvenance {
  claimDigest: string;
  citationIds: string[];
  sourceVersions: string[];
  sourceRefs?: string[];
}

export interface V2ClaimEvaluation {
  supported: boolean;
  claims: V2ClaimProvenance[];
  unusedCitationIds: string[];
}

const norm = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/[_-]/gu, ' ').replace(/\s+/gu, ' ').trim();
const digest = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 32);
const numbers = (s: string): string[] => norm(s).match(/\b\d+(?:[.,]\d+)?\b/gu) ?? [];
const negative = (s: string): boolean => /\b(?:no|not|never|without|cannot|can't|won't|isn't|wasn't|doesn't)\b/iu.test(s);
const filler = new Set('the a an i we you your our their this that these those there for from with about by into and but while can could would should will have has had been are was were being is as to of at on in it its my me also just still currently now here said stated customer requested request details detail information verified confirm confirmed checking noted note thanks sharing your exactly same setup count shows show showing'.split(' '));
const tokens = (s: string): string[] => [...new Set((norm(s).match(/[a-z\u00c0-\u024f0-9]+/gu) ?? [])
  .filter((w) => w.length >= 3 && !filler.has(w) && !/^\d/u.test(w))
  .map((w) => { const stem = w.replace(/(?:ing|ed|es|s)$/u, ''); return stem === 'updat' ? 'correct' : stem; }))];
const state = /\b(?:account|lead|payment|invoice|contract|signature|document|registration|company|business|entity|opportunity)\b/iu;
const completed = /\b(?:created|complete|completed|paid|signed|registered|uploaded|issued|successful|succeeded)\b/iu;
const verifiedRecord = /\b(?:provider[_ ]record[_ ]verified|mock[_ ]verified|verified\s+(?:provider|government|registry|salesforce|payment|invoice|contract|registration)\s+(?:record|receipt|confirmation|evidence)|(?:government|provider|registry|payment|contract)\s+(?:registration\s+)?record\s+confirms)\b/iu;

export const hasPositiveBusinessOutcomeClaim = (s: string): boolean => {
  if (!state.test(s) || !completed.test(s)) return false;
  if (/\b(?:not|never|without|won't|cannot|can't|isn't|wasn't)\b.{0,60}\b(?:created|completed|complete|paid|signed|registered|uploaded|issued|successful|succeeded)\b/iu.test(s)) return false;
  if (/\b(?:don't|do not|will not|won't)\s+(?:assume|treat|consider|claim|confirm)\b/iu.test(s)) return false;
  return true;
};

// Only split on clause conjunctions when a new subject follows; do not split
// customer values such as "software consulting and AI services".
const clauses = (s: string): string[] => s.split(/(?<=[.!?])\s+|\n+/u)
  .flatMap((part) => part.split(/,\s+(?=(?:(?:and|but|so)\s+)?(?:your|the|there|i\s|we\s|a\s|an\s|lead|account|workflow|contact|visa|timeline|entity))/iu))
  .flatMap((part) => part.split(/\s+(?:and|but|while)\s+(?=(?:your|the|there|i\s|we\s|you\s|lead|account|workflow|registration|payment|document|includes?|requires?|costs?|takes?|provides?|has|is|are|was|were)\b)/iu))
  .map((part) => part.trim()).filter(Boolean);

const supportsSource = (clause: string, source: V2ClaimSource, semanticCheck: (clause: string, source: V2ClaimSource) => boolean): boolean => {
  const subject = norm(clause);
  const text = norm(source.text);
  if (!source.sourceVersion.trim() || !text || numbers(subject).some((n) => !numbers(text).includes(n))) return false;
  const negativeStatus = /\bnot complete\b/iu.test(subject) && /\b(?:authoritative journey|current workflow status)\b/iu.test(text);
  const unrelatedProviderNegation = !negative(subject) && /\b(?:no|not)\s+(?:provider|further|additional|other)\b/iu.test(text);
  // A refusal record may say both 'action declined' and 'must not proceed'.
  // The prohibition does not negate the separately stated decline event.
  const optOutStatus = /\baction\b.{0,20}\bdeclin\w*\b/iu.test(subject) && /\bdeclin\w*\b/iu.test(text) && /\bmust not proceed\b/iu.test(text);
  const journeyParaphrase = /\bjourney\b.{0,50}\b(?:currently\s+)?at\b/iu.test(subject) && /\bauthoritative journey\b.{0,50}\bcurrently at\b/iu.test(text) && tokens(subject).filter((word) => tokens(text).includes(word)).length >= 3;
  if (negative(subject) !== negative(text) && !negativeStatus && !unrelatedProviderNegation && !optOutStatus) return false;
  if (hasPositiveBusinessOutcomeClaim(subject)) {
    if (source.kind === 'customer_fact' || !verifiedRecord.test(text) || !state.test(text) || !completed.test(text)) return false;
  }
  const important = tokens(subject);
  const available = new Set(tokens(text));
  const matchCount = important.filter((word) => available.has(word)).length;
  const customerReflection = source.kind === 'customer_fact' && matchCount > 0 && semanticCheck(clause, source);
  if (!negativeStatus && !journeyParaphrase && !customerReflection && (important.length === 0 ? subject !== text : matchCount === 0 || matchCount / important.length < 0.7)) return false;
  // Semantic check is per-source, not a concatenation of unrelated citations.
  return semanticCheck(clause, source) || subject === text || negativeStatus || journeyParaphrase;
};

export const evaluateV2ClaimProvenance = (
  answer: string,
  sources: V2ClaimSource[],
  isDialogue: (part: string) => boolean,
  semanticCheck: (part: string, source: V2ClaimSource) => boolean,
): V2ClaimEvaluation => {
  const claims: V2ClaimProvenance[] = [];
  const used = new Set<string>();
  for (const sentence of answer.split(/(?<=[.!?])\s+|\n+/u).map((value) => value.trim()).filter(Boolean)) {
    // The scope of a negated process claim is the complete uncertainty sentence.
    if (isDialogue(sentence) && !hasPositiveBusinessOutcomeClaim(sentence)
      && !/\b(?:but|and)\b[\s\S]{0,120}\b(?:package|account|payment|contract|costs?|eligible|available|required|requires?|includes?|registered|created|completed)\b/iu.test(sentence)) continue;
    for (const part of clauses(sentence)) {
    if (isDialogue(part) && !hasPositiveBusinessOutcomeClaim(part)) continue;
    const matched = sources.find((source) => supportsSource(part, source, semanticCheck));
    if (!matched) return { supported: false, claims: [], unusedCitationIds: [] };
    used.add(matched.citationId);
    claims.push({
      claimDigest: digest(part), citationIds: [matched.citationId], sourceVersions: [matched.sourceVersion],
      ...(matched.sourceRef ? { sourceRefs: [matched.sourceRef] } : {}),
    });
    }
  }
  return { supported: true, claims, unusedCitationIds: sources.filter((source) => !used.has(source.citationId)).map((source) => source.citationId) };
};
