import Papa from "papaparse";

import { createCellInterner } from "./intern";

/** The delimiters {@link detectDelimiter} chooses between. */
export const DELIMITERS = [",", "\t", ";", "|"] as const;

/** One of {@link DELIMITERS}. */
export type Delimiter = (typeof DELIMITERS)[number];

/** How many rows the delimiter detection looks at. */
const SAMPLE_ROWS = 100;

function parseRows(text: string, delimiter: Delimiter, preview = 0): string[][] {
  const result = Papa.parse<string[]>(text, {
    delimiter,
    header: false,
    skipEmptyLines: false,
    preview,
  });
  const rows = result.data;
  // Papa picks one line ending for the file. With mixed endings, a `\r` is
  // left on the last cell of lines that end in `\r\n`; take it off.
  if (result.meta.linebreak === "\n") {
    for (const row of rows) {
      const last = row.length - 1;
      const cell = row[last];
      if (cell?.endsWith("\r") === true) row[last] = cell.slice(0, -1);
    }
  }
  return rows;
}

function isBlankRow(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}

/**
 * Picks the delimiter that splits the start of the file into the most
 * consistent table: the share of rows with the same number of fields as the
 * header counts first, then the number of fields. A file where no delimiter
 * gives more than one column is a one-column table; it gets a tab, or a comma
 * for `.csv` files. On a tie the delimiter the extension suggests wins.
 */
export function detectDelimiter(text: string, preferred: Delimiter): Delimiter {
  let best: { delimiter: Delimiter; consistency: number; fields: number } | null = null;
  const ordered = [preferred, ...DELIMITERS.filter((delimiter) => delimiter !== preferred)];
  for (const delimiter of ordered) {
    const rows = parseRows(text, delimiter, SAMPLE_ROWS).filter((row) => !isBlankRow(row));
    const [header, ...data] = rows;
    if (header === undefined || header.length < 2) continue;
    const sample = data.length === 0 ? [header] : data;
    const consistency = sample.filter((row) => row.length === header.length).length / sample.length;
    const better =
      best === null ||
      consistency > best.consistency ||
      (consistency === best.consistency && header.length > best.fields);
    if (better) best = { delimiter, consistency, fields: header.length };
  }
  return best?.delimiter ?? preferred;
}

/**
 * Splits delimited text into rows of cells, honouring quotes and embedded
 * line breaks. Each distinct text is stored once per column (see
 * `createCellInterner`), and no cell keeps `text` alive.
 */
export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  const intern = createCellInterner();
  const rows: string[][] = [];
  Papa.parse<string[]>(text, {
    delimiter,
    header: false,
    skipEmptyLines: false,
    step: (result) => {
      const row = result.data;
      // See `parseRows`: a `\r` left by mixed line endings comes off the last cell.
      const last = row.length - 1;
      const lastCell = row[last];
      if (result.meta.linebreak === "\n" && lastCell?.endsWith("\r") === true) {
        row[last] = lastCell.slice(0, -1);
      }
      for (let column = 0; column < row.length; column += 1) {
        row[column] = intern(column, row[column] ?? "");
      }
      rows.push(row);
    },
  });
  return rows;
}
