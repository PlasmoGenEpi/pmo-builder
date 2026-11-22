/**
 * The microhaplotypes section: the allele table, built in chunks through
 * `createMhapTableBuilder` (synchronously from an in-memory table, or in two
 * streaming passes from a stored delimited `Blob`).
 */
import { plural, t } from "@lingui/core/macro";
import {
  PmoError,
  createColumnTyper,
  createMhapTableBuilder,
  isMissing,
  type ColumnTypes,
  type MhapTableToPmoOptions,
  type MhapTableToPmoResult,
  type PmoWarning,
  type Row,
} from "pmotools-ts";

import { mappedColumns, type MicrohaplotypesDraft } from "@/domain/draft";
import {
  importFailureMessage,
  isImportError,
  readBooleanCell,
  streamDelimitedChunks,
  type DelimitedStreamMeta,
  type StreamReadProgress,
  type StreamTextEncoding,
} from "@/domain/import";
import type {
  FieldSetSpec,
  FieldSpec,
  MappingProblem,
  Notice,
  RawRow,
  RawTable,
} from "@/domain/types";

import { DEFAULT_BUILD_DEPS, type BuildContext, type BuildDeps } from "./context";
import {
  MAX_ROW_SAMPLE,
  describeRowSample,
  errorNotice,
  makeNotice,
  mappingProblemNotice,
  quoteItems,
  warningNotice,
  type RowSample,
  type TableIssueContext,
} from "./notices";
import {
  notReady,
  ready,
  runBuilder,
  type MicrohaplotypesSummary,
  type SectionResult,
} from "./results";
import { resolveRunName, runNameStarted } from "./runName";
import {
  blankRequiredNotice,
  columnOptions,
  fileMissingNotice,
  fileUnreadableNotice,
  invalidBooleanNotice,
  prepareTable,
  typingFailedNotice,
  unknownKeysNotice,
} from "./table";

/** Builder options that name a column of the allele table. */
export const MHAP_COLUMN_OPTIONS = [
  "librarySampleNameCol",
  "targetNameCol",
  "seqCol",
  "readsCol",
  "umisCol",
  "chromCol",
  "startCol",
  "endCol",
  "refSeqCol",
  "strandCol",
  "altAnnotationsCol",
  "maskingSeqStartCol",
  "maskingSeqSegmentSizeCol",
  "maskingReplacementSizeCol",
  "microhaplotypeNameCol",
  "pseudocigarCol",
  "pseudocigarChromCol",
  "pseudocigarStartCol",
  "pseudocigarEndCol",
  "pseudocigarRefSeqCol",
  "pseudocigarStrandCol",
  "pseudocigarGenerationDescriptionCol",
  "qualityCol",
] as const satisfies readonly (keyof MhapTableToPmoOptions)[];

const TABLE_LABEL = t({
  message: "allele table",
  comment:
    "The table of microhaplotypes: a table name in lower case, used inside other messages, such as 'The allele table has no rows.' French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
});

/** Default number of rows fed to `createMhapTableBuilder` per chunk. */
export const DEFAULT_MHAP_CHUNK_SIZE = 50_000;

/** Most distinct values a column may hold to be offered as the run column. */
const MAX_RUN_VALUES = 50;

/** Most distinct run names gathered during Pass 1 for suggestions. */
const MAX_RUN_NAME_SUGGESTIONS = 200;

/** Per-(sample, target) allele count above which a `Set<number>` replaces `number[]`. */
const ALLELE_ARRAY_LIMIT = 32;

/** Minimum interval between progress callbacks during streaming passes. */
const PROGRESS_INTERVAL_MS = 100;

const TEXT_KINDS: ReadonlySet<string> = new Set(["text", "date", "list"]);

const INCOMPLETE_MAPPING_KINDS: ReadonlySet<MappingProblem["kind"]> = new Set([
  "missing-required",
  "incomplete-group",
]);

const ROW_LOOKUP_ERROR_CODES: ReadonlySet<string> = new Set([
  "mhap/missing-reads",
  "mhap/missing-run-name",
  "mhap/missing-seq",
  "mhap/invalid-masking",
]);

/** Progress reported while streaming and building the allele table. */
export interface MicrohaplotypesStreamProgress {
  readonly stage: "checking" | "building";
  readonly bytesRead: number;
  readonly totalBytes: number;
  readonly rowsRead: number;
}

/** Source state supplied to {@link buildMicrohaplotypesStream}. */
export type MicrohaplotypesStreamSource =
  | { readonly kind: "ready"; readonly blob: Blob; readonly meta: DelimitedStreamMeta }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly message: string };

/** Input options for {@link buildMicrohaplotypesStream}. */
export interface StreamMicrohaplotypesInput {
  readonly section: MicrohaplotypesDraft;
  readonly source: MicrohaplotypesStreamSource;
  readonly deps?: BuildDeps;
  /** Rows per chunk for streaming and `createMhapTableBuilder`. Defaults to {@link DEFAULT_MHAP_CHUNK_SIZE}. */
  readonly chunkSize?: number;
  /** Maximum unpacked text bytes. Defaults to `IMPORT_LIMITS.textBytes`. */
  readonly maxTextBytes?: number;
  /** Throttled progress updates across Pass 1 (`checking`) and Pass 2 (`building`). */
  readonly onProgress?: (progress: MicrohaplotypesStreamProgress) => void;
  /** Checked between chunks; returning `true` aborts cleanly with `{ kind: "superseded" }`. */
  readonly isSuperseded?: () => boolean;
}

/** What {@link buildMicrohaplotypesStream} returns. */
export type StreamMicrohaplotypesOutput =
  | { readonly kind: "superseded" }
  | {
      readonly kind: "done";
      readonly result: SectionResult<"microhaplotypes">;
      readonly totalRows: number;
      readonly runNameValues: readonly string[];
    };

function missingRepresentativeNotice(missingRepresentative: readonly string[]): Notice {
  const columnCount = missingRepresentative.length;
  const columns = quoteItems(missingRepresentative);
  return makeNotice(
    "error",
    "mapping/unknown-additional-column",
    plural(columnCount, {
      one: `The allele table has no column ${columns}, chosen to carry onto each microhaplotype. Untick it.`,
      other: `The allele table has no columns ${columns}, chosen to carry onto each microhaplotype. Untick them.`,
    }),
  );
}

/**
 * Builds the microhaplotypes section.
 *
 * - `empty`: no table and no run name.
 * - `incomplete`: no table, a required field unmapped, or a run name chosen but not given.
 * - `error`: a mapping or run name problem, or `createMhapTableBuilder` threw.
 */
export function buildMicrohaplotypes(
  section: MicrohaplotypesDraft,
  context: BuildContext,
): SectionResult<"microhaplotypes"> {
  const chunkSize = context.mhapChunkSize ?? DEFAULT_MHAP_CHUNK_SIZE;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError(`mhapChunkSize must be a positive integer, got ${chunkSize}`);
  }
  if (section.table === null) {
    return runNameStarted(section.runName) || section.representativeColumns.length > 0
      ? notReady("microhaplotypes", "incomplete", [
          makeNotice("error", "table/not-imported", t`Import the allele table.`),
        ])
      : notReady("microhaplotypes", "empty");
  }

  const runName = resolveRunName(section.runName, section.table.table.columns, TABLE_LABEL);
  const prepared = prepareTable(
    {
      mapped: section.table,
      fieldSetId: "microhaplotypes",
      tableLabel: TABLE_LABEL,
      extraTextColumns: [
        ...section.representativeColumns,
        ...(runName.kind === "ok" && runName.textColumn !== null ? [runName.textColumn] : []),
      ],
    },
    context,
  );
  if (prepared.kind === "blocked") {
    const notices =
      runName.kind === "blocked" ? [...prepared.notices, runName.notice] : prepared.notices;
    const status =
      runName.kind === "blocked" && runName.status === "error" ? "error" : prepared.status;
    return notReady("microhaplotypes", status, notices);
  }
  if (runName.kind === "blocked")
    return notReady("microhaplotypes", runName.status, [runName.notice]);

  const missingRepresentative = section.representativeColumns.filter(
    (c) => !prepared.raw.columns.includes(c),
  );
  if (missingRepresentative.length > 0) {
    return notReady("microhaplotypes", "error", [
      missingRepresentativeNotice(missingRepresentative),
    ]);
  }

  const repeated = repeatedRowsNotice(prepared.raw, prepared.columns, runName.textColumn);
  if (repeated !== null) return notReady("microhaplotypes", "error", [repeated]);

  const { options, unknownKeys } = columnOptions(prepared.columns, MHAP_COLUMN_OPTIONS);
  const representative = section.representativeColumns;
  const detected = prepared.additionalColumns.filter((column) => !representative.includes(column));
  const run = runBuilder(prepared.issues, (onWarning) => {
    const builder = createMhapTableBuilder({
      ...options,
      ...(runName.option === undefined ? {} : { bioinformaticsRunName: runName.option }),
      ...(representative.length > 0 ? { additionalRepresentativeMhapCols: representative } : {}),
      ...(detected.length > 0 ? { additionalMhapDetectedCols: detected } : {}),
      onWarning,
    });
    if (prepared.typed.length <= chunkSize) {
      builder.add(prepared.typed);
    } else {
      for (let offset = 0; offset < prepared.typed.length; offset += chunkSize) {
        builder.add(prepared.typed.slice(offset, offset + chunkSize));
      }
    }
    return builder.finish();
  });
  const notices = [...unknownKeysNotice(unknownKeys, TABLE_LABEL), ...run.notices];
  if (!run.ok) return notReady("microhaplotypes", "error", notices);
  return ready(
    "microhaplotypes",
    run.result,
    summarise(run.result, prepared.raw.rows.length),
    notices,
  );
}

function summarise(fragment: MhapTableToPmoResult, rows: number): MicrohaplotypesSummary {
  const samples = new Set<string>();
  const runNames: string[] = [];
  for (const run of fragment.detected_microhaplotypes) {
    for (const sample of run.library_samples) samples.add(sample.library_sample_name);
    if (run.bioinformatics_run_name !== undefined) runNames.push(run.bioinformatics_run_name);
  }
  const targets = fragment.representative_microhaplotypes.targets;
  return {
    rows,
    librarySamples: samples.size,
    targets: targets.length,
    microhaplotypes: targets.reduce((total, target) => total + target.microhaplotypes.length, 0),
    runNames,
  };
}

/** A raw cell, trimmed, with a missing cell as "". */
function cell(row: RawRow, column: string): string {
  return (row[column] ?? "").trim();
}

function formatRepeatedRowsNotice(input: {
  readonly sampleName: string;
  readonly targetName: string;
  readonly rows: RowSample;
  readonly runColumn: string | null;
  readonly runLike: string | undefined;
}): Notice {
  const { sampleName, targetName, rows, runColumn, runLike } = input;
  const rowCount = rows.count;
  const rowList = describeRowSample(rows);
  const repeatedText =
    runColumn === null
      ? t({
          message: plural(rowCount, {
            one: `# row repeats the sample, target and sequence of an earlier row: ${rowList} (sample "${sampleName}", target "${targetName}"), so their reads would be counted twice.`,
            other: `# rows repeat the sample, target and sequence of an earlier row: ${rowList} (such as sample "${sampleName}", target "${targetName}"), so their reads would be counted twice.`,
          }),
          comment: "{rowList} is such as 'rows 5 and 9'.",
        })
      : t({
          message: plural(rowCount, {
            one: `# row repeats the sample, target and sequence of an earlier row in the same run: ${rowList} (sample "${sampleName}", target "${targetName}"), so their reads would be counted twice.`,
            other: `# rows repeat the sample, target and sequence of an earlier row in the same run: ${rowList} (such as sample "${sampleName}", target "${targetName}"), so their reads would be counted twice.`,
          }),
          comment: "{rowList} is such as 'rows 5 and 9'.",
        });
  const cause =
    runColumn === null && runLike !== undefined
      ? t({
          message: `Column "${runLike}" tells them apart, so the table probably holds several analysis runs. Choose that column under "Bioinformatics run name".`,
          comment:
            '"Bioinformatics run name" is the label of a field on the page; use the same words as there.',
        })
      : runColumn === null
        ? t({
            message:
              'Remove the repeated rows. If the table holds several analysis runs, choose the column that names the run under "Bioinformatics run name".',
            comment:
              '"Bioinformatics run name" is the label of a field on the page; use the same words as there.',
          })
        : t`Remove the repeated rows.`;
  return makeNotice("error", "table/repeated-rows", `${repeatedText} ${cause}`);
}

/**
 * An error for rows that repeat the sample, target and sequence of an earlier
 * row in the same run, or `null`. The builder would list the allele twice and
 * count its reads twice. When some other column tells the repeats apart, the
 * table most likely holds several analysis runs and that column names them.
 */
function repeatedRowsNotice(
  raw: RawTable,
  columns: Readonly<Record<string, string>>,
  runColumn: string | null,
): Notice | null {
  const sample = columns["librarySampleName"];
  const target = columns["targetName"];
  const seq = columns["seq"];
  if (sample === undefined || target === undefined || seq === undefined) return null;
  // A row's key is the numbers of its trimmed cells, such as "3,0,12,7,": short
  // whatever the sequence length, so a large table's keys stay small.
  const numbers = new Map<string, Map<string, number>>();
  const numberOf = (row: RawRow, column: string | null): string => {
    if (column === null) return "";
    let known = numbers.get(column);
    if (known === undefined) {
      known = new Map();
      numbers.set(column, known);
    }
    const value = cell(row, column);
    let number = known.get(value);
    if (number === undefined) {
      number = known.size;
      known.set(value, number);
    }
    return String(number);
  };
  const repeats = (extra: string | null): number[] => {
    const seen = new Set<string>();
    const found: number[] = [];
    raw.rows.forEach((row, index) => {
      const key = [runColumn, sample, target, seq, extra]
        .map((column) => numberOf(row, column))
        .join(",");
      if (seen.has(key)) found.push(index);
      else seen.add(key);
    });
    return found;
  };
  const rows = repeats(null);
  const [first] = rows;
  if (first === undefined) return null;
  const firstRow = raw.rows[first] ?? {};
  const sampleName = cell(firstRow, sample);
  const targetName = cell(firstRow, target);
  const used = new Set([...Object.values(columns), ...(runColumn === null ? [] : [runColumn])]);
  const runLike = raw.columns.find((column) => {
    if (used.has(column)) return false;
    const values = new Set(raw.rows.map((row) => cell(row, column)));
    return values.size > 1 && values.size <= MAX_RUN_VALUES && repeats(column).length === 0;
  });
  return formatRepeatedRowsNotice({
    sampleName,
    targetName,
    rows: { first: rows.slice(0, MAX_ROW_SAMPLE), count: rows.length },
    runColumn,
    runLike,
  });
}

// ---------------------------------------------------------------------------
// Two-pass streaming builder
// ---------------------------------------------------------------------------

type SeqStore = number | number[] | Set<number>;

interface MutableRowSample {
  readonly first: number[];
  count: number;
}

function recordRowSample(sample: MutableRowSample, rowIndex: number): void {
  sample.count += 1;
  if (sample.first.length < MAX_ROW_SAMPLE) sample.first.push(rowIndex);
}

/** Compact integer-indexed `(run, sample, target, seq)` duplicate detector. */
interface CompactRepeatTracker {
  /** Records a row; returns `true` if `(run, sample, target, seq)` was already seen. */
  record(run: string, sample: string, target: string, seq: string): boolean;
}

function internId(map: Map<string, number>, value: string): number {
  let id = map.get(value);
  if (id === undefined) {
    id = map.size;
    map.set(value, id);
  }
  return id;
}

function createCompactRepeatTracker(): CompactRepeatTracker {
  const runIds = new Map<string, number>();
  const sampleIds = new Map<string, number>();
  const targetIds = new Map<string, number>();
  const seqIds = new Map<string, number>();
  const byRun: Map<number, Map<number, SeqStore>>[] = [];

  return {
    record(run, sample, target, seq) {
      const runId = run === "" ? 0 : internId(runIds, run) + 1;
      const sampleId = internId(sampleIds, sample);
      const targetId = internId(targetIds, target);
      const seqId = internId(seqIds, seq);

      let bySample = byRun[runId];
      if (bySample === undefined) {
        bySample = new Map();
        byRun[runId] = bySample;
      }
      let byTarget = bySample.get(sampleId);
      if (byTarget === undefined) {
        byTarget = new Map();
        bySample.set(sampleId, byTarget);
        byTarget.set(targetId, seqId);
        return false;
      }
      const existing = byTarget.get(targetId);
      if (existing === undefined) {
        byTarget.set(targetId, seqId);
        return false;
      }
      if (typeof existing === "number") {
        if (existing === seqId) return true;
        byTarget.set(targetId, [existing, seqId]);
        return false;
      }
      if (Array.isArray(existing)) {
        if (existing.includes(seqId)) return true;
        if (existing.length < ALLELE_ARRAY_LIMIT) {
          existing.push(seqId);
          return false;
        }
        const set = new Set<number>(existing);
        set.add(seqId);
        byTarget.set(targetId, set);
        return false;
      }
      if (existing.has(seqId)) return true;
      existing.add(seqId);
      return false;
    },
  };
}

function createThrottledProgress(
  stage: "checking" | "building",
  onProgress: ((progress: MicrohaplotypesStreamProgress) => void) | undefined,
): ((progress: StreamReadProgress) => void) | undefined {
  if (onProgress === undefined) return undefined;
  let lastEmit = -1;
  return (progress) => {
    const now = Date.now();
    const isFirst = lastEmit < 0;
    const isFinal = progress.bytesRead >= progress.totalBytes;
    if (isFirst || isFinal || now - lastEmit >= PROGRESS_INTERVAL_MS) {
      lastEmit = now;
      onProgress({
        stage,
        bytesRead: progress.bytesRead,
        totalBytes: progress.totalBytes,
        rowsRead: progress.rowsRead,
      });
    }
  };
}

function booleanValue(cellText: string | null): boolean | string | null {
  const read = readBooleanCell(cellText);
  switch (read.kind) {
    case "value":
      return read.value;
    case "blank":
      return null;
    case "invalid":
      return read.text;
    default:
      return null;
  }
}

function pickColumns(chunk: readonly RawRow[], columns: readonly string[]): RawRow[] {
  const picked: RawRow[] = [];
  for (let i = 0; i < chunk.length; i += 1) {
    const row = chunk[i] ?? {};
    const record: Record<string, string | null> = {};
    for (const column of columns) record[column] = row[column] ?? null;
    picked.push(record);
  }
  return picked;
}

interface PassOneConfig {
  readonly blob: Blob;
  readonly fileName: string;
  readonly meta: DelimitedStreamMeta;
  readonly fieldSet: FieldSetSpec;
  readonly columns: Readonly<Record<string, string>>;
  readonly requiredFields: readonly { readonly field: FieldSpec; readonly column: string }[];
  readonly booleanColumns: readonly string[];
  readonly inferredColumns: readonly string[];
  readonly runColumn: string | null;
  readonly chunkSize: number;
  readonly maxTextBytes: number | undefined;
  readonly onProgress: ((progress: MicrohaplotypesStreamProgress) => void) | undefined;
  readonly isSuperseded: (() => boolean) | undefined;
}

interface RepeatedRowsSummary {
  readonly rows: RowSample;
  readonly firstSample: string;
  readonly firstTarget: string;
}

type PassOneOutcome =
  | { readonly kind: "superseded" }
  | {
      readonly kind: "done";
      readonly totalRows: number;
      readonly resolvedEncoding: StreamTextEncoding;
      readonly runNameValues: readonly string[];
      readonly observedColumns: readonly string[];
      readonly blankRequired: readonly {
        readonly field: FieldSpec;
        readonly column: string;
        readonly rows: RowSample;
      }[];
      readonly invalidBooleans: readonly {
        readonly column: string;
        readonly rows: RowSample;
        readonly values: readonly string[];
      }[];
      readonly repeated: RepeatedRowsSummary | null;
      readonly types: ColumnTypes | null;
      readonly typingError: unknown;
      readonly hasTypingError: boolean;
    };

/**
 * Pass 1 over the stored Blob: settles `createColumnTyper()` on inferred
 * columns only and collects all per-column checks in O(1)/compact memory.
 * Returning from this function lets V8 free the Pass 1 repeat tracker and
 * typer before Pass 2 allocates `createMhapTableBuilder`.
 */
async function runPassOne(config: PassOneConfig): Promise<PassOneOutcome> {
  const sampleCol = config.columns["librarySampleName"];
  const targetCol = config.columns["targetName"];
  const seqCol = config.columns["seq"];
  const checkRepeats = sampleCol !== undefined && targetCol !== undefined && seqCol !== undefined;

  let totalRows = 0;
  let blankTrackers = config.requiredFields.map(() => ({ first: [] as number[], count: 0 }));
  let booleanTrackers = config.booleanColumns.map(() => ({
    rows: { first: [] as number[], count: 0 },
    values: new Set<string>(),
  }));
  let runNameSet = new Set<string>();
  let repeatTracker = checkRepeats ? createCompactRepeatTracker() : null;
  let repeatedRows: MutableRowSample = { first: [], count: 0 };
  let firstRepeatedSample: string | null = null;
  let firstRepeatedTarget: string | null = null;
  let typer = config.inferredColumns.length > 0 ? createColumnTyper() : null;
  let observedColumns: readonly string[] = config.meta.columns;

  const resetState = (): void => {
    totalRows = 0;
    blankTrackers = config.requiredFields.map(() => ({ first: [] as number[], count: 0 }));
    booleanTrackers = config.booleanColumns.map(() => ({
      rows: { first: [] as number[], count: 0 },
      values: new Set<string>(),
    }));
    runNameSet = new Set<string>();
    repeatTracker = checkRepeats ? createCompactRepeatTracker() : null;
    repeatedRows = { first: [], count: 0 };
    firstRepeatedSample = null;
    firstRepeatedTarget = null;
    typer = config.inferredColumns.length > 0 ? createColumnTyper() : null;
    observedColumns = config.meta.columns;
  };

  let resolvedEncoding: StreamTextEncoding = config.meta.encoding;
  const generator = streamDelimitedChunks(config.blob, {
    fileName: config.fileName,
    delimiter: config.meta.delimiter,
    encoding: config.meta.encoding,
    columns: config.meta.columns,
    chunkSize: config.chunkSize,
    maxTextBytes: config.maxTextBytes,
    onProgress: createThrottledProgress("checking", config.onProgress),
    isSuperseded: config.isSuperseded,
    onRestart: (nextEncoding) => {
      resolvedEncoding = nextEncoding;
      resetState();
    },
  });

  try {
    for (;;) {
      if (config.isSuperseded?.() === true) return { kind: "superseded" };
      // oxlint-disable-next-line no-await-in-loop -- consuming stream chunks sequentially
      const step = await generator.next();
      if (step.done) {
        resolvedEncoding = step.value;
        break;
      }
      if (config.isSuperseded?.() === true) return { kind: "superseded" };
      const chunk = step.value;
      const firstRow = chunk[0];
      if (firstRow !== undefined) {
        const keys = Object.keys(firstRow);
        if (keys.length > observedColumns.length) observedColumns = keys;
      }

      if (typer !== null) {
        typer.add(pickColumns(chunk, config.inferredColumns));
      }

      for (let i = 0; i < chunk.length; i += 1) {
        const row = chunk[i] ?? {};
        const rowIndex = totalRows + i;

        for (let r = 0; r < config.requiredFields.length; r += 1) {
          const required = config.requiredFields[r];
          const tracker = blankTrackers[r];
          if (required !== undefined && tracker !== undefined) {
            if ((row[required.column] ?? "").trim() === "") {
              recordRowSample(tracker, rowIndex);
            }
          }
        }

        for (let b = 0; b < config.booleanColumns.length; b += 1) {
          const column = config.booleanColumns[b];
          const tracker = booleanTrackers[b];
          if (column !== undefined && tracker !== undefined) {
            const read = readBooleanCell(row[column] ?? null);
            if (read.kind === "invalid") {
              recordRowSample(tracker.rows, rowIndex);
              tracker.values.add(read.text.trim());
            }
          }
        }

        if (config.runColumn !== null && runNameSet.size < MAX_RUN_NAME_SUGGESTIONS) {
          const runVal = (row[config.runColumn] ?? "").trim();
          if (runVal !== "") runNameSet.add(runVal);
        }

        if (
          repeatTracker !== null &&
          sampleCol !== undefined &&
          targetCol !== undefined &&
          seqCol !== undefined
        ) {
          const runVal = config.runColumn === null ? "" : cell(row, config.runColumn);
          const sampleVal = cell(row, sampleCol);
          const targetVal = cell(row, targetCol);
          const seqVal = cell(row, seqCol);
          if (repeatTracker.record(runVal, sampleVal, targetVal, seqVal)) {
            recordRowSample(repeatedRows, rowIndex);
            if (firstRepeatedSample === null) {
              firstRepeatedSample = sampleVal;
              firstRepeatedTarget = targetVal;
            }
          }
        }
      }
      totalRows += chunk.length;
    }
  } finally {
    await generator.return(resolvedEncoding);
  }

  if (config.isSuperseded?.() === true) return { kind: "superseded" };

  const blankRequired = config.requiredFields
    .map((entry, index) => ({
      field: entry.field,
      column: entry.column,
      rows: blankTrackers[index] ?? { first: [], count: 0 },
    }))
    .filter((entry) => entry.rows.count > 0);

  const invalidBooleans = config.booleanColumns
    .map((column, index) => {
      const tracker = booleanTrackers[index];
      return {
        column,
        rows: tracker?.rows ?? { first: [], count: 0 },
        values: tracker === undefined ? [] : [...tracker.values],
      };
    })
    .filter((entry) => entry.rows.count > 0);

  let types: ColumnTypes | null = null;
  let typingError: unknown = null;
  let hasTypingError = false;
  if (blankRequired.length === 0 && invalidBooleans.length === 0 && typer !== null) {
    try {
      types = typer.finish();
    } catch (error) {
      typingError = error;
      hasTypingError = true;
    }
  }

  const repeated: RepeatedRowsSummary | null =
    repeatedRows.count > 0
      ? {
          rows: repeatedRows,
          firstSample: firstRepeatedSample ?? "",
          firstTarget: firstRepeatedTarget ?? "",
        }
      : null;

  return {
    kind: "done",
    totalRows,
    resolvedEncoding,
    runNameValues: [...runNameSet],
    observedColumns,
    blankRequired,
    invalidBooleans,
    repeated,
    types,
    typingError,
    hasTypingError,
  };
}

/**
 * Error-path only: finds the first unused column with `1 < distinct <= 50`
 * values that eliminates all `(sample, target, seq)` repeats, matching
 * `repeatedRowsNotice`.
 */
async function findRunLikeColumn(input: {
  readonly blob: Blob;
  readonly fileName: string;
  readonly delimiter: DelimitedStreamMeta["delimiter"];
  readonly encoding: StreamTextEncoding;
  readonly allColumns: readonly string[];
  readonly usedColumns: ReadonlySet<string>;
  readonly sampleCol: string;
  readonly targetCol: string;
  readonly seqCol: string;
  readonly chunkSize: number;
  readonly maxTextBytes: number | undefined;
  readonly isSuperseded: (() => boolean) | undefined;
}): Promise<
  { readonly kind: "superseded" } | { readonly kind: "done"; readonly column: string | undefined }
> {
  const candidates = input.allColumns.filter((column) => !input.usedColumns.has(column));
  if (candidates.length === 0) return { kind: "done", column: undefined };

  // Scan 1: count distinct trimmed values per candidate, dropping any > MAX_RUN_VALUES early.
  const distinctByCol = new Map<string, Set<string>>(
    candidates.map((column) => [column, new Set<string>()]),
  );
  for await (const chunk of streamDelimitedChunks(input.blob, {
    fileName: input.fileName,
    delimiter: input.delimiter,
    encoding: input.encoding,
    columns: input.allColumns,
    chunkSize: input.chunkSize,
    maxTextBytes: input.maxTextBytes,
    isSuperseded: input.isSuperseded,
  })) {
    if (input.isSuperseded?.() === true) return { kind: "superseded" };
    if (distinctByCol.size === 0) break;
    for (const row of chunk) {
      for (const [column, values] of distinctByCol) {
        values.add(cell(row, column));
        if (values.size > MAX_RUN_VALUES) distinctByCol.delete(column);
      }
    }
  }
  if (input.isSuperseded?.() === true) return { kind: "superseded" };

  const plausible = candidates.filter((column) => {
    const size = distinctByCol.get(column)?.size ?? 0;
    return size > 1 && size <= MAX_RUN_VALUES;
  });

  // Scan 2: first plausible column in file order that separates all repeats wins.
  for (const candidate of plausible) {
    const tracker = createCompactRepeatTracker();
    let hasRepeat = false;
    // oxlint-disable-next-line no-await-in-loop -- checking candidate columns in file order, stopping on first match
    for await (const chunk of streamDelimitedChunks(input.blob, {
      fileName: input.fileName,
      delimiter: input.delimiter,
      encoding: input.encoding,
      columns: input.allColumns,
      chunkSize: input.chunkSize,
      maxTextBytes: input.maxTextBytes,
      isSuperseded: input.isSuperseded,
    })) {
      if (input.isSuperseded?.() === true) return { kind: "superseded" };
      for (const row of chunk) {
        if (
          tracker.record(
            cell(row, candidate),
            cell(row, input.sampleCol),
            cell(row, input.targetCol),
            cell(row, input.seqCol),
          )
        ) {
          hasRepeat = true;
          break;
        }
      }
      if (hasRepeat) break;
    }
    if (input.isSuperseded?.() === true) return { kind: "superseded" };
    if (!hasRepeat) return { kind: "done", column: candidate };
  }

  return { kind: "done", column: undefined };
}

/**
 * Error-path only: targeted streaming scan collecting `{ first (<= 8), count }`
 * for the 4 `mhap/*` errors whose notice names offending row numbers.
 */
async function findBuilderErrorRows(input: {
  readonly error: PmoError;
  readonly blob: Blob;
  readonly fileName: string;
  readonly delimiter: DelimitedStreamMeta["delimiter"];
  readonly encoding: StreamTextEncoding;
  readonly tableColumns: readonly string[];
  readonly columns: Readonly<Record<string, string>>;
  readonly types: ColumnTypes | null;
  readonly inferredSet: ReadonlySet<string>;
  readonly chunkSize: number;
  readonly maxTextBytes: number | undefined;
  readonly isSuperseded: (() => boolean) | undefined;
}): Promise<{ readonly kind: "superseded" } | { readonly kind: "done"; readonly rows: RowSample }> {
  const { error, columns, types, inferredSet } = input;
  const sample: MutableRowSample = { first: [], count: 0 };

  const details = error.details;
  const detailText = (key: string): string | null => {
    const value = details[key];
    if (value === null || value === undefined) return null;
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : null;
  };

  let rowIndex = 0;
  for await (const chunk of streamDelimitedChunks(input.blob, {
    fileName: input.fileName,
    delimiter: input.delimiter,
    encoding: input.encoding,
    columns: input.tableColumns,
    chunkSize: input.chunkSize,
    maxTextBytes: input.maxTextBytes,
    isSuperseded: input.isSuperseded,
  })) {
    if (input.isSuperseded?.() === true) return { kind: "superseded" };

    if (error.code === "mhap/missing-reads") {
      const readsColumn = columns["reads"];
      const sampleColumn = columns["librarySampleName"];
      const targetSample = detailText("library_sample_name") ?? "";
      if (readsColumn !== undefined) {
        const typedChunk =
          types !== null && inferredSet.has(readsColumn)
            ? types.typeRows(pickColumns(chunk, [readsColumn]))
            : null;
        for (let i = 0; i < chunk.length; i += 1) {
          const rawRow = chunk[i] ?? {};
          const readVal = typedChunk !== null ? typedChunk[i]?.[readsColumn] : rawRow[readsColumn];
          const blank =
            isMissing(readVal) || (typeof readVal === "string" && readVal.trim() === "");
          if (
            blank &&
            (sampleColumn === undefined || (rawRow[sampleColumn] ?? "") === targetSample)
          ) {
            recordRowSample(sample, rowIndex + i);
          }
        }
      }
    } else if (error.code === "mhap/missing-run-name") {
      const columnName = detailText("column");
      if (columnName !== null) {
        for (let i = 0; i < chunk.length; i += 1) {
          const rawRow = chunk[i] ?? {};
          if ((rawRow[columnName] ?? "").trim() === "") {
            recordRowSample(sample, rowIndex + i);
          }
        }
      }
    } else if (error.code === "mhap/missing-seq") {
      const seqColumn = columns["seq"];
      if (seqColumn !== undefined) {
        for (let i = 0; i < chunk.length; i += 1) {
          const rawRow = chunk[i] ?? {};
          if ((rawRow[seqColumn] ?? "").trim() === "") {
            recordRowSample(sample, rowIndex + i);
          }
        }
      }
    } else if (error.code === "mhap/invalid-masking") {
      const columnName = detailText("column") ?? "";
      const targetValue = detailText("value") ?? "";
      if (columnName !== "") {
        for (let i = 0; i < chunk.length; i += 1) {
          const rawRow = chunk[i] ?? {};
          if ((rawRow[columnName] ?? "").trim() === targetValue) {
            recordRowSample(sample, rowIndex + i);
          }
        }
      }
    }
    rowIndex += chunk.length;
  }

  if (input.isSuperseded?.() === true) return { kind: "superseded" };
  return { kind: "done", rows: sample };
}

/**
 * Builds the microhaplotypes section in two streaming passes over a stored
 * delimited `Blob`, never holding the whole table as text or as rows.
 *
 * - Header-only checks (`section.table === null`, mapping, run name,
 *   representative columns) run first with zero file I/O.
 * - Pass 1 feeds only inferred (non-text, non-boolean) needed columns to
 *   `createColumnTyper()` so `"NA"` stays literal in text, extra, and
 *   representative columns, while collecting per-column checks and up to 200
 *   distinct run names in compact memory.
 * - Pass 2 streams typed chunks straight into `createMhapTableBuilder`.
 */
export async function buildMicrohaplotypesStream(
  input: StreamMicrohaplotypesInput,
): Promise<StreamMicrohaplotypesOutput> {
  const { section, source } = input;
  const deps = input.deps ?? DEFAULT_BUILD_DEPS;
  const chunkSize = input.chunkSize ?? DEFAULT_MHAP_CHUNK_SIZE;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError(`chunkSize must be a positive integer, got ${chunkSize}`);
  }

  // 1. Header-only checks (zero I/O).
  if (section.table === null) {
    const result =
      runNameStarted(section.runName) || section.representativeColumns.length > 0
        ? notReady("microhaplotypes", "incomplete", [
            makeNotice("error", "table/not-imported", t`Import the allele table.`),
          ])
        : notReady("microhaplotypes", "empty");
    return { kind: "done", result, totalRows: 0, runNameValues: [] };
  }

  const fixedRunNames =
    section.runName.mode === "fixed" && section.runName.fixedName.trim() !== ""
      ? [section.runName.fixedName.trim()]
      : [];

  const fileName = section.table.table.fileName;
  const tableId = section.table.table.id;

  if (source.kind === "missing") {
    return {
      kind: "done",
      result: notReady("microhaplotypes", "incomplete", [
        fileMissingNotice({ fileName, tableLabel: TABLE_LABEL, tableId }),
      ]),
      totalRows: 0,
      runNameValues: fixedRunNames,
    };
  }
  if (source.kind === "failed") {
    return {
      kind: "done",
      result: notReady("microhaplotypes", "error", [
        fileUnreadableNotice({
          fileName,
          tableLabel: TABLE_LABEL,
          tableId,
          reason: source.message,
        }),
      ]),
      totalRows: 0,
      runNameValues: fixedRunNames,
    };
  }

  const fieldSet = deps.getFieldSet("microhaplotypes");
  const mapped = section.table;
  const columns = mappedColumns(mapped);
  const issues: TableIssueContext = {
    tableLabel: TABLE_LABEL,
    tableId,
    fieldSet,
    columns,
    typed: null,
    raw: null,
  };

  const runName = resolveRunName(section.runName, mapped.table.columns, TABLE_LABEL);
  const problems = deps.checkMapping(fieldSet, source.meta.columns, mapped.mapping);
  if (problems.length > 0) {
    const mappingNotices = problems.map((problem) => mappingProblemNotice(problem, issues));
    const onlyIncomplete = problems.every((problem) => INCOMPLETE_MAPPING_KINDS.has(problem.kind));
    const mappingStatus = onlyIncomplete ? "incomplete" : "error";
    const notices =
      runName.kind === "blocked" ? [...mappingNotices, runName.notice] : mappingNotices;
    const status =
      runName.kind === "blocked" && runName.status === "error" ? "error" : mappingStatus;
    return {
      kind: "done",
      result: notReady("microhaplotypes", status, notices),
      totalRows: 0,
      runNameValues: fixedRunNames,
    };
  }
  if (runName.kind === "blocked") {
    return {
      kind: "done",
      result: notReady("microhaplotypes", runName.status, [runName.notice]),
      totalRows: 0,
      runNameValues: fixedRunNames,
    };
  }

  const missingRepresentative = section.representativeColumns.filter(
    (column) => !source.meta.columns.includes(column),
  );
  if (missingRepresentative.length > 0) {
    return {
      kind: "done",
      result: notReady("microhaplotypes", "error", [
        missingRepresentativeNotice(missingRepresentative),
      ]),
      totalRows: 0,
      runNameValues: fixedRunNames,
    };
  }

  if (input.isSuperseded?.() === true) return { kind: "superseded" };

  // 2. Classify needed columns (CRITICAL NA parity: only inferred columns go to createColumnTyper).
  const textSet = new Set<string>();
  const booleanSet = new Set<string>();
  const requiredFields: { readonly field: FieldSpec; readonly column: string }[] = [];

  for (const field of fieldSet.fields) {
    const column = columns[field.key];
    if (column === undefined) continue;
    if (field.required) requiredFields.push({ field, column });
    if (TEXT_KINDS.has(field.kind)) textSet.add(column);
    else if (field.kind === "boolean") booleanSet.add(column);
  }

  const additionalColumns = mapped.mapping.additionalColumns;
  const representative = section.representativeColumns;
  const detected = additionalColumns.filter((column) => !representative.includes(column));
  const extraTextColumns = [
    ...additionalColumns,
    ...representative,
    ...(runName.textColumn !== null ? [runName.textColumn] : []),
  ];
  for (const column of extraTextColumns) {
    if (source.meta.columns.includes(column)) textSet.add(column);
  }
  // A column listed as text stays text even if also listed as boolean (matches typeTable).
  for (const column of textSet) booleanSet.delete(column);

  const neededSet = new Set<string>([
    ...Object.values(columns),
    ...representative,
    ...detected,
    ...(runName.textColumn !== null ? [runName.textColumn] : []),
  ]);
  const neededColumns = [...neededSet];
  const neededKinds = neededColumns.map((column) =>
    textSet.has(column) ? "text" : booleanSet.has(column) ? "boolean" : "inferred",
  );
  const inferredColumns = neededColumns.filter((_, index) => neededKinds[index] === "inferred");
  const inferredSet = new Set(inferredColumns);
  const booleanColumns = [...booleanSet];

  // 3. Pass 1: typing + per-column checks (tracker is released when runPassOne returns).
  let pass1: PassOneOutcome;
  try {
    pass1 = await runPassOne({
      blob: source.blob,
      fileName,
      meta: source.meta,
      fieldSet,
      columns,
      requiredFields,
      booleanColumns,
      inferredColumns,
      runColumn: runName.textColumn,
      chunkSize,
      maxTextBytes: input.maxTextBytes,
      onProgress: input.onProgress,
      isSuperseded: input.isSuperseded,
    });
  } catch (error) {
    if (isImportError(error)) {
      const reason = importFailureMessage({ code: error.code, detail: error.detail }, fileName);
      return {
        kind: "done",
        result: notReady("microhaplotypes", "error", [
          fileUnreadableNotice({ fileName, tableLabel: TABLE_LABEL, tableId, reason }),
        ]),
        totalRows: 0,
        runNameValues: fixedRunNames,
      };
    }
    throw error;
  }

  if (pass1.kind === "superseded") return { kind: "superseded" };
  const runNameValues = runName.textColumn !== null ? pass1.runNameValues : fixedRunNames;

  if (pass1.blankRequired.length > 0 || pass1.invalidBooleans.length > 0) {
    const notices: Notice[] = [
      ...pass1.blankRequired.map((entry) =>
        blankRequiredNotice({
          issues,
          field: entry.field,
          column: entry.column,
          rows: entry.rows,
        }),
      ),
      ...pass1.invalidBooleans.map((entry) =>
        invalidBooleanNotice({
          issues,
          column: entry.column,
          fieldKey: Object.entries(columns).find(
            ([, mappedCol]) => mappedCol === entry.column,
          )?.[0],
          rows: entry.rows,
          values: entry.values,
        }),
      ),
    ];
    return {
      kind: "done",
      result: notReady("microhaplotypes", "error", notices),
      totalRows: pass1.totalRows,
      runNameValues,
    };
  }

  if (pass1.hasTypingError) {
    return {
      kind: "done",
      result: notReady("microhaplotypes", "error", [
        typingFailedNotice({
          tableLabel: TABLE_LABEL,
          tableId,
          error: pass1.typingError,
        }),
      ]),
      totalRows: pass1.totalRows,
      runNameValues,
    };
  }

  if (pass1.repeated !== null) {
    let runLike: string | undefined;
    if (
      runName.textColumn === null &&
      columns["librarySampleName"] !== undefined &&
      columns["targetName"] !== undefined &&
      columns["seq"] !== undefined
    ) {
      const used = new Set(Object.values(columns));
      const found = await findRunLikeColumn({
        blob: source.blob,
        fileName,
        delimiter: source.meta.delimiter,
        encoding: pass1.resolvedEncoding,
        allColumns: pass1.observedColumns,
        usedColumns: used,
        sampleCol: columns["librarySampleName"],
        targetCol: columns["targetName"],
        seqCol: columns["seq"],
        chunkSize,
        maxTextBytes: input.maxTextBytes,
        isSuperseded: input.isSuperseded,
      });
      if (found.kind === "superseded") return { kind: "superseded" };
      runLike = found.column;
    }
    return {
      kind: "done",
      result: notReady("microhaplotypes", "error", [
        formatRepeatedRowsNotice({
          sampleName: pass1.repeated.firstSample,
          targetName: pass1.repeated.firstTarget,
          rows: pass1.repeated.rows,
          runColumn: runName.textColumn,
          runLike,
        }),
      ]),
      totalRows: pass1.totalRows,
      runNameValues,
    };
  }

  if (input.isSuperseded?.() === true) return { kind: "superseded" };

  // 4. Pass 2: stream typed chunks straight into createMhapTableBuilder.
  const { options, unknownKeys } = columnOptions(columns, MHAP_COLUMN_OPTIONS);
  const warnings: PmoWarning[] = [];
  const builder = createMhapTableBuilder({
    ...options,
    ...(runName.option === undefined ? {} : { bioinformaticsRunName: runName.option }),
    ...(representative.length > 0 ? { additionalRepresentativeMhapCols: representative } : {}),
    ...(detected.length > 0 ? { additionalMhapDetectedCols: detected } : {}),
    onWarning: (warning) => warnings.push(warning),
  });

  const types = pass1.types;
  try {
    for await (const chunk of streamDelimitedChunks(source.blob, {
      fileName,
      delimiter: source.meta.delimiter,
      encoding: pass1.resolvedEncoding,
      columns: pass1.observedColumns,
      chunkSize,
      maxTextBytes: input.maxTextBytes,
      onProgress: createThrottledProgress("building", input.onProgress),
      isSuperseded: input.isSuperseded,
    })) {
      if (input.isSuperseded?.() === true) return { kind: "superseded" };
      const typedInferred: readonly Row[] | null =
        types !== null ? types.typeRows(pickColumns(chunk, inferredColumns)) : null;

      const typedChunk: Row[] = [];
      for (let i = 0; i < chunk.length; i += 1) {
        const rawRow = chunk[i] ?? {};
        const typedRow = typedInferred?.[i];
        const record: Record<string, Row[string]> = {};
        for (let pos = 0; pos < neededColumns.length; pos += 1) {
          const column = neededColumns[pos] ?? "";
          const kind = neededKinds[pos];
          record[column] =
            kind === "text"
              ? (rawRow[column] ?? null)
              : kind === "boolean"
                ? booleanValue(rawRow[column] ?? null)
                : (typedRow?.[column] ?? null);
        }
        typedChunk.push(record);
      }
      builder.add(typedChunk);
    }

    if (input.isSuperseded?.() === true) return { kind: "superseded" };
    const fragment = builder.finish();
    const notices = [
      ...unknownKeysNotice(unknownKeys, TABLE_LABEL),
      ...warnings.map((warning) => warningNotice(warning, issues)),
    ];
    return {
      kind: "done",
      result: ready("microhaplotypes", fragment, summarise(fragment, pass1.totalRows), notices),
      totalRows: pass1.totalRows,
      runNameValues,
    };
  } catch (error) {
    if (isImportError(error)) {
      const reason = importFailureMessage({ code: error.code, detail: error.detail }, fileName);
      return {
        kind: "done",
        result: notReady("microhaplotypes", "error", [
          fileUnreadableNotice({ fileName, tableLabel: TABLE_LABEL, tableId, reason }),
        ]),
        totalRows: pass1.totalRows,
        runNameValues,
      };
    }

    let issueContext = issues;
    if (error instanceof PmoError && ROW_LOOKUP_ERROR_CODES.has(error.code)) {
      const found = await findBuilderErrorRows({
        error,
        blob: source.blob,
        fileName,
        delimiter: source.meta.delimiter,
        encoding: pass1.resolvedEncoding,
        tableColumns: pass1.observedColumns,
        columns,
        types,
        inferredSet,
        chunkSize,
        maxTextBytes: input.maxTextBytes,
        isSuperseded: input.isSuperseded,
      });
      if (found.kind === "superseded") return { kind: "superseded" };
      issueContext = { ...issues, errorRows: found.rows };
    }
    const notices = [
      ...unknownKeysNotice(unknownKeys, TABLE_LABEL),
      errorNotice(error, issueContext),
    ];
    return {
      kind: "done",
      result: notReady("microhaplotypes", "error", notices),
      totalRows: pass1.totalRows,
      runNameValues,
    };
  }
}
