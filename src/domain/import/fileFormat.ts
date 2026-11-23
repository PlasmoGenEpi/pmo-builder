/**
 * File extension checks and standard {@link ImportError} builders shared by
 * the whole-file and streaming readers.
 */
import { ImportError, formatLimitBytes } from "./errors";

/** Lower-case file extensions accepted as delimited text tables. */
export const DELIMITED_EXTENSIONS: ReadonlySet<string> = new Set(["csv", "tsv", "txt", "tab"]);

const GZIP_EXTENSIONS: ReadonlySet<string> = new Set(["gz", "gzip"]);

/** The file's extension, lower case, with a trailing `.gz` or `.gzip` taken off. */
export function baseExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  if (parts.length > 1 && GZIP_EXTENSIONS.has(parts.at(-1) ?? "")) parts.pop();
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

/** True when `fileName` has only a `.gz` or `.gzip` extension (such as `data.gz`). */
export function isGzipOnly(fileName: string): boolean {
  const parts = fileName.toLowerCase().split(".");
  return parts.length === 2 && GZIP_EXTENSIONS.has(parts[1] ?? "");
}

/** Error for a file extension that cannot be imported. */
export function unsupportedTypeError(fileName: string): ImportError {
  return new ImportError(
    "unsupported-type",
    `${fileName} is not a file type that can be read. Upload a .csv, .tsv, .txt or .xlsx file (a .gz of a text file also works).`,
  );
}

/** Error for an empty or whitespace-only file. */
export function emptyFileError(fileName: string): ImportError {
  return new ImportError(
    "empty-file",
    `${fileName} is empty. Choose a file that has a header row and data.`,
  );
}

/** Error for a file with a header row and no data rows. */
export function noRowsError(fileName: string): ImportError {
  return new ImportError(
    "no-rows",
    `${fileName} has a header row but no data rows. Add the data below the header and try again.`,
  );
}

/** Error for an `.xlsx` file that is not a valid ZIP workbook. */
export function unreadableWorkbookError(fileName: string): ImportError {
  return new ImportError(
    "unreadable-workbook",
    `${fileName} is not a valid Excel workbook. Open it in Excel, save it as .xlsx, and try again.`,
  );
}

/** Error for a gzipped file that failed decompression. */
export function unreadableGzipError(fileName: string, cause: unknown): ImportError {
  return new ImportError(
    "unreadable-file",
    `${fileName} looks compressed but could not be unpacked. Check that the file is complete, or upload it uncompressed.`,
    { cause },
  );
}

/** Input options for {@link tooLargeError}. */
export interface TooLargeErrorInput {
  readonly fileName: string;
  readonly measure: "text" | "workbook";
  readonly limitBytes: number;
}

/** Error for a text file or workbook that exceeds its byte limit. */
export function tooLargeError(input: TooLargeErrorInput): ImportError {
  const { fileName, measure, limitBytes } = input;
  return new ImportError(
    "too-large",
    measure === "text"
      ? `${fileName} is larger than ${formatLimitBytes(limitBytes)} of text, too large to open in the browser. Split it into smaller files, or remove columns you do not need, and try again.`
      : `${fileName} is a workbook larger than ${formatLimitBytes(limitBytes)}, too large to open in the browser. Save the sheet as a .csv or .tsv file and import that instead.`,
    { detail: { kind: "too-large", measure, limitBytes } },
  );
}
