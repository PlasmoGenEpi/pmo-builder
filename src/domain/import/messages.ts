/**
 * Why an import failed, in a form that crosses the worker boundary, and a
 * plain message for each reason that says what to do.
 *
 * This module imports only Lingui and the interface language at run time, so
 * the interface can import it directly (`@/domain/import/messages`) without
 * loading the import code or pmotools-ts on the main thread.
 */
import { t } from "@lingui/core/macro";

import { intlLocale } from "@/i18n/languages";

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
  const size = new Intl.NumberFormat(intlLocale()).format(Math.round(bytes / (1024 * 1024)));
  return `${size} MB`;
}

/**
 * A plain message for an import failure, naming the file once when its name
 * is given, and saying what to do.
 */
export function importFailureMessage(failure: ImportFailure, fileName?: string): string {
  const named = fileName !== undefined && fileName !== "";
  const file = fileName ?? "";
  switch (failure.code) {
    case "empty-file":
      return named
        ? t`"${file}" is empty. Choose a file with a header row and at least one row of data.`
        : t`This file is empty. Choose a file with a header row and at least one row of data.`;
    case "no-rows":
      return named
        ? t`"${file}" has a header row but no rows of data. Add the data below the header, or choose another file.`
        : t`This file has a header row but no rows of data. Add the data below the header, or choose another file.`;
    case "unsupported-type":
      if (failure.detail.kind === "legacy-excel") {
        return named
          ? t`"${file}" is an old Excel file (.xls), which cannot be read. Open it in Excel, choose Save As, pick Excel Workbook (.xlsx), and add that file.`
          : t`This file is an old Excel file (.xls), which cannot be read. Open it in Excel, choose Save As, pick Excel Workbook (.xlsx), and add that file.`;
      }
      return named
        ? t`"${file}" is not a type of file that can be read. Choose a .csv, .tsv, .txt or .xlsx file. A .gz of a text file also works.`
        : t`This file is not a type of file that can be read. Choose a .csv, .tsv, .txt or .xlsx file. A .gz of a text file also works.`;
    case "unreadable-file":
      return named
        ? t`"${file}" looks compressed but could not be unpacked, so it may be damaged or incomplete. Download or copy it again, or add it uncompressed.`
        : t`This file looks compressed but could not be unpacked, so it may be damaged or incomplete. Download or copy it again, or add it uncompressed.`;
    case "unreadable-workbook":
      return named
        ? t`"${file}" could not be read as an Excel workbook, so it may be damaged. Open it in Excel, save it again as .xlsx, and add that file.`
        : t`This file could not be read as an Excel workbook, so it may be damaged. Open it in Excel, save it again as .xlsx, and add that file.`;
    case "missing-sheet":
      return named
        ? t`That sheet is not in "${file}" any more. Choose another sheet, or add the file again.`
        : t`That sheet is not in this file any more. Choose another sheet, or add the file again.`;
    case "too-large": {
      if (failure.detail.kind === "too-large" && failure.detail.measure === "workbook") {
        const limit = megabytes(failure.detail.limitBytes);
        return named
          ? t({
              message: `"${file}" is a workbook over ${limit}, too large to open in the browser. Save the sheet as a .csv or .tsv file and add that instead.`,
              comment: "{limit} is a size, such as '50 MB'.",
            })
          : t({
              message: `This file is a workbook over ${limit}, too large to open in the browser. Save the sheet as a .csv or .tsv file and add that instead.`,
              comment: "{limit} is a size, such as '50 MB'.",
            });
      }
      if (failure.detail.kind === "too-large") {
        const limit = megabytes(failure.detail.limitBytes);
        return named
          ? t({
              message: `"${file}" is too large to open in the browser (the limit is ${limit} of text). Split it into smaller files, or remove columns you do not need, and try again.`,
              comment: "{limit} is a size, such as '200 MB'.",
            })
          : t({
              message: `This file is too large to open in the browser (the limit is ${limit} of text). Split it into smaller files, or remove columns you do not need, and try again.`,
              comment: "{limit} is a size, such as '200 MB'.",
            });
      }
      return named
        ? t`"${file}" is too large to open in the browser. Split it into smaller files, or remove columns you do not need, and try again.`
        : t`This file is too large to open in the browser. Split it into smaller files, or remove columns you do not need, and try again.`;
    }
    case "not-loaded":
      return t`That file is no longer loaded. Add it again.`;
    case "engine-stopped":
      return named
        ? t`The app stopped while reading "${file}", probably because it needed more memory than the browser allows. Try a smaller file, or close other tabs and try again.`
        : t`The app stopped while reading the file, probably because it needed more memory than the browser allows. Try a smaller file, or close other tabs and try again.`;
    case "unexpected":
      return named
        ? t`"${file}" could not be read. Check that it is a table saved as .csv, .tsv, .txt or .xlsx, and try again.`
        : t`This file could not be read. Check that it is a table saved as .csv, .tsv, .txt or .xlsx, and try again.`;
    default:
      return named ? t`"${file}" could not be read.` : t`This file could not be read.`;
  }
}
