import type * as ReadExcelFile from "read-excel-file/universal";

import { ImportError } from "./errors";
import type { GridCell } from "./rawTable";

/** One worksheet as text cells. */
export interface WorkbookSheet {
  readonly name: string;
  readonly rows: readonly (readonly GridCell[])[];
}

/** The part of `read-excel-file` this module uses. */
type ExcelModule = typeof ReadExcelFile;

/**
 * Loads the workbook reader in its own chunk.
 *
 * `read-excel-file/universal` is the one entry point that runs unchanged in a
 * browser, a web worker and Node: it reads a `Blob` or `ArrayBuffer`, unzips
 * with `fflate` and spawns no workers of its own. The `/browser` and
 * `/web-worker` entries need `Worker` (absent in Node), and `/node` pulls in
 * Node streams (absent in a browser), so neither works in both places.
 */
function loadExcelModule(): Promise<ExcelModule> {
  return import("read-excel-file/universal");
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * Writes a cell date the way a careful CSV export would: `YYYY-MM-DD`, with
 * ` HH:MM:SS` (and milliseconds when present) only when the time is not
 * midnight. Workbook dates carry no time zone; the reader returns them as UTC.
 */
export function formatExcelDate(date: Date): string {
  const day = `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const milliseconds = date.getUTCMilliseconds();
  if (hours === 0 && minutes === 0 && seconds === 0 && milliseconds === 0) return day;
  const time = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return milliseconds === 0 ? `${day} ${time}` : `${day} ${time}.${pad(milliseconds, 3)}`;
}

/**
 * Converts one workbook cell to text: numbers in their shortest exact form
 * (`12`, `0.1`), dates as {@link formatExcelDate}, booleans as `TRUE` or
 * `FALSE`, text unchanged, and blanks as `null`.
 */
export function excelCellToText(value: unknown): GridCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : formatExcelDate(value);
  return null;
}

function unreadable(fileName: string, cause: unknown): ImportError {
  return new ImportError(
    "unreadable-workbook",
    `${fileName} could not be read as an Excel workbook. Open it in Excel, save it as .xlsx, and try again.`,
    { cause },
  );
}

/**
 * Reads every sheet of an `.xlsx` workbook as text cells.
 *
 * @throws {ImportError} `unsupported-type` for an `.xls` file,
 *   `unreadable-workbook` for anything else the reader rejects.
 */
export async function readWorkbook(source: Blob, fileName: string): Promise<WorkbookSheet[]> {
  let excel: ExcelModule;
  try {
    excel = await loadExcelModule();
  } catch (error) {
    throw unreadable(fileName, error);
  }
  try {
    const sheets = await excel.default(source, { trim: false });
    return sheets.map((sheet) => ({
      name: sheet.sheet,
      rows: sheet.data.map((row) => row.map((cell): GridCell => excelCellToText(cell))),
    }));
  } catch (error) {
    if (error instanceof excel.InvalidInputError && error.code === "XLS_FILE_NOT_SUPPORTED") {
      throw xlsNotSupported(fileName);
    }
    throw unreadable(fileName, error);
  }
}

/** The error for an old `.xls` workbook. */
export function xlsNotSupported(fileName: string): ImportError {
  return new ImportError(
    "unsupported-type",
    `${fileName} is an old Excel file (.xls), which cannot be read. Open it in Excel, save it as .xlsx, and upload that file.`,
    { detail: { kind: "legacy-excel" } },
  );
}
