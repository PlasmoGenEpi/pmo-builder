/**
 * Two-pass streaming builder for the microhaplotypes section: reads a stored
 * delimited `Blob` in chunks without holding the whole table in memory.
 */
import { t } from "@lingui/core/macro";
import {
  PmoError,
  createColumnTyper,
  createMhapTableBuilder,
  isMissing,
  type ColumnTypes,
  type PmoWarning,
  type Row,
} from "pmotools-ts";

import { mappedColumns, type MicrohaplotypesDraft } from "@/domain/draft";
import {
  TEXT_KINDS,
  booleanValue,
  importFailureMessage,
  isImportError,
  pickColumns,
  readBooleanCell,
  streamDelimitedChunks,
  type DelimitedStreamMeta,
  type StreamReadProgress,
  type StreamTextEncoding,
} from "@/domain/import";
import type { FieldSetSpec, FieldSpec, Notice } from "@/domain/types";

import { DEFAULT_BUILD_DEPS, type BuildDeps } from "./context";
import {
  DEFAULT_MHAP_CHUNK_SIZE,
  MAX_RUN_VALUES,
  MHAP_COLUMN_OPTIONS,
  MHAP_TABLE_LABEL,
  formatRepeatedRowsNotice,
  missingRepresentativeNotice,
  summariseMicrohaplotypes,
  trimmedCell,
} from "./microhaplotypesShared";
import {
  MAX_ROW_SAMPLE,
  errorNotice,
  makeNotice,
  mappingProblemNotice,
  warningNotice,
  type RowSample,
  type TableIssueContext,
} from "./notices";
import { notReady, ready, type SectionResult } from "./results";
import { resolveRunName, runNameStarted } from "./runName";
import {
  INCOMPLETE_KINDS,
  blankRequiredNotice,
  columnOptions,
  fileMissingNotice,
  fileUnreadableNotice,
  invalidBooleanNotice,
  typingFailedNotice,
  unknownKeysNotice,
} from "./table";

/** Most distinct run names gathered during Pass 1 for suggestions. */
const MAX_RUN_NAME_SUGGESTIONS = 200;

/** Per-(sample, target) allele count above which a `Set<number>` replaces `number[]`. */
const ALLELE_ARRAY_LIMIT = 32;

/** Minimum interval between progress callbacks during streaming passes. */
const PROGRESS_INTERVAL_MS = 100;

const ROW_LOOKUP_ERROR_CODES: ReadonlySet<string> = new Set([
  "mhap/missing-reads",
  "mhap/missing-run-name",
  "mhap/missing-seq",
  "mhap/invalid-masking",
]);

/** Progress reported while streaming and building the allele table. */
export interface MicrohaplotypesStreamProgress extends StreamReadProgress {
  readonly stage: "checking" | "building";
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
  /** Maximum unpacked text bytes. Defaults to `IMPORT_LIMITS.alleleTextBytes`. */
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

/** Stream source parameters shared across Pass 1, Pass 2, and error-path scans. */
interface StreamSourceConfig {
  readonly blob: Blob;
  readonly fileName: string;
  readonly delimiter: DelimitedStreamMeta["delimiter"];
  readonly encoding: StreamTextEncoding;
  readonly chunkSize: number;
  readonly maxTextBytes: number | undefined;
  readonly isSuperseded: (() => boolean) | undefined;
}

type SeqStore = number | number[] | Set<number>;

interface MutableRowSample {
  readonly first: number[];
  count: number;
}

function emptyRowSample(): MutableRowSample {
  return { first: [], count: 0 };
}

function recordRowSample(sample: MutableRowSample, rowIndex: number): void {
  sample.count += 1;
  if (sample.first.length < MAX_ROW_SAMPLE) sample.first.push(rowIndex);
}

/** Mutable key object reused across rows to avoid per-row allocations. */
interface RepeatKey {
  run: string;
  sample: string;
  target: string;
  seq: string;
}

/** Compact integer-indexed `(run, sample, target, seq)` duplicate detector. */
interface CompactRepeatTracker {
  /** Records a row; returns `true` if `(run, sample, target, seq)` was already seen. */
  record(key: Readonly<RepeatKey>): boolean;
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
    record(key) {
      const runId = key.run === "" ? 0 : internId(runIds, key.run) + 1;
      const sampleId = internId(sampleIds, key.sample);
      const targetId = internId(targetIds, key.target);
      const seqId = internId(seqIds, key.seq);

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
      onProgress({ stage, ...progress });
    }
  };
}

interface PassOneConfig {
  readonly source: StreamSourceConfig;
  readonly metaColumns: readonly string[];
  readonly fieldSet: FieldSetSpec;
  readonly columns: Readonly<Record<string, string>>;
  readonly requiredFields: readonly { readonly field: FieldSpec; readonly column: string }[];
  readonly booleanColumns: readonly string[];
  readonly inferredColumns: readonly string[];
  readonly runColumn: string | null;
  readonly onProgress: ((progress: MicrohaplotypesStreamProgress) => void) | undefined;
}

interface RepeatedRowsSummary {
  readonly rows: RowSample;
  readonly firstSample: string;
  readonly firstTarget: string;
}

type PassOneTyping =
  | { readonly kind: "ok"; readonly types: ColumnTypes | null }
  | { readonly kind: "error"; readonly error: unknown };

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
      readonly typing: PassOneTyping;
    };

interface PassOneState {
  totalRows: number;
  readonly blankTrackers: MutableRowSample[];
  readonly booleanTrackers: { readonly rows: MutableRowSample; readonly values: Set<string> }[];
  readonly runNameSet: Set<string>;
  readonly repeatTracker: CompactRepeatTracker | null;
  readonly repeatedRows: MutableRowSample;
  firstRepeatedSample: string | null;
  firstRepeatedTarget: string | null;
  readonly typer: ReturnType<typeof createColumnTyper> | null;
  observedColumns: readonly string[];
}

/**
 * Pass 1 over the stored Blob: settles `createColumnTyper()` on inferred
 * columns only and collects all per-column checks in O(1)/compact memory.
 * Returning from this function lets V8 free the Pass 1 repeat tracker and
 * typer before Pass 2 allocates `createMhapTableBuilder`.
 */
async function runPassOne(config: PassOneConfig): Promise<PassOneOutcome> {
  const { source } = config;
  const sampleCol = config.columns["librarySampleName"];
  const targetCol = config.columns["targetName"];
  const seqCol = config.columns["seq"];
  const checkRepeats = sampleCol !== undefined && targetCol !== undefined && seqCol !== undefined;

  const resetState = (): PassOneState => ({
    totalRows: 0,
    blankTrackers: config.requiredFields.map(() => emptyRowSample()),
    booleanTrackers: config.booleanColumns.map(() => ({
      rows: emptyRowSample(),
      values: new Set<string>(),
    })),
    runNameSet: new Set<string>(),
    repeatTracker: checkRepeats ? createCompactRepeatTracker() : null,
    repeatedRows: emptyRowSample(),
    firstRepeatedSample: null,
    firstRepeatedTarget: null,
    typer: config.inferredColumns.length > 0 ? createColumnTyper() : null,
    observedColumns: config.metaColumns,
  });

  let state = resetState();
  const repeatKey: RepeatKey = { run: "", sample: "", target: "", seq: "" };
  let resolvedEncoding: StreamTextEncoding = source.encoding;
  const generator = streamDelimitedChunks(source.blob, {
    fileName: source.fileName,
    delimiter: source.delimiter,
    encoding: source.encoding,
    columns: config.metaColumns,
    chunkSize: source.chunkSize,
    maxTextBytes: source.maxTextBytes,
    onProgress: createThrottledProgress("checking", config.onProgress),
    isSuperseded: source.isSuperseded,
    onRestart: (nextEncoding) => {
      resolvedEncoding = nextEncoding;
      state = resetState();
    },
  });

  try {
    for (;;) {
      if (source.isSuperseded?.() === true) return { kind: "superseded" };
      // oxlint-disable-next-line no-await-in-loop -- consuming stream chunks sequentially
      const step = await generator.next();
      if (step.done) {
        resolvedEncoding = step.value;
        break;
      }
      if (source.isSuperseded?.() === true) return { kind: "superseded" };
      const chunk = step.value;
      const firstRow = chunk[0];
      if (firstRow !== undefined) {
        const keys = Object.keys(firstRow);
        if (keys.length > state.observedColumns.length) state.observedColumns = keys;
      }

      if (state.typer !== null) {
        state.typer.add(pickColumns(chunk, config.inferredColumns));
      }

      for (let i = 0; i < chunk.length; i += 1) {
        const row = chunk[i] ?? {};
        const rowIndex = state.totalRows + i;

        for (let r = 0; r < config.requiredFields.length; r += 1) {
          const required = config.requiredFields[r];
          const tracker = state.blankTrackers[r];
          if (required !== undefined && tracker !== undefined) {
            if ((row[required.column] ?? "").trim() === "") {
              recordRowSample(tracker, rowIndex);
            }
          }
        }

        for (let b = 0; b < config.booleanColumns.length; b += 1) {
          const column = config.booleanColumns[b];
          const tracker = state.booleanTrackers[b];
          if (column !== undefined && tracker !== undefined) {
            const read = readBooleanCell(row[column] ?? null);
            if (read.kind === "invalid") {
              recordRowSample(tracker.rows, rowIndex);
              tracker.values.add(read.text.trim());
            }
          }
        }

        if (config.runColumn !== null && state.runNameSet.size < MAX_RUN_NAME_SUGGESTIONS) {
          const runVal = (row[config.runColumn] ?? "").trim();
          if (runVal !== "") state.runNameSet.add(runVal);
        }

        if (
          state.repeatTracker !== null &&
          sampleCol !== undefined &&
          targetCol !== undefined &&
          seqCol !== undefined
        ) {
          repeatKey.run = config.runColumn === null ? "" : trimmedCell(row, config.runColumn);
          repeatKey.sample = trimmedCell(row, sampleCol);
          repeatKey.target = trimmedCell(row, targetCol);
          repeatKey.seq = trimmedCell(row, seqCol);
          if (state.repeatTracker.record(repeatKey)) {
            recordRowSample(state.repeatedRows, rowIndex);
            if (state.firstRepeatedSample === null) {
              state.firstRepeatedSample = repeatKey.sample;
              state.firstRepeatedTarget = repeatKey.target;
            }
          }
        }
      }
      state.totalRows += chunk.length;
    }
  } finally {
    await generator.return(resolvedEncoding);
  }

  if (source.isSuperseded?.() === true) return { kind: "superseded" };

  const blankRequired = config.requiredFields
    .map((entry, index) => ({
      field: entry.field,
      column: entry.column,
      rows: state.blankTrackers[index] ?? emptyRowSample(),
    }))
    .filter((entry) => entry.rows.count > 0);

  const invalidBooleans = config.booleanColumns
    .map((column, index) => {
      const tracker = state.booleanTrackers[index];
      return {
        column,
        rows: tracker?.rows ?? emptyRowSample(),
        values: tracker === undefined ? [] : [...tracker.values],
      };
    })
    .filter((entry) => entry.rows.count > 0);

  let typing: PassOneTyping = { kind: "ok", types: null };
  if (blankRequired.length === 0 && invalidBooleans.length === 0 && state.typer !== null) {
    try {
      typing = { kind: "ok", types: state.typer.finish() };
    } catch (error) {
      typing = { kind: "error", error };
    }
  }

  const repeated: RepeatedRowsSummary | null =
    state.repeatedRows.count > 0
      ? {
          rows: state.repeatedRows,
          firstSample: state.firstRepeatedSample ?? "",
          firstTarget: state.firstRepeatedTarget ?? "",
        }
      : null;

  return {
    kind: "done",
    totalRows: state.totalRows,
    resolvedEncoding,
    runNameValues: [...state.runNameSet],
    observedColumns: state.observedColumns,
    blankRequired,
    invalidBooleans,
    repeated,
    typing,
  };
}

/**
 * Error-path only: finds the first unused column with `1 < distinct <= 50`
 * values that eliminates all `(sample, target, seq)` repeats, matching
 * `repeatedRowsNotice`.
 */
async function findRunLikeColumn(input: {
  readonly source: StreamSourceConfig;
  readonly allColumns: readonly string[];
  readonly usedColumns: ReadonlySet<string>;
  readonly sampleCol: string;
  readonly targetCol: string;
  readonly seqCol: string;
}): Promise<
  { readonly kind: "superseded" } | { readonly kind: "done"; readonly column: string | undefined }
> {
  const { source } = input;
  const candidates = input.allColumns.filter((column) => !input.usedColumns.has(column));
  if (candidates.length === 0) return { kind: "done", column: undefined };

  // Scan 1: count distinct trimmed values per candidate, dropping any > MAX_RUN_VALUES early.
  const distinctByCol = new Map<string, Set<string>>(
    candidates.map((column) => [column, new Set<string>()]),
  );
  for await (const chunk of streamDelimitedChunks(source.blob, {
    fileName: source.fileName,
    delimiter: source.delimiter,
    encoding: source.encoding,
    columns: input.allColumns,
    chunkSize: source.chunkSize,
    maxTextBytes: source.maxTextBytes,
    isSuperseded: source.isSuperseded,
  })) {
    if (source.isSuperseded?.() === true) return { kind: "superseded" };
    if (distinctByCol.size === 0) break;
    for (const row of chunk) {
      for (const [column, values] of distinctByCol) {
        values.add(trimmedCell(row, column));
        if (values.size > MAX_RUN_VALUES) distinctByCol.delete(column);
      }
    }
  }
  if (source.isSuperseded?.() === true) return { kind: "superseded" };

  const plausible = candidates.filter((column) => {
    const size = distinctByCol.get(column)?.size ?? 0;
    return size > 1 && size <= MAX_RUN_VALUES;
  });

  const repeatKey: RepeatKey = { run: "", sample: "", target: "", seq: "" };
  // Scan 2: first plausible column in file order that separates all repeats wins.
  for (const candidate of plausible) {
    const tracker = createCompactRepeatTracker();
    let hasRepeat = false;
    // oxlint-disable-next-line no-await-in-loop -- checking candidate columns in file order, stopping on first match
    for await (const chunk of streamDelimitedChunks(source.blob, {
      fileName: source.fileName,
      delimiter: source.delimiter,
      encoding: source.encoding,
      columns: input.allColumns,
      chunkSize: source.chunkSize,
      maxTextBytes: source.maxTextBytes,
      isSuperseded: source.isSuperseded,
    })) {
      if (source.isSuperseded?.() === true) return { kind: "superseded" };
      for (const row of chunk) {
        repeatKey.run = trimmedCell(row, candidate);
        repeatKey.sample = trimmedCell(row, input.sampleCol);
        repeatKey.target = trimmedCell(row, input.targetCol);
        repeatKey.seq = trimmedCell(row, input.seqCol);
        if (tracker.record(repeatKey)) {
          hasRepeat = true;
          break;
        }
      }
      if (hasRepeat) break;
    }
    if (source.isSuperseded?.() === true) return { kind: "superseded" };
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
  readonly source: StreamSourceConfig;
  readonly tableColumns: readonly string[];
  readonly columns: Readonly<Record<string, string>>;
  readonly types: ColumnTypes | null;
  readonly inferredSet: ReadonlySet<string>;
}): Promise<{ readonly kind: "superseded" } | { readonly kind: "done"; readonly rows: RowSample }> {
  const { error, source, columns, types, inferredSet } = input;
  const sample = emptyRowSample();

  const details = error.details;
  const detailText = (key: string): string | null => {
    const value = details[key];
    if (value === null || value === undefined) return null;
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : null;
  };

  let rowIndex = 0;
  for await (const chunk of streamDelimitedChunks(source.blob, {
    fileName: source.fileName,
    delimiter: source.delimiter,
    encoding: source.encoding,
    columns: input.tableColumns,
    chunkSize: source.chunkSize,
    maxTextBytes: source.maxTextBytes,
    isSuperseded: source.isSuperseded,
  })) {
    if (source.isSuperseded?.() === true) return { kind: "superseded" };

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

  if (source.isSuperseded?.() === true) return { kind: "superseded" };
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
        fileMissingNotice({ fileName, tableLabel: MHAP_TABLE_LABEL, tableId }),
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
          tableLabel: MHAP_TABLE_LABEL,
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
    tableLabel: MHAP_TABLE_LABEL,
    tableId,
    fieldSet,
    columns,
    typed: null,
    raw: null,
  };

  const runName = resolveRunName(section.runName, mapped.table.columns, MHAP_TABLE_LABEL);
  const problems = deps.checkMapping(fieldSet, source.meta.columns, mapped.mapping);
  if (problems.length > 0) {
    const mappingNotices = problems.map((problem) => mappingProblemNotice(problem, issues));
    const onlyIncomplete = problems.every((problem) => INCOMPLETE_KINDS.has(problem.kind));
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

  const sourceConfig: StreamSourceConfig = {
    blob: source.blob,
    fileName,
    delimiter: source.meta.delimiter,
    encoding: source.meta.encoding,
    chunkSize,
    maxTextBytes: input.maxTextBytes,
    isSuperseded: input.isSuperseded,
  };

  // 3. Pass 1: typing + per-column checks (tracker is released when runPassOne returns).
  let pass1: PassOneOutcome;
  try {
    pass1 = await runPassOne({
      source: sourceConfig,
      metaColumns: source.meta.columns,
      fieldSet,
      columns,
      requiredFields,
      booleanColumns,
      inferredColumns,
      runColumn: runName.textColumn,
      onProgress: input.onProgress,
    });
  } catch (error) {
    if (isImportError(error)) {
      const reason = importFailureMessage({ code: error.code, detail: error.detail });
      return {
        kind: "done",
        result: notReady("microhaplotypes", "error", [
          fileUnreadableNotice({ fileName, tableLabel: MHAP_TABLE_LABEL, tableId, reason }),
        ]),
        totalRows: 0,
        runNameValues: fixedRunNames,
      };
    }
    throw error;
  }

  if (pass1.kind === "superseded") return { kind: "superseded" };
  const runNameValues = runName.textColumn !== null ? pass1.runNameValues : fixedRunNames;
  const resolvedSource: StreamSourceConfig = { ...sourceConfig, encoding: pass1.resolvedEncoding };

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

  if (pass1.typing.kind === "error") {
    return {
      kind: "done",
      result: notReady("microhaplotypes", "error", [
        typingFailedNotice({
          tableLabel: MHAP_TABLE_LABEL,
          tableId,
          error: pass1.typing.error,
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
        source: resolvedSource,
        allColumns: pass1.observedColumns,
        usedColumns: used,
        sampleCol: columns["librarySampleName"],
        targetCol: columns["targetName"],
        seqCol: columns["seq"],
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

  const types = pass1.typing.types;
  try {
    for await (const chunk of streamDelimitedChunks(resolvedSource.blob, {
      fileName: resolvedSource.fileName,
      delimiter: resolvedSource.delimiter,
      encoding: resolvedSource.encoding,
      columns: pass1.observedColumns,
      chunkSize: resolvedSource.chunkSize,
      maxTextBytes: resolvedSource.maxTextBytes,
      onProgress: createThrottledProgress("building", input.onProgress),
      isSuperseded: resolvedSource.isSuperseded,
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
      ...unknownKeysNotice(unknownKeys, MHAP_TABLE_LABEL),
      ...warnings.map((warning) => warningNotice(warning, issues)),
    ];
    return {
      kind: "done",
      result: ready(
        "microhaplotypes",
        fragment,
        summariseMicrohaplotypes(fragment, pass1.totalRows),
        notices,
      ),
      totalRows: pass1.totalRows,
      runNameValues,
    };
  } catch (error) {
    if (isImportError(error)) {
      const reason = importFailureMessage({ code: error.code, detail: error.detail });
      return {
        kind: "done",
        result: notReady("microhaplotypes", "error", [
          fileUnreadableNotice({ fileName, tableLabel: MHAP_TABLE_LABEL, tableId, reason }),
        ]),
        totalRows: pass1.totalRows,
        runNameValues,
      };
    }

    let issueContext = issues;
    if (error instanceof PmoError && ROW_LOOKUP_ERROR_CODES.has(error.code)) {
      const found = await findBuilderErrorRows({
        error,
        source: resolvedSource,
        tableColumns: pass1.observedColumns,
        columns,
        types,
        inferredSet,
      });
      if (found.kind === "superseded") return { kind: "superseded" };
      issueContext = { ...issues, errorRows: found.rows };
    }
    const notices = [
      ...unknownKeysNotice(unknownKeys, MHAP_TABLE_LABEL),
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
