/**
 * String-matching primitives for fuzzy identity resolution.
 *
 * These mirror the name-matching core of the planetar entity-resolution
 * engine: edit distance, name normalisation, and a 0..1 similarity score.
 */

/** Levenshtein edit distance, computed with two rolling rows (O(n) space). */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Normalise a name for comparison: lowercase, strip accents and punctuation. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // drop combining accents
    .replace(/[^a-z0-9\s]/g, '')    // drop punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/** Name similarity in [0,1]: 1 = identical after normalisation, 0 = disjoint. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (x.length === 0 || y.length === 0) return 0;
  if (x === y) return 1;
  const maxLen = Math.max(x.length, y.length);
  return 1 - levenshteinDistance(x, y) / maxLen;
}
