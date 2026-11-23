/**
 * Why a file could not be read.
 *
 * - `empty-file`: the file holds nothing, or only blank lines.
 * - `no-rows`: the file has a header row but no data rows.
 * - `unsupported-type`: not a delimited text file or an `.xlsx` workbook (this includes `.xls`).
 * - `unreadable-file`: a compressed file that could not be unpacked.
 * - `unreadable-workbook`: the workbook is damaged or not really an `.xlsx` file.
 * - `missing-sheet`: the requested sheet is not in the workbook.
 * - `too-large`: the file is larger than the app can hold in memory (see {@link IMPORT_LIMITS}).
 */
export type ImportErrorCode =
  | "empty-file"
  | "no-rows"
  | "unsupported-type"
  | "unreadable-file"
  | "unreadable-workbook"
  | "missing-sheet"
  | "too-large";

/**
 * More about an {@link ImportError}, for wording the message.
 *
 * - `none`: the code says it all.
 * - `legacy-excel`: an `unsupported-type` error for an old `.xls` workbook.
 * - `too-large`: a `too-large` error, with the limit that was passed.
 */
export type ImportErrorDetail =
  | { readonly kind: "none" }
  | { readonly kind: "legacy-excel" }
  | {
      readonly kind: "too-large";
      /** What was limited: the text once unpacked, or the workbook file. */
      readonly measure: "text" | "workbook";
      readonly limitBytes: number;
    };

/**
 * The largest files the app reads. Beyond these the parsed table or the PMO
 * built from it needs more memory than a browser tab can count on (see
 * `scripts/bench-large-files.mjs`). The allele table is read in streaming
 * chunks, so it accepts much larger files than tables read into memory whole.
 */
export const IMPORT_LIMITS = {
  /** A delimited text file read into memory whole, measured after unpacking a `.gz`. */
  textBytes: 300 * 1024 * 1024,
  /** A streamed allele table (delimited text), measured after unpacking a `.gz`. */
  alleleTextBytes: 3 * 1024 * 1024 * 1024,
  /** An `.xlsx` workbook, measured as stored (it is compressed). */
  workbookBytes: 50 * 1024 * 1024,
} as const;

/**
 * A file that could not be read. `code` is stable and safe to count; `message`
 * is plain text for the user and may name the file or sheet.
 *
 * Custom properties do not survive `structuredClone`, so a worker should post
 * `{ code, message }` rather than the error itself.
 */
export class ImportError extends Error {
  override readonly name = "ImportError";
  readonly code: ImportErrorCode;
  /** More about the error, for wording it. `{ kind: "none" }` unless the code needs it. */
  readonly detail: ImportErrorDetail;

  constructor(
    code: ImportErrorCode,
    message: string,
    options?: { readonly cause?: unknown; readonly detail?: ImportErrorDetail },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.detail = options?.detail ?? { kind: "none" };
  }
}

/** True when `error` is an {@link ImportError}. */
export function isImportError(error: unknown): error is ImportError {
  return error instanceof ImportError;
}

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * BYTES_PER_MB;

/** Formats a size limit in GB (when at least 1 GB) or rounded MB, optionally using `locale`. */
export function formatLimitBytes(bytes: number, locale?: string): string {
  if (bytes >= BYTES_PER_GB) {
    const gb = bytes / BYTES_PER_GB;
    const value = Number.isInteger(gb) ? gb : Number(gb.toFixed(1));
    const size =
      locale === undefined
        ? String(value)
        : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
    return `${size} GB`;
  }
  const mb = Math.round(bytes / BYTES_PER_MB);
  const size = locale === undefined ? String(mb) : new Intl.NumberFormat(locale).format(mb);
  return `${size} MB`;
}
