/**
 * Streaming reader for delimited text files (plain or gzipped).
 *
 * Reads from a stored `Blob` in chunks without holding the whole file as one
 * string or one row array, while preserving `parseFile` + `gridToRawTable`
 * parity for extensions, magic bytes, BOMs, UTF-8 / Windows-1252 decoding,
 * delimiter detection, RFC-4180 quoting, line endings, header normalization,
 * blank rows, and cell interning.
 */
import type { RawRow } from "../types";

import { isGzip, isOle, isZip } from "./bytes";
import { detectDelimiter, type Delimiter } from "./delimited";
import { IMPORT_LIMITS, ImportError, megabytes } from "./errors";
import { createCellInterner } from "./intern";
import { cleanCell, uniqueHeaders } from "./rawTable";
import { xlsNotSupported } from "./xlsx";

/** How many non-blank data rows {@link inspectDelimitedStream} scans before stopping. */
export const PREVIEW_SCAN_ROWS = 2_000;

/** How many data rows {@link inspectDelimitedStream} keeps for table preview and column examples. */
export const PREVIEW_KEEP_ROWS = 200;

/** Default number of rows yielded per chunk by {@link streamDelimitedChunks}. */
export const DEFAULT_STREAM_CHUNK_SIZE = 50_000;

const DELIMITED_EXTENSIONS = new Set(["csv", "tsv", "txt", "tab"]);
const GZIP_EXTENSIONS = new Set(["gz", "gzip"]);

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const UTF16LE_BOM = [0xff, 0xfe] as const;
const UTF16BE_BOM = [0xfe, 0xff] as const;

const HEADER_PROBE_BYTES = 8;
const SNIFF_TARGET_LINES = 105;
const SNIFF_MAX_CHARS = 256 * 1024;
const DEFAULT_DISTINCT_LIMIT = 200;

/** Text encoding detected for a delimited stream. */
export type StreamTextEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

/** Monotonic read progress over a stored file `Blob`. */
export interface StreamReadProgress {
  /** Raw bytes read from the source `Blob` so far (compressed bytes when gzipped). */
  readonly bytesRead: number;
  /** Total bytes of the source `Blob`. */
  readonly totalBytes: number;
  /** Non-blank data rows read so far. */
  readonly rowsRead: number;
}

/** Header and preview information gathered by {@link inspectDelimitedStream}. */
export interface DelimitedStreamMeta {
  readonly delimiter: Delimiter;
  readonly encoding: StreamTextEncoding;
  /** Normalized column names in file order (trimmed, named `Column N`, unique, trailing blanks dropped). */
  readonly columns: readonly string[];
  /** Trimmed header cells from the first non-blank row (`null` for blank header cells). */
  readonly rawHeaders: readonly (string | null)[];
  /** Up to {@link PREVIEW_KEEP_ROWS} data rows from the start of the file. */
  readonly previewRows: readonly RawRow[];
  /** Exact data row count when EOF was reached within {@link PREVIEW_SCAN_ROWS}, else `null`. */
  readonly exactRowCount: number | null;
}

/** What {@link inspectDelimitedStream} returns. */
export type DelimitedStreamInspection =
  | { readonly kind: "workbook" }
  | { readonly kind: "delimited"; readonly meta: DelimitedStreamMeta };

/** Options for {@link inspectDelimitedStream}. */
export interface InspectStreamOptions {
  readonly fileName: string;
  /** Maximum unpacked text bytes. Defaults to {@link IMPORT_LIMITS.textBytes}. */
  readonly maxTextBytes?: number;
  /** Maximum workbook file bytes. Defaults to {@link IMPORT_LIMITS.workbookBytes}. */
  readonly maxWorkbookBytes?: number;
}

/** Options for {@link streamDelimitedChunks}. */
export interface StreamChunksOptions {
  readonly fileName: string;
  readonly delimiter: Delimiter;
  /** Encoding from inspection; `"utf-8"` falls back automatically to `"windows-1252"` on invalid bytes. */
  readonly encoding?: StreamTextEncoding;
  /** Normalized columns from inspection, when known, so early chunks share the preview width. */
  readonly columns?: readonly string[];
  /** Rows emitted per chunk. Defaults to {@link DEFAULT_STREAM_CHUNK_SIZE}. */
  readonly chunkSize?: number;
  /** Maximum unpacked text bytes. Defaults to {@link IMPORT_LIMITS.textBytes}. */
  readonly maxTextBytes?: number;
  /** Called as chunks are emitted with monotonic byte progress against `source.size`. */
  readonly onProgress?: (progress: StreamReadProgress) => void;
  /** Checked between chunks; when true, cancels the stream and returns cleanly. */
  readonly isSuperseded?: () => boolean;
  /**
   * Called if a late non-UTF-8 byte forces a full restart from row 0 in
   * `"windows-1252"` after non-ASCII UTF-8 rows were already yielded, so the
   * caller can reset its state.
   */
  readonly onRestart?: (encoding: StreamTextEncoding) => void;
}

/** Options for {@link streamDistinctValues}. */
export interface StreamDistinctValuesOptions {
  readonly fileName: string;
  readonly delimiter: Delimiter;
  readonly encoding?: StreamTextEncoding;
  readonly column: string;
  /** Maximum distinct trimmed non-blank values to return. Defaults to 200. */
  readonly limit?: number;
  /** Maximum unpacked text bytes. Defaults to {@link IMPORT_LIMITS.textBytes}. */
  readonly maxTextBytes?: number;
  /** Checked between chunks; when true, cancels the stream and returns what was seen so far. */
  readonly isSuperseded?: () => boolean;
}

/** Distinct non-blank trimmed values of one column from {@link streamDistinctValues}. */
export interface StreamDistinctValuesResult {
  readonly values: readonly string[];
  readonly truncated: boolean;
}

function baseExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  if (parts.length > 1 && GZIP_EXTENSIONS.has(parts.at(-1) ?? "")) parts.pop();
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

function isGzipOnly(fileName: string): boolean {
  const parts = fileName.toLowerCase().split(".");
  return parts.length === 2 && GZIP_EXTENSIONS.has(parts[1] ?? "");
}

function unsupportedTypeError(fileName: string): ImportError {
  return new ImportError(
    "unsupported-type",
    `${fileName} is not a file type that can be read. Upload a .csv, .tsv, .txt or .xlsx file (a .gz of a text file also works).`,
  );
}

function emptyFileError(fileName: string): ImportError {
  return new ImportError(
    "empty-file",
    `${fileName} is empty. Choose a file that has a header row and data.`,
  );
}

function noRowsError(fileName: string): ImportError {
  return new ImportError(
    "no-rows",
    `${fileName} has a header row but no data rows. Add the data below the header and try again.`,
  );
}

function unreadableWorkbookError(fileName: string): ImportError {
  return new ImportError(
    "unreadable-workbook",
    `${fileName} is not a valid Excel workbook. Open it in Excel, save it as .xlsx, and try again.`,
  );
}

function unreadableGzipError(fileName: string, cause: unknown): ImportError {
  return new ImportError(
    "unreadable-file",
    `${fileName} looks compressed but could not be unpacked. Check that the file is complete, or upload it uncompressed.`,
    { cause },
  );
}

function tooLargeError(
  fileName: string,
  measure: "text" | "workbook",
  limitBytes: number,
): ImportError {
  return new ImportError(
    "too-large",
    measure === "text"
      ? `${fileName} is larger than ${megabytes(limitBytes)} of text, too large to open in the browser. Split it into smaller files, or remove columns you do not need, and try again.`
      : `${fileName} is a workbook larger than ${megabytes(limitBytes)}, too large to open in the browser. Save the sheet as a .csv or .tsv file and import that instead.`,
    { detail: { kind: "too-large", measure, limitBytes } },
  );
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function hasNonAsciiByte(bytes: Uint8Array): boolean {
  for (let index = 0; index < bytes.length; index += 1) {
    if ((bytes[index] ?? 0) >= 0x80) return true;
  }
  return false;
}

function concatBytes(chunks: readonly Uint8Array[], totalLength: number): Uint8Array {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Fast equivalent of {@link cleanCell} that avoids `.trim()` on printable ASCII. */
function fastCleanCell(cell: string): string | null {
  if (cell.length === 0) return null;
  const first = cell.charCodeAt(0);
  if (first > 32 && first < 127) return cell;
  return cleanCell(cell);
}

const STATE_FIELD_START = 0;
const STATE_IN_UNQUOTED = 1;
const STATE_IN_QUOTES = 2;
const STATE_AFTER_QUOTE = 3;
const STATE_AFTER_CR = 4;

const CODE_QUOTE = 34;
const CODE_CR = 13;
const CODE_LF = 10;

interface RowParser {
  feed(chunk: string): void;
  end(): void;
}

/**
 * Streaming RFC-4180 parser handling `\r\n`, `\n`, `\r`, mixed endings, quoted
 * fields, `""` escapes, embedded newlines, and arbitrary chunk splits. Blank
 * rows are dropped and non-null cells are interned per column.
 */
function createRowParser(
  delimiter: Delimiter,
  onRow: (cells: (string | null)[]) => void,
): RowParser {
  const intern = createCellInterner();
  const delimCode = delimiter.charCodeAt(0);
  let state = STATE_FIELD_START;
  let cellText = "";
  let row: (string | null)[] = [];
  let hasNonBlank = false;

  function pushCell(): void {
    const cleaned = fastCleanCell(cellText);
    if (cleaned !== null) {
      row.push(intern(row.length, cleaned));
      hasNonBlank = true;
    } else {
      row.push(null);
    }
    cellText = "";
  }

  function finishRow(): void {
    if (hasNonBlank) onRow(row);
    row = [];
    hasNonBlank = false;
  }

  function feed(chunk: string): void {
    let i = 0;
    const len = chunk.length;
    while (i < len) {
      if (state === STATE_AFTER_CR) {
        state = STATE_FIELD_START;
        if (chunk.charCodeAt(i) === CODE_LF) {
          i += 1;
          continue;
        }
      }
      if (state === STATE_FIELD_START) {
        const code = chunk.charCodeAt(i);
        if (code === CODE_QUOTE) {
          state = STATE_IN_QUOTES;
          i += 1;
          continue;
        }
        if (code === delimCode) {
          row.push(null);
          i += 1;
          continue;
        }
        if (code === CODE_CR) {
          if (row.length > 0) row.push(null);
          finishRow();
          state = STATE_AFTER_CR;
          i += 1;
          continue;
        }
        if (code === CODE_LF) {
          if (row.length > 0) row.push(null);
          finishRow();
          i += 1;
          continue;
        }
        state = STATE_IN_UNQUOTED;
      }
      if (state === STATE_IN_UNQUOTED) {
        let j = i;
        while (j < len) {
          const code = chunk.charCodeAt(j);
          if (code === delimCode || code === CODE_CR || code === CODE_LF) break;
          j += 1;
        }
        if (j > i) {
          const slice = chunk.slice(i, j);
          cellText = cellText.length === 0 ? slice : cellText + slice;
          i = j;
        }
        if (i < len) {
          const code = chunk.charCodeAt(i);
          pushCell();
          if (code === delimCode) {
            state = STATE_FIELD_START;
          } else if (code === CODE_CR) {
            finishRow();
            state = STATE_AFTER_CR;
          } else {
            finishRow();
            state = STATE_FIELD_START;
          }
          i += 1;
        }
        continue;
      }
      if (state === STATE_IN_QUOTES) {
        const quoteAt = chunk.indexOf('"', i);
        if (quoteAt === -1) {
          const slice = chunk.slice(i);
          cellText = cellText.length === 0 ? slice : cellText + slice;
          break;
        }
        if (quoteAt > i) {
          const slice = chunk.slice(i, quoteAt);
          cellText = cellText.length === 0 ? slice : cellText + slice;
        }
        state = STATE_AFTER_QUOTE;
        i = quoteAt + 1;
        continue;
      }
      // STATE_AFTER_QUOTE
      const code = chunk.charCodeAt(i);
      if (code === CODE_QUOTE) {
        cellText += '"';
        state = STATE_IN_QUOTES;
        i += 1;
        continue;
      }
      if (code === delimCode) {
        pushCell();
        state = STATE_FIELD_START;
        i += 1;
        continue;
      }
      if (code === CODE_CR) {
        pushCell();
        finishRow();
        state = STATE_AFTER_CR;
        i += 1;
        continue;
      }
      if (code === CODE_LF) {
        pushCell();
        finishRow();
        state = STATE_FIELD_START;
        i += 1;
        continue;
      }
      state = STATE_IN_UNQUOTED;
    }
  }

  function end(): void {
    if (state === STATE_IN_UNQUOTED || state === STATE_IN_QUOTES || state === STATE_AFTER_QUOTE) {
      pushCell();
      finishRow();
    } else if (state === STATE_FIELD_START && row.length > 0) {
      row.push(null);
      finishRow();
    }
    state = STATE_FIELD_START;
    cellText = "";
    row = [];
    hasNonBlank = false;
  }

  return { feed, end };
}

/** Tracks an open decoded text stream over a Blob (plain or gzipped). */
interface DecodedStream {
  readonly encoding: StreamTextEncoding;
  readonly bytesRead: () => number;
  readonly sawNonAscii: () => boolean;
  next(): Promise<string | null>;
  close(): Promise<void>;
}

/** Internal sentinel thrown when fatal UTF-8 decoding hits invalid bytes. */
class Utf8DecodeFallbackError extends Error {
  override readonly name = "Utf8DecodeFallbackError";
}

interface OpenTextStreamOptions {
  readonly fileName: string;
  readonly extension: string;
  readonly gzipped: boolean;
  readonly maxTextBytes: number;
  readonly forcedEncoding?: StreamTextEncoding;
  readonly checkGzipWorkbook?: boolean;
}

type OpenedStream =
  | { readonly kind: "workbook" }
  | { readonly kind: "text"; readonly stream: DecodedStream };

async function openDecodedStream(
  source: Blob,
  options: OpenTextStreamOptions,
): Promise<OpenedStream> {
  const { fileName, extension, gzipped, maxTextBytes, forcedEncoding, checkGzipWorkbook } = options;
  let rawBytesRead = 0;
  let unpackedBytes = 0;

  const counter = new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
    transform(chunk, controller) {
      rawBytesRead += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });

  const counted = source.stream().pipeThrough(counter);
  const byteStream = gzipped ? counted.pipeThrough(new DecompressionStream("gzip")) : counted;
  const reader = byteStream.getReader();

  async function safeCancel(): Promise<void> {
    try {
      await reader.cancel();
    } catch {
      // Ignore secondary errors when tearing down a failed/aborted stream.
    }
  }

  async function readNextBytes(): Promise<Uint8Array | null> {
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await reader.read();
    } catch (error) {
      await safeCancel();
      if (gzipped) throw unreadableGzipError(fileName, error);
      throw error;
    }
    if (result.done) return null;
    unpackedBytes += result.value.byteLength;
    if (unpackedBytes > maxTextBytes) {
      await safeCancel();
      throw tooLargeError(fileName, "text", maxTextBytes);
    }
    return result.value;
  }

  // Buffer up to 8 unpacked bytes so BOM and gzipped-magic checks work across 1-byte chunks.
  const initialChunks: Uint8Array[] = [];
  let initialLength = 0;
  let hitEofDuringProbe = false;
  while (initialLength < HEADER_PROBE_BYTES) {
    // oxlint-disable-next-line no-await-in-loop -- reading stream sequentially
    const chunk = await readNextBytes();
    if (chunk === null) {
      hitEofDuringProbe = true;
      break;
    }
    initialChunks.push(chunk);
    initialLength += chunk.byteLength;
  }

  if (initialLength === 0) {
    await safeCancel();
    throw emptyFileError(fileName);
  }

  const initial = concatBytes(initialChunks, initialLength);

  if (gzipped && checkGzipWorkbook === true) {
    if (isOle(initial)) {
      await safeCancel();
      throw xlsNotSupported(fileName);
    }
    if (isZip(initial)) {
      await safeCancel();
      return { kind: "workbook" };
    }
    if (extension === "xlsx") {
      await safeCancel();
      throw unreadableWorkbookError(fileName);
    }
  }

  let encoding: StreamTextEncoding;
  let decoder: TextDecoder;
  let firstBody: Uint8Array;

  if (forcedEncoding !== undefined) {
    encoding = forcedEncoding;
    if (forcedEncoding === "utf-16le" || forcedEncoding === "utf-16be") {
      decoder = new TextDecoder(forcedEncoding);
      firstBody = initial;
    } else if (forcedEncoding === "utf-8") {
      decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
      firstBody = startsWith(initial, UTF8_BOM) ? initial.subarray(UTF8_BOM.length) : initial;
    } else {
      decoder = new TextDecoder("windows-1252");
      firstBody = startsWith(initial, UTF8_BOM) ? initial.subarray(UTF8_BOM.length) : initial;
    }
  } else if (startsWith(initial, UTF16LE_BOM)) {
    encoding = "utf-16le";
    decoder = new TextDecoder("utf-16le");
    firstBody = initial;
  } else if (startsWith(initial, UTF16BE_BOM)) {
    encoding = "utf-16be";
    decoder = new TextDecoder("utf-16be");
    firstBody = initial;
  } else {
    encoding = "utf-8";
    decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    firstBody = startsWith(initial, UTF8_BOM) ? initial.subarray(UTF8_BOM.length) : initial;
  }

  let nonAsciiSeen = false;
  let strippedLeadingBom = false;
  let pendingFirst: Uint8Array | null = firstBody;
  let finished = false;

  function decodeChunk(bytes: Uint8Array | null, final: boolean): string {
    if (bytes !== null && encoding === "utf-8" && !nonAsciiSeen && hasNonAsciiByte(bytes)) {
      nonAsciiSeen = true;
    }
    let decoded: string;
    try {
      decoded = bytes === null ? decoder.decode() : decoder.decode(bytes, { stream: !final });
    } catch (error) {
      if (error instanceof TypeError && encoding === "utf-8") {
        throw new Utf8DecodeFallbackError("Invalid UTF-8 byte sequence");
      }
      throw error;
    }
    if (!strippedLeadingBom && decoded.length > 0) {
      strippedLeadingBom = true;
      if (decoded.startsWith("\ufeff")) return decoded.slice(1);
    }
    return decoded;
  }

  const stream: DecodedStream = {
    encoding,
    bytesRead: () => rawBytesRead,
    sawNonAscii: () => nonAsciiSeen,
    async next(): Promise<string | null> {
      if (finished) return null;
      if (pendingFirst !== null) {
        const first = pendingFirst;
        pendingFirst = null;
        if (hitEofDuringProbe) {
          finished = true;
          try {
            return decodeChunk(first, true);
          } catch (error) {
            await safeCancel();
            throw error;
          }
        }
        try {
          return decodeChunk(first, false);
        } catch (error) {
          await safeCancel();
          throw error;
        }
      }
      const chunk = await readNextBytes();
      if (chunk === null) {
        finished = true;
        try {
          const tail = decodeChunk(null, true);
          return tail.length > 0 ? tail : null;
        } catch (error) {
          await safeCancel();
          throw error;
        }
      }
      try {
        return decodeChunk(chunk, false);
      } catch (error) {
        await safeCancel();
        throw error;
      }
    },
    close: safeCancel,
  };

  return { kind: "text", stream };
}

/** Counts line breaks outside quotes in `text` to stop delimiter sniffing once enough lines arrive. */
function countLogicalLines(text: string): { readonly lines: number; readonly inQuotes: boolean } {
  let lines = 0;
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === CODE_QUOTE) {
      inQuotes = !inQuotes;
    } else if (!inQuotes && (code === CODE_LF || code === CODE_CR)) {
      lines += 1;
      if (code === CODE_CR && text.charCodeAt(i + 1) === CODE_LF) i += 1;
    }
  }
  return { lines, inQuotes };
}

/** Trims an incomplete trailing line from a non-EOF sniff prefix so `detectDelimiter` sees whole rows. */
function sniffSample(prefix: string, hitEof: boolean): string {
  if (hitEof) return prefix;
  let lastBreak = -1;
  let inQuotes = false;
  for (let i = 0; i < prefix.length; i += 1) {
    const code = prefix.charCodeAt(i);
    if (code === CODE_QUOTE) {
      inQuotes = !inQuotes;
    } else if (!inQuotes && (code === CODE_LF || code === CODE_CR)) {
      lastBreak = i;
    }
  }
  return lastBreak > 0 ? prefix.slice(0, lastBreak + 1) : prefix;
}

/** Trims trailing blank unnamed columns and returns normalized header names for a given width. */
function columnsForWidth(rawHeaders: readonly (string | null)[], width: number): string[] {
  const padded = Array.from({ length: width }, (_, index) => rawHeaders[index] ?? null);
  return uniqueHeaders(padded);
}

/** Last index + 1 of any non-null entry in `row`. */
function activeRowWidth(row: readonly (string | null)[]): number {
  for (let index = row.length - 1; index >= 0; index -= 1) {
    if (row[index] !== null && row[index] !== undefined) return index + 1;
  }
  return 0;
}

/** Builds a `RawRow` record with keys in `columns` order. */
function toRawRow(columns: readonly string[], cells: readonly (string | null)[]): RawRow {
  const record: Record<string, string | null> = {};
  for (let column = 0; column < columns.length; column += 1) {
    const name = columns[column];
    if (name !== undefined) record[name] = cells[column] ?? null;
  }
  return record;
}

async function validateFileHeader(
  source: Blob,
  options: {
    readonly fileName: string;
    readonly maxTextBytes: number;
    readonly maxWorkbookBytes: number;
  },
): Promise<
  | { readonly kind: "workbook" }
  | { readonly kind: "stream"; readonly extension: string; readonly gzipped: boolean }
> {
  const { fileName, maxTextBytes, maxWorkbookBytes } = options;
  const extension = baseExtension(fileName);
  if (extension === "xls") throw xlsNotSupported(fileName);
  const known = extension === "xlsx" || DELIMITED_EXTENSIONS.has(extension) || isGzipOnly(fileName);
  if (!known) throw unsupportedTypeError(fileName);

  if (source.size === 0) throw emptyFileError(fileName);

  const head = new Uint8Array(await source.slice(0, HEADER_PROBE_BYTES).arrayBuffer());
  const gzipped = isGzip(head);
  if (!gzipped) {
    if (isZip(head) || extension === "xlsx") {
      if (source.size > maxWorkbookBytes) {
        throw tooLargeError(fileName, "workbook", maxWorkbookBytes);
      }
      if (isOle(head)) throw xlsNotSupported(fileName);
      if (isZip(head)) return { kind: "workbook" };
      throw unreadableWorkbookError(fileName);
    }
    if (source.size > maxTextBytes) {
      throw tooLargeError(fileName, "text", maxTextBytes);
    }
    if (isOle(head)) throw xlsNotSupported(fileName);
  }
  return { kind: "stream", extension, gzipped };
}

/**
 * Inspects a file from its stored `Blob` without holding the whole file in
 * memory: checks extension and magic bytes, returns `{ kind: "workbook" }` for
 * `.xlsx` / ZIP archives so callers can fall back to `parseFile`, or sniffs
 * encoding, delimiter, normalized headers, and the first rows of a delimited
 * text file (plain or gzipped).
 *
 * Scans up to {@link PREVIEW_SCAN_ROWS} non-blank data rows, keeping the first
 * {@link PREVIEW_KEEP_ROWS} for preview. `exactRowCount` is the exact count
 * when EOF was reached during the scan, or `null` when more rows follow.
 *
 * @throws {ImportError} with the same codes as `parseFile`.
 */
export async function inspectDelimitedStream(
  source: Blob,
  options: InspectStreamOptions,
): Promise<DelimitedStreamInspection> {
  const maxTextBytes = options.maxTextBytes ?? IMPORT_LIMITS.textBytes;
  const maxWorkbookBytes = options.maxWorkbookBytes ?? IMPORT_LIMITS.workbookBytes;

  const checked = await validateFileHeader(source, {
    fileName: options.fileName,
    maxTextBytes,
    maxWorkbookBytes,
  });
  if (checked.kind === "workbook") return { kind: "workbook" };

  const preferred: Delimiter = checked.extension === "csv" ? "," : "\t";

  const runInspection = async (
    forcedEncoding?: StreamTextEncoding,
  ): Promise<DelimitedStreamInspection> => {
    const opened = await openDecodedStream(source, {
      fileName: options.fileName,
      extension: checked.extension,
      gzipped: checked.gzipped,
      maxTextBytes,
      forcedEncoding,
      checkGzipWorkbook: true,
    });
    if (opened.kind === "workbook") return { kind: "workbook" };

    const stream = opened.stream;
    try {
      let prefix = "";
      let hitEof = false;
      while (prefix.length < SNIFF_MAX_CHARS) {
        // oxlint-disable-next-line no-await-in-loop -- streaming chunks in order
        const piece = await stream.next();
        if (piece === null) {
          hitEof = true;
          break;
        }
        prefix += piece;
        const status = countLogicalLines(prefix);
        if (status.lines >= SNIFF_TARGET_LINES && !status.inQuotes) break;
      }

      const delimiter = detectDelimiter(sniffSample(prefix, hitEof), preferred);

      const scan: {
        rawHeaders: (string | null)[] | null;
        maxActiveWidth: number;
        dataRows: number;
        moreRowsAfterScan: boolean;
      } = {
        rawHeaders: null,
        maxActiveWidth: 0,
        dataRows: 0,
        moreRowsAfterScan: false,
      };
      const previewGrid: (string | null)[][] = [];

      const parser = createRowParser(delimiter, (cells) => {
        if (scan.rawHeaders === null) {
          scan.rawHeaders = cells.map((cell) => (cell === null ? null : cell.trim()));
          scan.maxActiveWidth = activeRowWidth(scan.rawHeaders);
          return;
        }
        if (scan.dataRows >= PREVIEW_SCAN_ROWS) {
          scan.moreRowsAfterScan = true;
          return;
        }
        scan.dataRows += 1;
        const rowWidth = activeRowWidth(cells);
        if (rowWidth > scan.maxActiveWidth) scan.maxActiveWidth = rowWidth;
        if (previewGrid.length < PREVIEW_KEEP_ROWS) previewGrid.push(cells);
      });

      parser.feed(prefix);
      if (hitEof) {
        parser.end();
      } else {
        while (!scan.moreRowsAfterScan) {
          // oxlint-disable-next-line no-await-in-loop -- streaming chunks in order
          const piece = await stream.next();
          if (piece === null) {
            parser.end();
            break;
          }
          parser.feed(piece);
        }
      }

      if (scan.rawHeaders === null) throw emptyFileError(options.fileName);
      if (scan.dataRows === 0) throw noRowsError(options.fileName);

      const columns = columnsForWidth(scan.rawHeaders, scan.maxActiveWidth);
      const previewRows = previewGrid.map((cells) => toRawRow(columns, cells));

      return {
        kind: "delimited",
        meta: {
          delimiter,
          encoding: stream.encoding,
          columns,
          rawHeaders: scan.rawHeaders.slice(0, scan.maxActiveWidth),
          previewRows,
          exactRowCount: scan.moreRowsAfterScan ? null : scan.dataRows,
        },
      };
    } finally {
      await stream.close();
    }
  };

  try {
    return await runInspection();
  } catch (error) {
    if (error instanceof Utf8DecodeFallbackError) {
      return runInspection("windows-1252");
    }
    throw error;
  }
}

/**
 * Streams all non-blank data rows of a delimited `Blob` (plain or gzipped) in
 * chunks of `RawRow[]`, counting raw/compressed bytes before decompression so
 * progress is monotonic against `source.size`.
 *
 * Uses a fresh `createCellInterner()` per pass, handles late UTF-8 to
 * Windows-1252 fallback transparently, honours `isSuperseded?.()`, and
 * preserves `gridToRawTable` header/cell/blank-row parity.
 */
export async function* streamDelimitedChunks(
  source: Blob,
  options: StreamChunksOptions,
): AsyncGenerator<RawRow[], StreamTextEncoding, void> {
  const chunkSize = options.chunkSize ?? DEFAULT_STREAM_CHUNK_SIZE;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError(`chunkSize must be a positive integer, got ${chunkSize}`);
  }
  const maxTextBytes = options.maxTextBytes ?? IMPORT_LIMITS.textBytes;
  if (source.size === 0) throw emptyFileError(options.fileName);

  const head = new Uint8Array(await source.slice(0, HEADER_PROBE_BYTES).arrayBuffer());
  const gzipped = isGzip(head);
  if (!gzipped && source.size > maxTextBytes) {
    throw tooLargeError(options.fileName, "text", maxTextBytes);
  }
  const extension = baseExtension(options.fileName);

  let activeEncoding: StreamTextEncoding | undefined = options.encoding;
  let skipRows = 0;

  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- at most one UTF-8 -> windows-1252 retry
    const opened = await openDecodedStream(source, {
      fileName: options.fileName,
      extension,
      gzipped,
      maxTextBytes,
      forcedEncoding: activeEncoding,
    });
    if (opened.kind === "workbook") {
      throw unreadableWorkbookError(options.fileName);
    }

    const stream = opened.stream;
    let rawHeaders: (string | null)[] | null = null;
    let activeWidth = options.columns?.length ?? 0;
    let currentColumns: string[] = [];
    let buffered: (string | null)[][] = [];
    let rowsRead = 0;
    let yieldedRows = 0;
    let yieldedHadNonAscii = false;

    const parser = createRowParser(options.delimiter, (cells) => {
      if (rawHeaders === null) {
        rawHeaders = cells.map((cell) => (cell === null ? null : cell.trim()));
        const headerWidth = activeRowWidth(rawHeaders);
        if (headerWidth > activeWidth) activeWidth = headerWidth;
        currentColumns = columnsForWidth(rawHeaders, activeWidth);
        return;
      }
      rowsRead += 1;
      if (rowsRead <= skipRows) return;
      const rowWidth = activeRowWidth(cells);
      if (rowWidth > activeWidth) {
        activeWidth = rowWidth;
        currentColumns = columnsForWidth(rawHeaders, activeWidth);
      }
      buffered.push(cells);
    });

    const flushBuffer = (): RawRow[] => {
      const cols = currentColumns;
      const out = buffered.map((cells) => toRawRow(cols, cells));
      buffered = [];
      return out;
    };

    let restartAsWindows1252 = false;
    try {
      for (;;) {
        if (options.isSuperseded?.() === true) {
          return stream.encoding;
        }
        // oxlint-disable-next-line no-await-in-loop -- streaming chunks in order
        const piece = await stream.next();
        if (piece === null) {
          parser.end();
          break;
        }
        parser.feed(piece);

        while (buffered.length >= chunkSize) {
          const cols = currentColumns;
          const slice = buffered.slice(0, chunkSize);
          buffered = buffered.slice(chunkSize);
          const rows = slice.map((cells) => toRawRow(cols, cells));
          yieldedRows += rows.length;
          if (stream.sawNonAscii()) yieldedHadNonAscii = true;
          options.onProgress?.({
            bytesRead: stream.bytesRead(),
            totalBytes: source.size,
            rowsRead: yieldedRows + skipRows,
          });
          yield rows;
          if (options.isSuperseded?.() === true) {
            return stream.encoding;
          }
        }
      }

      if (rawHeaders === null) throw emptyFileError(options.fileName);
      if (rowsRead === 0) throw noRowsError(options.fileName);

      if (buffered.length > 0) {
        const rows = flushBuffer();
        yieldedRows += rows.length;
        options.onProgress?.({
          bytesRead: stream.bytesRead(),
          totalBytes: source.size,
          rowsRead: yieldedRows + skipRows,
        });
        yield rows;
      } else {
        options.onProgress?.({
          bytesRead: stream.bytesRead(),
          totalBytes: source.size,
          rowsRead,
        });
      }
      return stream.encoding;
    } catch (error) {
      if (error instanceof Utf8DecodeFallbackError && stream.encoding === "utf-8") {
        restartAsWindows1252 = true;
      } else {
        throw error;
      }
    } finally {
      // oxlint-disable-next-line no-await-in-loop -- closing the stream before optional windows-1252 retry
      await stream.close();
    }

    if (restartAsWindows1252) {
      activeEncoding = "windows-1252";
      if (yieldedRows > 0 && yieldedHadNonAscii && options.onRestart !== undefined) {
        // Non-ASCII UTF-8 rows were already emitted and may decode differently in Windows-1252.
        skipRows = 0;
        options.onRestart("windows-1252");
      } else {
        // Earlier yielded chunks were pure ASCII (identical in Windows-1252) or no rows were yielded yet.
        skipRows += yieldedRows;
      }
    }
  }
}

/**
 * Streams only one column of a delimited `Blob` and stops as soon as
 * `limit + 1` distinct trimmed non-blank values are found (matching
 * `distinctValues` in `@/domain/build/suggestions`).
 */
export async function streamDistinctValues(
  source: Blob,
  options: StreamDistinctValuesOptions,
): Promise<StreamDistinctValuesResult> {
  const limit = options.limit ?? DEFAULT_DISTINCT_LIMIT;
  const maxTextBytes = options.maxTextBytes ?? IMPORT_LIMITS.textBytes;
  if (source.size === 0) return { values: [], truncated: false };

  const head = new Uint8Array(await source.slice(0, HEADER_PROBE_BYTES).arrayBuffer());
  const gzipped = isGzip(head);
  if (!gzipped && source.size > maxTextBytes) {
    throw tooLargeError(options.fileName, "text", maxTextBytes);
  }
  const extension = baseExtension(options.fileName);

  const run = async (forcedEncoding?: StreamTextEncoding): Promise<StreamDistinctValuesResult> => {
    const opened = await openDecodedStream(source, {
      fileName: options.fileName,
      extension,
      gzipped,
      maxTextBytes,
      forcedEncoding,
    });
    if (opened.kind === "workbook") return { values: [], truncated: false };

    const stream = opened.stream;
    try {
      const state: {
        rawHeaders: (string | null)[] | null;
        activeWidth: number;
        targetIndex: number;
        truncated: boolean;
      } = {
        rawHeaders: null,
        activeWidth: 0,
        targetIndex: -1,
        truncated: false,
      };
      const seen = new Set<string>();

      const parser = createRowParser(options.delimiter, (cells) => {
        if (state.truncated) return;
        if (state.rawHeaders === null) {
          state.rawHeaders = cells.map((cell) => (cell === null ? null : cell.trim()));
          state.activeWidth = activeRowWidth(state.rawHeaders);
          state.targetIndex = columnsForWidth(state.rawHeaders, state.activeWidth).indexOf(
            options.column,
          );
          return;
        }
        if (state.targetIndex < 0) {
          const rowWidth = activeRowWidth(cells);
          if (rowWidth > state.activeWidth) {
            state.activeWidth = rowWidth;
            state.targetIndex = columnsForWidth(state.rawHeaders, state.activeWidth).indexOf(
              options.column,
            );
          }
          if (state.targetIndex < 0) return;
        }
        const rawCell = cells[state.targetIndex];
        if (rawCell === null || rawCell === undefined) return;
        const value = rawCell.trim();
        if (value === "" || seen.has(value)) return;
        if (seen.size >= limit) {
          state.truncated = true;
          return;
        }
        seen.add(value);
      });

      while (!state.truncated) {
        if (options.isSuperseded?.() === true) break;
        // oxlint-disable-next-line no-await-in-loop -- streaming chunks in order
        const piece = await stream.next();
        if (piece === null) {
          parser.end();
          break;
        }
        parser.feed(piece);
      }

      return { values: [...seen], truncated: state.truncated };
    } finally {
      await stream.close();
    }
  };

  try {
    return await run(options.encoding);
  } catch (error) {
    if (error instanceof Utf8DecodeFallbackError) {
      return run("windows-1252");
    }
    throw error;
  }
}
