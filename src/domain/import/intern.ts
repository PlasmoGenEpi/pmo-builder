/**
 * Keeping one copy of each distinct cell text. Allele tables repeat the same
 * few thousand sequences, sample and target names over hundreds of thousands
 * of rows; storing each once makes the parsed table several times smaller.
 */

/** After how many cells a column's repeats are judged. */
const JUDGE_AFTER = 10_000;

/**
 * Give up interning a column when more than this share of its cells were new:
 * ids or counts that rarely repeat would only grow the lookup.
 */
const MAX_DISTINCT_SHARE = 0.5;

/**
 * A copy of `text` that does not point into the string it was cut from. V8
 * keeps a long substring as a view of its parent, so one kept cell would keep
 * the whole file's text alive.
 */
function detached(text: string): string {
  return ` ${text}`.slice(1);
}

/**
 * A function that returns, for a cell of a given column, the one stored copy
 * of its text. Every copy it returns is detached from the text it was cut
 * from, so the file's text can be freed once parsed. A column whose cells
 * rarely repeat stops being looked up after {@link JUDGE_AFTER} cells; its
 * cells are still detached.
 */
export function createCellInterner(): (column: number, cell: string) => string {
  const lookups: (Map<string, string> | null)[] = [];
  const counts: number[] = [];
  return (column, cell) => {
    let lookup = lookups[column];
    if (lookup === undefined) {
      lookup = new Map();
      lookups[column] = lookup;
      counts[column] = 0;
    }
    if (lookup === null) return detached(cell);
    const count = (counts[column] ?? 0) + 1;
    counts[column] = count;
    const known = lookup.get(cell);
    if (known !== undefined) return known;
    const copy = detached(cell);
    if (count >= JUDGE_AFTER && lookup.size > count * MAX_DISTINCT_SHARE) {
      lookups[column] = null;
      return copy;
    }
    lookup.set(copy, copy);
    return copy;
  };
}
