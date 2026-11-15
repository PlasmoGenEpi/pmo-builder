import { plural, t } from "@lingui/core/macro";
import { useMemo, useState } from "react";

import { Callout, DataTable, Disclosure, Skeleton, formatCount } from "@/ui";

import type { ColumnMatching } from "./useColumnMatching";

/** Whether the screen is wide enough to show the preview open at first. */
function isWideScreen(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(min-width: 64rem)").matches;
}

/** "First 50 of 1,200 rows", or "12 rows" when every row is shown. */
function previewSummary(preview: {
  readonly rows: readonly unknown[];
  readonly totalRows: number;
}): string {
  const rowCount = preview.totalRows;
  const shownRows = formatCount(preview.rows.length);
  const totalRows = formatCount(rowCount);
  return rowCount > preview.rows.length
    ? plural(rowCount, {
        one: `First ${shownRows} of ${totalRows} row`,
        other: `First ${shownRows} of ${totalRows} rows`,
      })
    : plural(rowCount, { one: `${totalRows} row`, other: `${totalRows} rows` });
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
export function TablePreviewPanel({ matching, label: tableName }: TablePreviewPanelProps) {
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

  const summary = preview?.kind === "ready" ? previewSummary(preview) : undefined;
  const rowSummary = summary ?? "";

  return (
    <Disclosure
      title={t({ message: "Preview", comment: "Noun: the first rows of the table" })}
      summary={summary}
      defaultOpen={defaultOpen}
    >
      {preview === null || preview.kind === "loading" ? (
        <output
          className="flex flex-col gap-2"
          aria-busy="true"
          aria-label={t`Loading the preview`}
        >
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-48 w-full" />
        </output>
      ) : preview.kind === "ready" ? (
        <DataTable
          label={t({
            message: `Preview of “${tableName}”`,
            comment:
              "{tableName} is the table's name as shown in its heading, such as Allele table",
          })}
          columns={preview.columns}
          rows={preview.rows}
          totalRows={preview.totalRows}
          highlightedColumns={highlights}
          height="sm"
          caption={t`${rowSummary}. Highlighted columns are matched to a field.`}
        />
      ) : (
        <Callout tone="warning" title={t`The preview could not be shown`}>
          {preview.kind === "failed"
            ? preview.message
            : t`The file is no longer loaded. Import it again.`}
        </Callout>
      )}
    </Disclosure>
  );
}
