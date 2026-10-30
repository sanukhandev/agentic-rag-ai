const fullTextStopWords = new Set(['about', 'all', 'are', 'does', 'have', 'how', 'please', 'tell', 'that', 'the', 'this', 'what', 'which', 'with', 'your']);

/** Converts untrusted natural-language input into a safe simple-config tsquery expression. */
export const normalizeFullTextQuery = (input: string, maxTerms = 40): string => {
  const terms = input.normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  return [...new Set(terms.filter((term) => !fullTextStopWords.has(term)))].slice(0, maxTerms).join(' | ');
};
