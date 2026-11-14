/**
 * Why an import failed, in a form that crosses the worker boundary, and a
 * plain message for each reason that says what to do.
 *
 * This module has no run-time imports, so the interface can import it
 * directly (`@/domain/import/messages`) without loading the import code or
 * pmotools-ts on the main thread.
 */
import type { ImportErrorCode, ImportErrorDetail } from "./errors";

/**
 * Why an import failed.
 *
 * - An {@link ImportErrorCode} with its detail: the file could not be read.
 * - `not-loaded`: the file is no longer held by the engine (choosing a sheet of a removed file).
 * - `engine-stopped`: the background worker stopped while reading, usually for lack of memory.
 * - `unexpected`: anything else.
 */
export type ImportFailure =
  | { readonly code: ImportErrorCode; readonly detail: ImportErrorDetail }
  | { readonly code: "not-loaded" | "engine-stopped" | "unexpected" };

/** Every reason an import can fail, for exhaustive checks. */
export type ImportFailureCode = ImportFailure["code"];

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * A plain message for an import failure, naming the file once when its name
 * is given, and saying what to do.
 */
export function importFailureMessage(failure: ImportFailure, fileName?: string): string {
  const file = fileName === undefined || fileName === "" ? "This file" : `"${fileName}"`;
  switch (failure.code) {
    case "empty-file":
      return `${file} is empty. Choose a file with a header row and at least one row of data.`;
    case "no-rows":
      return `${file} has a header row but no rows of data. Add the data below the header, or choose another file.`;
    case "unsupported-type":
      return failure.detail.kind === "legacy-excel"
        ? `${file} is an old Excel file (.xls), which cannot be read. Open it in Excel, choose Save As, pick Excel Workbook (.xlsx), and add that file.`
        : `${file} is not a type of file that can be read. Choose a .csv, .tsv, .txt or .xlsx file. A .gz of a text file also works.`;
    case "unreadable-file":
      return `${file} looks compressed but could not be unpacked, so it may be damaged or incomplete. Download or copy it again, or add it uncompressed.`;
    case "unreadable-workbook":
      return `${file} could not be read as an Excel workbook, so it may be damaged. Open it in Excel, save it again as .xlsx, and add that file.`;
    case "missing-sheet":
      return `That sheet is not in ${file === "This file" ? "this file" : file} any more. Choose another sheet, or add the file again.`;
    case "too-large":
      if (failure.detail.kind === "too-large" && failure.detail.measure === "workbook") {
        return `${file} is a workbook over ${megabytes(failure.detail.limitBytes)}, too large to open in the browser. Save the sheet as a .csv or .tsv file and add that instead.`;
      }
      return `${file} is too large to open in the browser${
        failure.detail.kind === "too-large"
          ? ` (the limit is ${megabytes(failure.detail.limitBytes)} of text)`
          : ""
      }. Split it into smaller files, or remove columns you do not need, and try again.`;
    case "not-loaded":
      return "That file is no longer loaded. Add it again.";
    case "engine-stopped":
      return `The app stopped while reading ${file === "This file" ? "the file" : file}, probably because it needed more memory than the browser allows. Try a smaller file, or close other tabs and try again.`;
    case "unexpected":
      return `${file} could not be read. Check that it is a table saved as .csv, .tsv, .txt or .xlsx, and try again.`;
    default:
      return `${file} could not be read.`;
  }
}
