import { inferColumns, inferColumnTypes, type Row, type Table } from "pmotools-ts";

import type {
  ColumnMapping,
  FieldKind,
  FieldSetSpec,
  ParseOptions,
  ParsedFile,
  RawRow,
  RawTable,
} from "../types";

import { readBooleanCell } from "./boolean";
import { decodeText, gunzip, isGzip, isOle, isZip } from "./bytes";
import { detectDelimiter, parseDelimited, type Delimiter } from "./delimited";
import { IMPORT_LIMITS, ImportError, formatLimitBytes } from "./errors";
import { gridToRawTable } from "./rawTable";
import { readWorkbook, xlsNotSupported } from "./xlsx";

export { BOOLEAN_SPELLINGS, readBooleanCell, type BooleanCell } from "./boolean";
export {
  IMPORT_LIMITS,
  ImportError,
  isImportError,
  type ImportErrorCode,
  type ImportErrorDetail,
} from "./errors";
export { importFailureMessage, type ImportFailure, type ImportFailureCode } from "./messages";
export { uniqueHeaders } from "./rawTable";
export {
  DEFAULT_STREAM_CHUNK_SIZE,
  PREVIEW_KEEP_ROWS,
  PREVIEW_SCAN_ROWS,
  inspectDelimitedStream,
  streamDelimitedChunks,
  streamDistinctValues,
  type DelimitedStreamInspection,
  type DelimitedStreamMeta,
  type InspectStreamOptions,
  type StreamChunksOptions,
  type StreamDistinctValuesOptions,
  type StreamDistinctValuesResult,
  type StreamReadProgress,
  type StreamTextEncoding,
} from "./stream";
export { excelCellToText, formatExcelDate } from "./xlsx";

const DELIMITED_EXTENSIONS = new Set(["csv", "tsv", "txt", "tab"]);
const GZIP_EXTENSIONS = new Set(["gz", "gzip"]);

/** The file's extension, lower case, with a trailing `.gz` or `.gzip` taken off. */
function baseExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  if (parts.length > 1 && GZIP_EXTENSIONS.has(parts.at(-1) ?? "")) parts.pop();
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

function isGzipOnly(fileName: string): boolean {
  const parts = fileName.toLowerCase().split(".");
  return parts.length === 2 && GZIP_EXTENSIONS.has(parts[1] ?? "");
}

function unsupported(fileName: string): ImportError {
  return new ImportError(
    "unsupported-type",
    `${fileName} is not a file type that can be read. Upload a .csv, .tsv, .txt or .xlsx file (a .gz of a text file also works).`,
  );
}

async function parseWorkbook(
  source: Blob,
  fileName: string,
  options: ParseOptions | undefined,
): Promise<ParsedFile> {
  const sheets = await readWorkbook(source, fileName);
  const sheetNames = sheets.map((sheet) => sheet.name);
  const wanted = options?.sheetName;
  const sheet = wanted === undefined ? sheets[0] : sheets.find((entry) => entry.name === wanted);
  if (sheet === undefined) {
    throw wanted === undefined
      ? new ImportError("empty-file", `${fileName} has no sheets.`)
      : new ImportError(
          "missing-sheet",
          `${fileName} has no sheet called "${wanted}". Its sheets are: ${sheetNames.join(", ")}.`,
        );
  }
  const label = sheets.length > 1 ? `Sheet "${sheet.name}" of ${fileName}` : fileName;
  return {
    format: "xlsx",
    delimiter: null,
    sheetNames,
    sheetName: sheet.name,
    table: gridToRawTable(sheet.rows, label),
  };
}

/**
 * Reads a delimited text file (csv, tsv, txt, optionally gzipped) or an Excel
 * workbook into a table of raw text cells.
 *
 * - Gzip is recognised from the first bytes, whatever the name says.
 * - Text is read as UTF-8, or Windows-1252 when it is not valid UTF-8, without
 *   a byte order mark. The delimiter (comma, tab, semicolon or pipe) is
 *   detected from the content.
 * - `.xlsx` workbooks are read in a separately loaded chunk. Cells become the
 *   text a careful CSV export would hold (see `excelCellToText`).
 * - Headers are trimmed, blank ones named `Column N`, repeats made unique.
 *   Blank rows and trailing blank unnamed columns are dropped. Blank cells
 *   are `null`; other cells are kept exactly.
 *
 * @throws {ImportError} with code `empty-file`, `no-rows`, `unsupported-type`
 *   (including `.xls`), `unreadable-file`, `unreadable-workbook` or `missing-sheet`.
 */
export async function parseFile(
  source: Blob,
  fileName: string,
  options?: ParseOptions,
): Promise<ParsedFile> {
  const extension = baseExtension(fileName);
  if (extension === "xls") throw xlsNotSupported(fileName);
  const known = extension === "xlsx" || DELIMITED_EXTENSIONS.has(extension) || isGzipOnly(fileName);
  if (!known) throw unsupported(fileName);

  const limits = {
    textBytes: options?.limits?.textBytes ?? IMPORT_LIMITS.textBytes,
    workbookBytes: options?.limits?.workbookBytes ?? IMPORT_LIMITS.workbookBytes,
  };
  const content = await readContent({ source, fileName, extension, limits });
  if (content.kind === "workbook") return parseWorkbook(content.blob, fileName, options);
  const preferred: Delimiter = extension === "csv" ? "," : "\t";
  const delimiter = detectDelimiter(content.text, preferred);
  return {
    format: "delimited",
    delimiter,
    sheetNames: null,
    sheetName: null,
    table: gridToRawTable(parseDelimited(content.text, delimiter), fileName),
  };
}

type Content =
  | { readonly kind: "workbook"; readonly blob: Blob }
  | { readonly kind: "text"; readonly text: string };

interface Limits {
  readonly textBytes: number;
  readonly workbookBytes: number;
}

function tooLarge(fileName: string, measure: "text" | "workbook", limits: Limits): ImportError {
  const limitBytes = measure === "text" ? limits.textBytes : limits.workbookBytes;
  return new ImportError(
    "too-large",
    measure === "text"
      ? `${fileName} is larger than ${formatLimitBytes(limitBytes)} of text, too large to open in the browser. Split it into smaller files, or remove columns you do not need, and try again.`
      : `${fileName} is a workbook larger than ${formatLimitBytes(limitBytes)}, too large to open in the browser. Save the sheet as a .csv or .tsv file and import that instead.`,
    { detail: { kind: "too-large", measure, limitBytes } },
  );
}

/**
 * Reads the file's bytes and turns them into text or a workbook. The bytes
 * are not kept once decoded, so a large file is held once, as text, while it
 * is parsed. Files over {@link IMPORT_LIMITS} are refused before they are read
 * in full; a `.gz` is unpacked only up to the limit.
 */
async function readContent(input: {
  readonly source: Blob;
  readonly fileName: string;
  readonly extension: string;
  readonly limits: Limits;
}): Promise<Content> {
  const { source, fileName, extension, limits } = input;
  if (source.size === 0) {
    throw new ImportError(
      "empty-file",
      `${fileName} is empty. Choose a file that has a header row and data.`,
    );
  }
  const head = new Uint8Array(await source.slice(0, 8).arrayBuffer());
  if (!isGzip(head)) {
    if (isZip(head) || extension === "xlsx") {
      if (source.size > limits.workbookBytes) throw tooLarge(fileName, "workbook", limits);
    } else if (source.size > limits.textBytes) {
      throw tooLarge(fileName, "text", limits);
    }
  }
  let bytes: Uint8Array = new Uint8Array(await source.arrayBuffer());
  if (isGzip(bytes)) {
    const unpacked = await gunzip(bytes, fileName, limits.textBytes);
    if (unpacked === null) throw tooLarge(fileName, "text", limits);
    bytes = unpacked;
  }
  if (isOle(bytes)) throw xlsNotSupported(fileName);
  if (isZip(bytes)) {
    if (bytes.length > limits.workbookBytes) throw tooLarge(fileName, "workbook", limits);
    return { kind: "workbook", blob: new Blob([new Uint8Array(bytes)]) };
  }
  if (extension === "xlsx") {
    throw new ImportError(
      "unreadable-workbook",
      `${fileName} is not a valid Excel workbook. Open it in Excel, save it as .xlsx, and try again.`,
    );
  }
  if (bytes.length > limits.textBytes) throw tooLarge(fileName, "text", limits);
  return { kind: "text", text: decodeText(bytes) };
}

/** Options for {@link typeTable}. */
export interface TypeTableOptions {
  /** Columns whose cells must stay text, because they are mapped to text, date or list fields. */
  readonly textColumns: readonly string[];
  /** Columns mapped to yes-or-no fields, read with `readBooleanCell`. Default: none. */
  readonly booleanColumns?: readonly string[];
}

/**
 * Types a raw table for the pmotools-ts builders: the named columns stay text,
 * yes-or-no columns become booleans, and every other column is typed the way
 * pandas would type it.
 *
 * Text columns keep every cell exactly as read, so `0012`, `2024` and `NA`
 * stay strings; only blank cells are `null`. Boolean columns hold `true`,
 * `false` or `null` (see `readBooleanCell`); a cell that is not a yes or no
 * keeps its text, so check those columns first and report such cells. A
 * column named in both lists stays text. The other columns go through
 * pmotools-ts `inferColumns`, which reproduces `pd.read_csv` (numbers,
 * booleans, and pandas' missing-value strings such as `NA`). Names that the
 * table does not have are ignored. Each row holds every column, in table order.
 */
export function typeTable(table: RawTable, options: TypeTableOptions): Table {
  const text = new Set(options.textColumns.filter((column) => table.columns.includes(column)));
  const booleans = new Set(
    (options.booleanColumns ?? []).filter(
      (column) => table.columns.includes(column) && !text.has(column),
    ),
  );
  if (text.size === 0 && booleans.size === 0) return inferColumnTypes(table.rows);

  // Only the inferred columns go through `inferColumns`; the others are
  // copied or read as yes or no straight from the raw cells, in one pass.
  const columns = table.columns;
  const kinds = columns.map((column) =>
    text.has(column) ? "text" : booleans.has(column) ? "boolean" : "inferred",
  );
  const inferred = columns.filter((_, index) => kinds[index] === "inferred");
  const typedRows: readonly Row[] =
    inferred.length === 0 ? [] : inferColumns(table.rows.map((row) => pick(row, inferred))).table;
  const rows: Row[] = [];
  for (let index = 0; index < table.rows.length; index += 1) {
    const row = table.rows[index] ?? {};
    const typed = typedRows[index];
    const record: Record<string, Row[string]> = {};
    for (let position = 0; position < columns.length; position += 1) {
      const column = columns[position] ?? "";
      const cell = row[column] ?? null;
      const kind = kinds[position];
      record[column] =
        kind === "text"
          ? cell
          : kind === "boolean"
            ? booleanValue(cell)
            : (typed?.[column] ?? null);
    }
    rows.push(record);
  }
  return rows;
}

function pick(row: RawRow, columns: readonly string[]): RawRow {
  const picked: Record<string, string | null> = {};
  for (const column of columns) picked[column] = row[column] ?? null;
  return picked;
}

function booleanValue(cell: string | null): boolean | string | null {
  const read = readBooleanCell(cell);
  switch (read.kind) {
    case "value":
      return read.value;
    case "blank":
      return null;
    case "invalid":
      return read.text;
    default:
      return null;
  }
}

const TEXT_KINDS: ReadonlySet<FieldKind> = new Set(["text", "date", "list"]);

/**
 * The columns that must stay text for a mapping: those mapped to a `text`,
 * `date` or `list` field, in the order of the field set, without repeats.
 */
export function textColumnsFor(fieldSet: FieldSetSpec, mapping: ColumnMapping): string[] {
  const columns = new Set<string>();
  for (const field of fieldSet.fields) {
    const column = mapping.fields[field.key] ?? null;
    if (column !== null && TEXT_KINDS.has(field.kind)) columns.add(column);
  }
  return [...columns];
}
