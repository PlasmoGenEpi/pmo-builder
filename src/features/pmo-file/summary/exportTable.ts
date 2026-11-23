/**
 * Formats and downloads a table as CSV or TSV directly in the browser.
 * Does not import `pmotools-ts` so it stays light on the main thread.
 */
import type { TableFormat, WorkingSource } from "@/domain/tools/types";
import { saveFile } from "@/features/review/saveFile";

/** A single cell value written to a delimited table export. */
export type DelimitedCell = string | number | null;

/** Options for {@link formatDelimitedTable}. */
export interface FormatDelimitedTableOptions {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly DelimitedCell[])[];
  readonly format: TableFormat;
}

/** Options for {@link downloadDelimitedTable}. */
export interface DownloadDelimitedTableOptions extends FormatDelimitedTableOptions {
  /** File name without extension, such as `"study-summary-targets"`. */
  readonly fileName: string;
}

const PMO_EXTENSIONS = /(?:\.pmo)?\.json(?:\.gz)?$|\.gz$/i;

function formatCell(value: DelimitedCell, delimiter: string): string {
  if (value === null) return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  const text = String(value);
  if (
    text.includes(delimiter) ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r")
  ) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

/** Formats headings and rows as RFC 4180 CSV or TSV text with a trailing newline. */
export function formatDelimitedTable({
  headers,
  rows,
  format,
}: FormatDelimitedTableOptions): string {
  const delimiter = format === "tsv" ? "\t" : ",";
  const lines: string[] = [
    headers.map((heading) => formatCell(heading, delimiter)).join(delimiter),
  ];
  for (const row of rows) {
    lines.push(row.map((cell) => formatCell(cell, delimiter)).join(delimiter));
  }
  return `${lines.join("\n")}\n`;
}

/** Downloads headings and rows as a CSV or TSV file created in the browser. */
export function downloadDelimitedTable({
  headers,
  rows,
  fileName,
  format,
}: DownloadDelimitedTableOptions): void {
  const text = formatDelimitedTable({ headers, rows, format });
  const mime = format === "tsv" ? "text/tab-separated-values" : "text/csv";
  saveFile(new Blob([text], { type: `${mime};charset=utf-8` }), `${fileName}.${format}`);
}

/** Strips PMO extensions from `fileName` and appends `-subset` when working with a subset. */
export function pmoBaseName(fileName: string | null, source: WorkingSource = "original"): string {
  const stripped = (fileName?.trim() ?? "").replace(PMO_EXTENSIONS, "");
  const base = stripped === "" ? "pmo" : stripped;
  return source === "subset" ? `${base}-subset` : base;
}
