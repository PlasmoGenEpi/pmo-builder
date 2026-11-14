/**
 * Header name comparison: normalisation, tokens and the fuzzy score.
 */

/**
 * Folds a header for exact comparison: lower case, with spaces, underscores,
 * hyphens, dots and any other punctuation removed. `Sample_ID`, `sample id`
 * and `sampleId` all become `sampleid`.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Words that header writers use interchangeably. Each token on the left is
 * read as the token on the right before scoring.
 */
const TOKEN_SYNONYMS: Readonly<Record<string, string>> = {
  id: "name",
  ids: "name",
  identifier: "name",
  fwd: "forward",
  rev: "reverse",
  seq: "sequence",
  chr: "chrom",
  chromosome: "chrom",
  loc: "location",
  pos: "position",
  desc: "description",
  num: "count",
  cnt: "count",
  qty: "count",
  samp: "sample",
};

/**
 * Splits a header into lower-case words: at punctuation and spaces, at
 * camelCase boundaries (`sampleName`), and after an upper-case run
 * (`SampleID`, `ASVSeq`).
 */
export function tokenize(name: string): string[] {
  const spaced = name
    .normalize("NFKC")
    .replaceAll(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .replaceAll(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replaceAll(/(\p{L})(\p{N})(?=\p{L})/gu, "$1$2 ");
  return spaced
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== "")
    .map((token) => TOKEN_SYNONYMS[token] ?? token);
}

/** Levenshtein edit distance between two strings. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      current.push(Math.min(substitution, deletion, insertion));
    }
    previous = current;
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

/** Similarity of two strings from 0 to 1: one minus the edit distance over the longer length. */
export function stringSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}

/**
 * Two tokens closer than this count as the same word with a typo
 * (`colection` and `collection` score 0.9); below it they count as different.
 * Short words must match exactly, since one edit changes them too much.
 */
const TOKEN_MATCH_FLOOR = 0.8;

const HAS_DIGIT = /\p{N}/u;

/**
 * Typo-tolerant similarity: exact for short words and for words with digits
 * (`admin1` and `admin2` are different fields), edit distance otherwise.
 */
function typoSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 4 || HAS_DIGIT.test(a) || HAS_DIGIT.test(b)) return 0;
  const similarity = stringSimilarity(a, b);
  return similarity >= TOKEN_MATCH_FLOOR ? similarity : 0;
}

/**
 * How alike two headers are, from 0 to 1.
 *
 * Words are paired one to one, best pairs first, and the score is the Dice
 * coefficient over the pairs: twice the summed similarity of the pairs over
 * the total number of words. Every word on either side that has no partner
 * pulls the score down, so a generic word such as `start` scores 2/3 against
 * `insert start`, and `amplicon start` scores 1/2 against it.
 *
 * Headers written without separators (`colectiondate`) form one word, so the
 * whole folded names are also compared for typos, and the higher score wins.
 */
export function nameSimilarity(a: string, b: string): number {
  const whole = typoSimilarity(normalizeName(a), normalizeName(b));
  return Math.max(diceSimilarity(tokenize(a), tokenize(b)), whole >= WHOLE_NAME_FLOOR ? whole : 0);
}

/**
 * Whole folded names must be closer than single words to count as a typo,
 * because long names that share a prefix look alike (`ampliconend` and
 * `amplicongene` score 0.83).
 */
const WHOLE_NAME_FLOOR = 0.9;

function diceSimilarity(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const pairs: { readonly i: number; readonly j: number; readonly score: number }[] = [];
  for (const [i, x] of left.entries()) {
    for (const [j, y] of right.entries()) {
      const score = typoSimilarity(x, y);
      if (score > 0) pairs.push({ i, j, score });
    }
  }
  pairs.sort((p, q) => q.score - p.score);
  const usedLeft = new Set<number>();
  const usedRight = new Set<number>();
  let total = 0;
  for (const pair of pairs) {
    if (usedLeft.has(pair.i) || usedRight.has(pair.j)) continue;
    usedLeft.add(pair.i);
    usedRight.add(pair.j);
    total += pair.score;
  }
  return (2 * total) / (left.length + right.length);
}
