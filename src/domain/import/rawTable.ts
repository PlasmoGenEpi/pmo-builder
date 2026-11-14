import type { RawRow, RawTable } from "../types";

import { ImportError } from "./errors";

/** A cell as a reader produced it: text, or `null` when the reader saw nothing. */
export type GridCell = string | null;

/** Empty or whitespace-only text becomes `null`; anything else is kept exactly. */
export function cleanCell(cell: GridCell | undefined): string | null {
  if (cell === undefined || cell === null || cell.trim() === "") return null;
  return cell;
}

/** Gives blank headers a position name and makes repeated headers unique: `reads`, `reads (2)`. */
function uniqueHeaders(headers: readonly (string | null)[]): string[] {
  const named = headers.map((header, index) => header ?? `Column ${index + 1}`);
  const taken = new Set<string>();
  const counts = new Map<string, number>();
  // Names that appear in the file are reserved first, so `reads (2)` in the
  // file is never shadowed by a generated name.
  const original = new Set(named);
  return named.map((name) => {
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
    let count = counts.get(name) ?? 1;
    let candidate: string;
    do {
      count += 1;
      candidate = `${name} (${count})`;
    } while (taken.has(candidate) || original.has(candidate));
    counts.set(name, count);
    taken.add(candidate);
    return candidate;
  });
}

/**
 * Turns a grid of cells into a raw table: the first non-blank row is the
 * header, blank rows are dropped, trailing columns with no header and no data
 * are dropped, and headers are trimmed, named and made unique.
 *
 * @throws {ImportError} `empty-file` when every row is blank, `no-rows` when
 *   only the header is left.
 */
export function gridToRawTable(grid: Iterable<readonly GridCell[]>, fileName: string): RawTable {
  // Works on the grid in place: a large file is not copied row by row before
  // the records are made. Only the indexes of the rows that are not blank are kept.
  const all: readonly (readonly GridCell[])[] = Array.isArray(grid) ? grid : [...grid];
  const kept: number[] = [];
  let width = 0;
  for (let index = 0; index < all.length; index += 1) {
    const row = all[index];
    if (row === undefined || !row.some((cell) => cleanCell(cell) !== null)) continue;
    kept.push(index);
    if (row.length > width) width = row.length;
  }
  const headerRow = kept.length === 0 ? undefined : all[kept[0] ?? 0];
  if (headerRow === undefined) {
    throw new ImportError(
      "empty-file",
      `${fileName} is empty. Choose a file that has a header row and data.`,
    );
  }
  if (kept.length === 1) {
    throw new ImportError(
      "no-rows",
      `${fileName} has a header row but no data rows. Add the data below the header and try again.`,
    );
  }

  const headers = Array.from({ length: width }, (_, index) => {
    const header = cleanCell(headerRow[index]);
    return header === null ? null : header.trim();
  });
  const blankFrom = (column: number): boolean =>
    kept.every(
      (rowIndex, position) => position === 0 || cleanCell(all[rowIndex]?.[column]) === null,
    );
  while (width > 0 && headers[width - 1] === null && blankFrom(width - 1)) width -= 1;
  const columns = uniqueHeaders(headers.slice(0, width));

  const tableRows: RawRow[] = [];
  for (let position = 1; position < kept.length; position += 1) {
    const row = all[kept[position] ?? 0] ?? [];
    const record: Record<string, string | null> = {};
    for (let column = 0; column < columns.length; column += 1) {
      record[columns[column] ?? ""] = cleanCell(row[column]);
    }
    tableRows.push(record);
  }
  return { columns, rows: tableRows };
}
