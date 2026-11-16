import { plural, t } from "@lingui/core/macro";
import { Download, FileArchive } from "lucide-react";
import { useState } from "react";

import type {
  TableFormat,
  TableId,
  TableInfo,
  WorkingPmoResult,
  WorkingSource,
} from "@/domain/tools/types";
import { saveFile } from "@/features/review/saveFile";
import { useWorkingPmoSession } from "@/state";
import { Button, SegmentedControl } from "@/ui";

import { NoAnswer } from "./NoAnswer";

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

/** Why the last download gave no file. */
type Problem =
  | { readonly kind: "not-open" }
  | { readonly kind: "no-subset" }
  /** Making the file failed: one table's, or the zip of all of them. */
  | { readonly kind: "failed"; readonly target: TableId | "all" };

/** Props for {@link TablesPanel}. */
export interface TablesPanelProps {
  readonly tables: readonly TableInfo[];
  /** The tables of the subset, when one has been made. */
  readonly subsetTables: readonly TableInfo[] | null;
  /** Which PMO's tables to list and download. */
  readonly source: WorkingSource;
}

/** The tables in a PMO, each to download as CSV or TSV. */
export function TablesPanel({ tables, subsetTables, source }: TablesPanelProps) {
  const session = useWorkingPmoSession();
  const [format, setFormat] = useState<TableFormat>("csv");
  const [saving, setSaving] = useState<TableId | "all" | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const shown = source === "subset" && subsetTables !== null ? subsetTables : tables;
  const failed = problem?.kind === "failed" ? problem.target : null;

  /** Saves what `answer` holds, or records why it holds nothing. A stale answer is ignored. */
  function settle<T>({
    target,
    answer,
    save,
  }: {
    readonly target: TableId | "all";
    readonly answer: WorkingPmoResult<T>;
    readonly save: (value: T) => void;
  }): void {
    setSaving(null);
    switch (answer.kind) {
      case "ok":
        save(answer.value);
        return;
      case "failed":
        setProblem({ kind: "failed", target });
        return;
      case "not-open":
      case "no-subset":
        setProblem({ kind: answer.kind });
        return;
      case "stale":
        return;
      default:
        return;
    }
  }

  async function download(id: TableId): Promise<void> {
    setSaving(id);
    setProblem(null);
    const answer = await session.query({ kind: "table", source, id, format });
    settle({
      target: id,
      answer,
      save: (file) => {
        const type = format === "csv" ? "text/csv" : "text/tab-separated-values";
        saveFile(new Blob([file.text], { type: `${type};charset=utf-8` }), file.fileName);
      },
    });
  }

  async function downloadAll(): Promise<void> {
    setSaving("all");
    setProblem(null);
    const answer = await session.query({ kind: "tables", source, format });
    settle({
      target: "all",
      answer,
      save: (archive) => saveFile(archive.blob, archive.fileName),
    });
  }

  return (
    <div className="flex flex-col gap-6">
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
          reason={problem.kind}
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
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {shown.map((table) => {
          const { title, body } = describe(table.id);
          const rows = table.rows;
          return (
            <li
              key={table.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-0.5">
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
              <Button
                size="sm"
                variant="secondary"
                icon={Download}
                loading={saving === table.id}
                className="shrink-0 self-start sm:self-center"
                aria-label={t`Download ${title} as ${format}`}
                onClick={() => void download(table.id)}
              >
                {t`Download`}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
