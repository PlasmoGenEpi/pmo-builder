import { plural, t } from "@lingui/core/macro";
import { ChevronDown, ChevronUp, Download, FileArchive } from "lucide-react";
import { useId, useMemo, useState } from "react";

import {
  TABLE_PREVIEW_LIMIT,
  type TableFormat,
  type TableId,
  type TableInfo,
  type TablePreviewCell,
  type WorkingPmoQuery,
  type WorkingSource,
} from "@/domain/tools/types";
import { saveFile } from "@/features/review/saveFile";
import { usePmoQuery, usePmoSession } from "@/state";
import { Button, DataTable, SegmentedControl, Spinner, formatCount, type CellValue } from "@/ui";

import { NoAnswer, type NoAnswerReason } from "./NoAnswer";
import { settleAnswer } from "./settleAnswer";

/** What each table is called and holds. */
function describe(id: TableId): { readonly title: string; readonly body: string } {
  switch (id) {
    case "alleles":
      return {
        title: t`Allele table`,
        body: t`One row per microhaplotype found in each library sample: the sample, the target, the sequence, the run and the reads.`,
      };
    case "specimens":
      return { title: t`Specimens`, body: t`One row per specimen, with its metadata.` };
    case "librarySamples":
      return {
        title: t`Library samples`,
        body: t`One row per library sample, with its specimen, panel and sequencing run.`,
      };
    case "targets":
      return { title: t`Targets`, body: t`One row per target, with its primers and location.` };
    case "panels":
      return { title: t`Panels`, body: t`One row per target of each panel, with its reactions.` };
    case "readCounts":
      return {
        title: t`Read counts by stage`,
        body: t`One row per library sample, target and pipeline stage, with total raw reads.`,
      };
    case "travel":
      return { title: t`Travel`, body: t`One row per trip a specimen's host made.` };
    case "projects":
      return { title: t`Projects`, body: t`One row per project.` };
    case "sequencing":
      return { title: t`Sequencing runs`, body: t`One row per sequencing run.` };
    case "bioinformaticsRuns":
      return { title: t`Bioinformatics runs`, body: t`One row per bioinformatics run.` };
    case "bioinformaticsMethods":
      return {
        title: t`Bioinformatics methods`,
        body: t`One row per program of each bioinformatics method.`,
      };
    case "genomes":
      return { title: t`Reference genomes`, body: t`One row per reference genome.` };
    case "header":
      return { title: t`File header`, body: t`The PMO version and how the file was made.` };
    default:
      return { title: id, body: "" };
  }
}

/** Why the last download gave no file, and which it was: one table, or the zip of all of them. */
interface Problem {
  readonly reason: NoAnswerReason;
  readonly target: TableId | "all";
}

/** Props for {@link TablePreviewSection}. */
interface TablePreviewSectionProps {
  readonly id: TableId;
  readonly title: string;
  readonly source: WorkingSource;
}

/** Formats a table preview cell to match pmotools-ts's `formatDelimited` output. */
function previewCell(value: TablePreviewCell | undefined): CellValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? "True" : "False";
  return value;
}

/** Loads and shows the first rows of one table when its preview is open. */
function TablePreviewSection({ id, title, source }: TablePreviewSectionProps) {
  const request = useMemo<WorkingPmoQuery<"tablePreview">>(
    () => ({ kind: "tablePreview", source, id, limit: TABLE_PREVIEW_LIMIT }),
    [source, id],
  );
  const answer = usePmoQuery(request);

  const recordRows = useMemo<readonly Readonly<Record<string, CellValue>>[]>(() => {
    if (answer.kind !== "ok") return [];
    const { columns, rows } = answer.value;
    return rows.map((row) =>
      Object.fromEntries(columns.map((column, index) => [column, previewCell(row[index])])),
    );
  }, [answer]);

  if (answer.kind === "loading") {
    return (
      <output className="flex items-center gap-2 py-2 text-sm text-text-muted">
        <Spinner size="sm" label={null} />
        <span>{t`Loading preview`}</span>
      </output>
    );
  }

  if (answer.kind !== "ok") {
    return (
      <NoAnswer
        reason={answer.kind}
        notOpen={t`Open a PMO file to preview its tables.`}
        noSubset={t`Make one on the Subset tab. Until then, only the original's tables can be previewed.`}
        failed={{
          title: t`The preview could not be loaded`,
          body: t`Close and open the preview again. If it fails again, open the file again.`,
        }}
      />
    );
  }

  const { columns, rows, totalRows } = answer.value;
  const total = totalRows;
  const shownCount = formatCount(rows.length);
  const totalCount = formatCount(total);
  const caption = plural(total, {
    one: `Showing ${shownCount} of ${totalCount} row`,
    other: `Showing ${shownCount} of ${totalCount} rows`,
  });

  return (
    <DataTable
      label={t({
        message: `Preview of ${title}`,
        comment: "{title} is a table name such as Allele table",
      })}
      columns={columns}
      rows={recordRows}
      totalRows={totalRows}
      caption={caption}
      height="sm"
    />
  );
}

/** Props for {@link TablesPanel}. */
export interface TablesPanelProps {
  readonly tables: readonly TableInfo[];
  /** The tables of the subset, when one has been made. */
  readonly subsetTables: readonly TableInfo[] | null;
  /** Which PMO's tables to list and download. */
  readonly source: WorkingSource;
}

/** The tables in a PMO, each to preview or download as CSV or TSV. */
export function TablesPanel({ tables, subsetTables, source }: TablesPanelProps) {
  const session = usePmoSession();
  const idPrefix = useId();
  const [format, setFormat] = useState<TableFormat>("csv");
  const [saving, setSaving] = useState<TableId | "all" | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [openPreviews, setOpenPreviews] = useState<ReadonlySet<TableId>>(() => new Set());
  const shown = source === "subset" && subsetTables !== null ? subsetTables : tables;
  const failed = problem?.reason === "failed" ? problem.target : null;

  function togglePreview(id: TableId): void {
    setOpenPreviews((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function download(id: TableId): Promise<void> {
    setSaving(id);
    setProblem(null);
    const answer = await session.query({ kind: "table", source, id, format });
    setSaving(null);
    settleAnswer(answer, {
      ok: (file) => {
        const type = format === "csv" ? "text/csv" : "text/tab-separated-values";
        saveFile(new Blob([file.text], { type: `${type};charset=utf-8` }), file.fileName);
      },
      none: (reason) => setProblem({ reason, target: id }),
    });
  }

  async function downloadAll(): Promise<void> {
    setSaving("all");
    setProblem(null);
    const answer = await session.query({ kind: "tables", source, format });
    setSaving(null);
    settleAnswer(answer, {
      ok: (archive) => saveFile(archive.blob, archive.fileName),
      none: (reason) => setProblem({ reason, target: "all" }),
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <SegmentedControl<TableFormat>
          label={t`File type`}
          value={format}
          onValueChange={setFormat}
          segments={[
            { value: "csv", label: t`CSV` },
            { value: "tsv", label: t`TSV` },
          ]}
        />
        <Button
          variant="primary"
          icon={FileArchive}
          className="sm:ml-auto"
          loading={saving === "all"}
          onClick={() => void downloadAll()}
        >
          {t`Download all tables (.zip)`}
        </Button>
      </div>
      {problem === null ? null : (
        <NoAnswer
          reason={problem.reason}
          notOpen={t`Open a PMO file to download its tables.`}
          noSubset={t`Make one on the Subset tab. Until then, only the original's tables can be downloaded.`}
          // A failure is shown beside the table it concerns.
          failed={null}
        />
      )}
      {failed === "all" ? (
        <p role="alert" className="text-sm text-danger-text">
          {t`The tables could not be made. Open the file again.`}
        </p>
      ) : null}
      <ul className="flex min-w-0 flex-col divide-y divide-border rounded-lg border border-border">
        {shown.map((table) => {
          const { title, body } = describe(table.id);
          const rows = table.rows;
          const isOpen = openPreviews.has(table.id);
          const panelId = `${idPrefix}-${table.id}`;
          return (
            <li key={table.id} className="flex min-w-0 flex-col gap-3 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium text-text">{title}</span>
                  <span className="text-sm text-text-muted">{body}</span>
                  <span className="text-sm text-text-subtle">
                    {plural(rows, { one: "# row", other: "# rows" })}
                  </span>
                  {failed === table.id ? (
                    <span role="alert" className="text-sm text-danger-text">
                      {t`The table could not be made. Open the file again.`}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-center">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={isOpen ? ChevronUp : ChevronDown}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    aria-label={isOpen ? t`Hide preview of ${title}` : t`Preview ${title}`}
                    onClick={() => togglePreview(table.id)}
                  >
                    {isOpen
                      ? t`Hide preview`
                      : t({
                          message: "Preview",
                          context: "verb",
                          comment: "Verb: open a preview of a table's first rows",
                        })}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Download}
                    loading={saving === table.id}
                    aria-label={t`Download ${title} as ${format}`}
                    onClick={() => void download(table.id)}
                  >
                    {t`Download`}
                  </Button>
                </div>
              </div>
              <div id={panelId} hidden={!isOpen} className="min-w-0">
                {isOpen ? (
                  <TablePreviewSection id={table.id} title={title} source={source} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
