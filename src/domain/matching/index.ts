import type {
  ColumnMapping,
  FieldDependency,
  FieldMatch,
  FieldRequirement,
  FieldSetSpec,
  FieldSpec,
  MappingProblem,
  MappingSuggestion,
  MatchConfidence,
} from "../types";

import { nameSimilarity, normalizeName } from "./names";

export { nameSimilarity, normalizeName, tokenize } from "./names";

/**
 * The lowest fuzzy score accepted as a suggestion.
 *
 * With the word-pairing score in {@link nameSimilarity}, 0.75 accepts two
 * matching words out of three (`sample name` for `library sample name`,
 * 0.8) and a typo in one word of two (`colection date`, 0.95). It rejects one
 * generic word against a two-word field (`date` for `collection date`, 0.67)
 * and one shared word out of two (`amplicon start` for `insert start`, 0.5).
 * The tests in `matching.test.ts` pin both sides.
 */
export const FUZZY_THRESHOLD = 0.75;

const CONFIDENCE_RANK: Readonly<Record<MatchConfidence, number>> = {
  exact: 3,
  alias: 2,
  fuzzy: 1,
  none: 0,
};

interface Candidate {
  readonly fieldIndex: number;
  readonly columnIndex: number;
  readonly confidence: Exclude<MatchConfidence, "none">;
  readonly score: number;
  readonly required: boolean;
}

/** The best way one column matches one field, or `null` when it does not match credibly. */
function scoreColumn(
  field: FieldSpec,
  column: string,
): { readonly confidence: Candidate["confidence"]; readonly score: number } | null {
  const folded = normalizeName(column);
  if (folded === "") return null;
  if (field.notAliases?.some((name) => normalizeName(name) === folded) === true) return null;
  if (folded === normalizeName(field.key) || folded === normalizeName(field.label)) {
    return { confidence: "exact", score: 1 };
  }
  if (field.aliases.some((alias) => normalizeName(alias) === folded)) {
    return { confidence: "alias", score: 1 };
  }
  const names = [field.key, field.label, ...field.aliases];
  const score = Math.max(...names.map((name) => nameSimilarity(column, name)));
  return score >= FUZZY_THRESHOLD ? { confidence: "fuzzy", score } : null;
}

/** Orders candidates best first: confidence, then score, then required fields, then table order. */
function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
    b.score - a.score ||
    Number(b.required) - Number(a.required) ||
    a.fieldIndex - b.fieldIndex ||
    a.columnIndex - b.columnIndex
  );
}

/** The field keys a requirement names. */
export function requirementKeys(requirement: FieldRequirement): readonly string[] {
  return typeof requirement === "string" ? [requirement] : requirement.anyOf;
}

/**
 * The requirements of a dependency that a mapping does not meet, or an empty
 * list when the dependency is met or not switched on (no field of `when` mapped).
 */
export function unmetRequirements(
  dependency: FieldDependency,
  isMapped: (key: string) => boolean,
): readonly FieldRequirement[] {
  if (!dependency.when.some(isMapped)) return [];
  return dependency.needs.filter((requirement) => !requirementKeys(requirement).some(isMapped));
}

/** Assigns columns to fields best first, skipping `excluded` fields. */
function assign(
  candidates: readonly Candidate[],
  excluded: ReadonlySet<number>,
): Map<number, Candidate> {
  const chosen = new Map<number, Candidate>();
  const usedColumns = new Set<number>();
  for (const candidate of candidates) {
    if (excluded.has(candidate.fieldIndex)) continue;
    if (chosen.has(candidate.fieldIndex) || usedColumns.has(candidate.columnIndex)) continue;
    chosen.set(candidate.fieldIndex, candidate);
    usedColumns.add(candidate.columnIndex);
  }
  return chosen;
}

/**
 * Proposes a column for each field of a table from its header names.
 *
 * Every field and column pair is scored: an exact match on the field key or
 * label, then an exact match on an alias, then a fuzzy score over words
 * (accepted from {@link FUZZY_THRESHOLD}). Names are compared after folding
 * case and punctuation; a field's `notAliases` never match it. Pairs are
 * then assigned best first across the whole table, so a column goes to the
 * field it matches best and no column is suggested twice; on equal footing a
 * required field wins.
 *
 * A field whose companions cannot be matched is left out: when a dependency
 * of the field set is switched on but not met (a pseudo-CIGAR column with no
 * chromosome, start and end), the mapped fields of its `when` are dropped and
 * the columns assigned again, until every dependency holds. So a suggestion
 * never has an `incomplete-group` problem.
 *
 * A field with no credible column stays unmapped with confidence `none`, even
 * when it is required. `additionalColumns` starts empty.
 */
export function suggestMapping(
  fieldSet: FieldSetSpec,
  columns: readonly string[],
): MappingSuggestion {
  const candidates: Candidate[] = [];
  for (const [fieldIndex, field] of fieldSet.fields.entries()) {
    for (const [columnIndex, column] of columns.entries()) {
      const match = scoreColumn(field, column);
      if (match !== null) {
        candidates.push({ fieldIndex, columnIndex, ...match, required: field.required });
      }
    }
  }
  candidates.sort(compareCandidates);

  const indexByKey = new Map(fieldSet.fields.map((field, index) => [field.key, index]));
  const excluded = new Set<number>();
  let chosen = assign(candidates, excluded);
  // Each pass excludes at least one more field, so this ends.
  for (;;) {
    const current = chosen;
    const isMapped = (key: string): boolean => {
      const index = indexByKey.get(key);
      return index !== undefined && current.has(index);
    };
    const dropped = fieldSet.dependencies
      .filter((dependency) => unmetRequirements(dependency, isMapped).length > 0)
      .flatMap((dependency) => dependency.when.filter(isMapped))
      .flatMap((key) => {
        const index = indexByKey.get(key);
        return index === undefined ? [] : [index];
      });
    if (dropped.length === 0) break;
    for (const index of dropped) excluded.add(index);
    chosen = assign(candidates, excluded);
  }

  const fields: Record<string, string | null> = {};
  const matches: Record<string, FieldMatch> = {};
  for (const [fieldIndex, field] of fieldSet.fields.entries()) {
    const candidate = chosen.get(fieldIndex);
    const column = candidate === undefined ? null : (columns[candidate.columnIndex] ?? null);
    fields[field.key] = column;
    matches[field.key] =
      candidate === undefined || column === null
        ? { column: null, confidence: "none" }
        : { column, confidence: candidate.confidence };
  }
  return { mapping: { fields, additionalColumns: [] }, matches };
}

/**
 * Lists what stops a mapping from being used, in this order: required fields
 * with no column (in field order), columns mapped to more than one field (in
 * table order, then first use), fields mapped to a column the table does
 * not have (in field order), dependencies that are switched on but not met
 * (in dependency order), and then, for each extra column chosen to carry
 * into the PMO (in the order chosen, once each), one the table does not have
 * or one that is also mapped to a field. Keys in the mapping that are not
 * fields of the set are ignored.
 */
export function checkMapping(
  fieldSet: FieldSetSpec,
  columns: readonly string[],
  mapping: ColumnMapping,
): readonly MappingProblem[] {
  const problems: MappingProblem[] = [];
  const mapped: { readonly key: string; readonly column: string }[] = [];
  for (const field of fieldSet.fields) {
    const column = mapping.fields[field.key] ?? null;
    if (column === null) {
      if (field.required) problems.push({ kind: "missing-required", fieldKey: field.key });
    } else {
      mapped.push({ key: field.key, column });
    }
  }

  const keysByColumn = new Map<string, string[]>();
  for (const { key, column } of mapped) {
    const keys = keysByColumn.get(column);
    if (keys === undefined) keysByColumn.set(column, [key]);
    else keys.push(key);
  }
  const columnOrder = new Map(columns.map((column, index) => [column, index]));
  const duplicates = [...keysByColumn.entries()]
    .filter(([, keys]) => keys.length > 1)
    .toSorted(
      ([a], [b]) =>
        (columnOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (columnOrder.get(b) ?? Number.MAX_SAFE_INTEGER),
    );
  for (const [column, fieldKeys] of duplicates) {
    problems.push({ kind: "duplicate-column", column, fieldKeys });
  }

  for (const { key, column } of mapped) {
    if (!columnOrder.has(column)) problems.push({ kind: "unknown-column", fieldKey: key, column });
  }

  const mappedKeys = new Set(mapped.map(({ key }) => key));
  const isMapped = (key: string): boolean => mappedKeys.has(key);
  for (const dependency of fieldSet.dependencies) {
    const missing = unmetRequirements(dependency, isMapped);
    if (missing.length === 0) continue;
    problems.push({
      kind: "incomplete-group",
      dependencyId: dependency.id,
      mappedKeys: fieldSet.fields
        .map((field) => field.key)
        .filter((key) => dependency.when.includes(key) && isMapped(key)),
      missing,
    });
  }

  for (const column of new Set(mapping.additionalColumns)) {
    const fieldKey = mapped.find((entry) => entry.column === column)?.key;
    if (!columnOrder.has(column)) problems.push({ kind: "unknown-additional-column", column });
    else if (fieldKey !== undefined)
      problems.push({ kind: "additional-column-mapped", column, fieldKey });
  }
  return problems;
}
