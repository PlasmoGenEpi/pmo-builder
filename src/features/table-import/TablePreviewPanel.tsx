import { useMemo, useState } from "react";

import { Callout, DataTable, Disclosure, Skeleton, formatCount } from "@/ui";

import type { ColumnMatching } from "./useColumnMatching";

/** Whether the screen is wide enough to show the preview open at first. */
function isWideScreen(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(min-width: 64rem)").matches;
}

/** Props for {@link TablePreviewPanel}. */
export interface TablePreviewPanelProps {
  /** From `useColumnMatching(slot)`. */
  readonly matching: ColumnMatching;
  /** What the table is called, such as "Allele table". Used in the accessible name. */
  readonly label: string;
}

/**
 * The first rows of the table, with the matched columns highlighted and
 * labelled with their field. Open at first on wide screens.
 */
export function TablePreviewPanel({ matching, label }: TablePreviewPanelProps) {
  const [defaultOpen] = useState(isWideScreen);
  const { preview, fieldSet, mapped } = matching;
  const highlights = useMemo(() => {
    const result: Record<string, string> = {};
    for (const field of fieldSet.fields) {
      const column = mapped.mapping.fields[field.key];
      if (column !== null && column !== undefined) {
        result[column] =
          result[column] === undefined ? field.label : `${result[column]}, ${field.label}`;
      }
    }
    return result;
  }, [fieldSet, mapped.mapping]);

  const summary =
    preview?.kind === "ready"
      ? preview.totalRows > preview.rows.length
        ? `First ${formatCount(preview.rows.length)} of ${formatCount(preview.totalRows)} rows`
        : `${formatCount(preview.totalRows)} ${preview.totalRows === 1 ? "row" : "rows"}`
      : undefined;

  return (
    <Disclosure title="Preview" summary={summary} defaultOpen={defaultOpen}>
      {preview === null || preview.kind === "loading" ? (
        <output className="flex flex-col gap-2" aria-busy="true" aria-label="Loading the preview">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-48 w-full" />
        </output>
      ) : preview.kind === "ready" ? (
        <DataTable
          label={`Preview of the ${label.toLowerCase()}`}
          columns={preview.columns}
          rows={preview.rows}
          totalRows={preview.totalRows}
          highlightedColumns={highlights}
          height="sm"
          caption={`${summary ?? ""}. Highlighted columns are matched to a field.`}
        />
      ) : (
        <Callout tone="warning" title="The preview could not be shown">
          {preview.kind === "failed"
            ? preview.message
            : "The file is no longer loaded. Import it again."}
        </Callout>
      )}
    </Disclosure>
  );
}
