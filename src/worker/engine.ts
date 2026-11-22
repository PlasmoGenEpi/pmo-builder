/**
 * The engine: owns the imported tables and the latest build, and does the
 * heavy work (parsing, building, validating, exporting). It runs in a web
 * worker in the app (see `engine.worker.ts` and `client.ts`); tests and
 * environments without workers use {@link createInThreadEngine} directly.
 *
 * Every method is async and takes and returns only structured-cloneable
 * data, so the worker client can offer exactly the same interface. The PMO
 * itself stays here; callers get statuses, summaries, notices and, on
 * request, a file.
 */
import type { PortableMicrohaplotypeObject, Table } from "pmotools-ts";

import {
  DEFAULT_BUILD_DEPS,
  NO_SUGGESTIONS,
  buildMicrohaplotypesStream,
  buildSection,
  collectSuggestions,
  distinctValues as columnDistinctValues,
  exportPmo,
  measurePmoSize,
  mergeSections,
  pmoFileName,
  previewPmo,
  statusAfterMerge,
  type BuildDeps,
  type PmoFile,
  type SectionResult,
  type SectionResults,
  type Suggestions,
  type TableLookup,
  type TableLookupResult,
} from "@/domain/build";
import {
  newId,
  referencedTableIds,
  sectionTableIds,
  toJsonValue,
  type Draft,
  type TableRef,
} from "@/domain/draft";
import { describeError } from "@/domain/errors";
import {
  importFailureMessage,
  inspectDelimitedStream,
  isImportError,
  parseFile,
  streamDelimitedChunks,
  streamDistinctValues,
  type DelimitedStreamMeta,
  type ImportFailure,
} from "@/domain/import";
import {
  answerWorkingPmo,
  NOTHING_HELD,
  settleWorkingPmo,
  type WorkingPmoHeld,
} from "@/domain/tools/workingPmoHandlers";
import type { Notice, ParsedFile, RawRow, RawTable, SectionId } from "@/domain/types";
import { SECTION_IDS } from "@/domain/types";

import type {
  BuildProgress,
  BuildRequestOptions,
  Engine,
  ImportOutcome,
  InThreadEngineOptions,
  PmoTextPreview,
  SectionView,
} from "./types";

export type * from "./types";

type TableState =
  | { readonly kind: "pending" }
  | { readonly kind: "parsing"; readonly promise: Promise<void> }
  | { readonly kind: "ready"; readonly parsed: ParsedFile }
  | {
      readonly kind: "streamed";
      readonly meta: DelimitedStreamMeta;
      exactRowCount: number | null;
      runNameValues: { readonly column: string; readonly values: readonly string[] } | null;
    }
  | { readonly kind: "failed"; readonly message: string };

interface TableEntry {
  readonly id: string;
  readonly fileName: string;
  readonly source: Blob;
  readonly stream: boolean;
  sheetName: string | null;
  /** Counts up whenever the table's rows change, so memoised builds notice. */
  revision: number;
  state: TableState;
}

/**
 * A section's last build and what it was built from: the section's part of
 * the draft (its object, or the caller's token for it) and its tables.
 */
interface Memo {
  readonly input: SectionInput;
  readonly tables: string;
  readonly result: SectionResult<SectionId>;
}

/** What a section was built from: a token from the caller, or the object itself. */
type SectionInput =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "object"; readonly value: unknown };

function sectionInput(
  draft: Draft,
  section: SectionId,
  options: BuildRequestOptions,
): SectionInput {
  const token = options.sectionTokens?.[section];
  return token === undefined ? { kind: "object", value: draft[section] } : { kind: "token", token };
}

/**
 * Whether a section's part of the draft is the one a memo was built from.
 *
 * Draft updates are immutable, so an unchanged part is the same object. A
 * draft that crossed the worker boundary is a fresh copy, so there the
 * caller's tokens, given where identity still held, decide. Without tokens a
 * different object is compared by content, walking it only until the first
 * difference and building nothing, for callers that pass a copied draft.
 */
function sameInput(a: SectionInput, b: SectionInput): boolean {
  if (a.kind === "token" && b.kind === "token") return a.token === b.token;
  if (a.kind === "object" && b.kind === "object") {
    return a.value === b.value || sameJson(a.value, b.value);
  }
  return false;
}

/** Whether two plain JSON values (parts of a draft) are equal. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!sameJson(a[index], b[index])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key)) return false;
    if (!sameJson(Reflect.get(a, key), Reflect.get(b, key))) return false;
  }
  return true;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function toRef(entry: TableEntry, parsed: ParsedFile): TableRef {
  return {
    id: entry.id,
    fileName: entry.fileName,
    fileSize: entry.source.size,
    format: parsed.format,
    sheetNames: parsed.sheetNames,
    sheetName: parsed.sheetName,
    columns: parsed.table.columns,
    rowCount: parsed.table.rows.length,
  };
}

function toStreamedRef(entry: TableEntry, meta: DelimitedStreamMeta): TableRef {
  return {
    id: entry.id,
    fileName: entry.fileName,
    fileSize: entry.source.size,
    format: "delimited",
    sheetNames: null,
    sheetName: null,
    columns: meta.columns,
    rowCount: meta.exactRowCount,
  };
}

/** The sections whose tables the suggestions read. A section is rebuilt when its table changes. */
const SUGGESTION_SOURCES: readonly SectionId[] = ["microhaplotypes", "specimens", "librarySamples"];

/** A section as the main thread sees it, its status counting the merge's errors that point at it. */
function view<S extends SectionId>(
  result: SectionResult<S>,
  mergeNotices: readonly Notice[],
): SectionView<S> {
  return {
    status: statusAfterMerge(result.section, result.status, mergeNotices),
    notices: result.notices,
    summary: result.summary,
  };
}

/** Why parsing failed, as a code the interface can word. */
function failureOf(error: unknown): ImportFailure {
  return isImportError(error) ? { code: error.code, detail: error.detail } : { code: "unexpected" };
}

/** A failed import: the reason, and a notice that names the file once and says what to do. */
function importFailed(failure: ImportFailure, fileName: string): ImportOutcome {
  const notice: Notice = {
    severity: "error",
    code: `import/${failure.code}`,
    message: importFailureMessage(failure, fileName),
  };
  return { kind: "failed", notice, failure };
}

/**
 * Wraps `typeTable` so a table is typed once for a given choice of text and
 * yes-or-no columns, not again on every rebuild of its section. One typed
 * copy is kept per raw table, and it goes when the raw table does.
 */
function cachedTyping(deps: BuildDeps): BuildDeps {
  const typed = new WeakMap<RawTable, { readonly key: string; readonly table: Table }>();
  return {
    ...deps,
    typeTable: (table, options) => {
      const key = `${options.textColumns.toSorted().join("\u0000")}\u0001${(options.booleanColumns ?? []).toSorted().join("\u0000")}`;
      const hit = typed.get(table);
      if (hit !== undefined && hit.key === key) return hit.table;
      const result = deps.typeTable(table, options);
      typed.set(table, { key, table: result });
      return result;
    },
  };
}

/** A lazy cache keyed by `(pmo, gzip)` for the latest built PMO. */
interface PmoFormatCache<T> {
  peek(pmo: PortableMicrohaplotypeObject, gzip: boolean): T | undefined;
  getOrCreate(pmo: PortableMicrohaplotypeObject, gzip: boolean): T;
  clearIfNot(pmo: PortableMicrohaplotypeObject | null): void;
  clear(): void;
}

/** Caches one value per `(pmo, gzip)` format for the current PMO, clearing when the PMO changes. */
function createPmoFormatCache<T>(
  create: (pmo: PortableMicrohaplotypeObject, gzip: boolean) => T,
): PmoFormatCache<T> {
  let entry: {
    readonly pmo: PortableMicrohaplotypeObject;
    readonly byFormat: Map<boolean, T>;
  } | null = null;
  return {
    peek(pmo, gzip) {
      return entry !== null && entry.pmo === pmo ? entry.byFormat.get(gzip) : undefined;
    },
    getOrCreate(pmo, gzip) {
      if (entry === null || entry.pmo !== pmo) entry = { pmo, byFormat: new Map() };
      const existing = entry.byFormat.get(gzip);
      if (existing !== undefined) return existing;
      const created = create(pmo, gzip);
      entry.byFormat.set(gzip, created);
      return created;
    },
    clearIfNot(pmo) {
      if (entry !== null && entry.pmo !== pmo) entry = null;
    },
    clear() {
      entry = null;
    },
  };
}

/** Creates an engine that runs on the calling thread. */
export function createInThreadEngine(options: InThreadEngineOptions = {}): Engine {
  const parse = options.parseFile ?? parseFile;
  const deps = cachedTyping(options.deps ?? DEFAULT_BUILD_DEPS);
  // Only stream when using the real parser and build deps (injected test doubles keep whole-table mode).
  const allowStreaming = options.parseFile === undefined && options.deps === undefined;
  const shouldStream = (stream: boolean | undefined, source: Blob): boolean =>
    allowStreaming && stream === true && typeof source.stream === "function";
  const yieldToQueue =
    options.yieldToQueue ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const tables = new Map<string, TableEntry>();
  const memos = new Map<SectionId, Memo>();
  let mergeMemo: {
    key: string;
    sections: SectionResults;
    result: ReturnType<typeof mergeSections>;
  } | null = null;
  let latestRequest = 0;
  let buildRevision = 0;
  let progressActive = false;
  let latestPmo: PortableMicrohaplotypeObject | null = null;
  /** The working PMO: a PMO file opened to look over, subset or export, apart from the draft. */
  let held: WorkingPmoHeld = NOTHING_HELD;
  /** The latest PMO's files, made when first asked for, by format (gzipped or not). */
  const fileCache = createPmoFormatCache<Promise<PmoFile>>((pmo, gzip) => exportPmo(pmo, { gzip }));
  /** The latest PMO's file sizes, counted from the stream without keeping a Blob. */
  const sizeCache = createPmoFormatCache<
    Promise<{ readonly fileName: string; readonly size: number }>
  >((pmo, gzip) => {
    const fileName = pmoFileName(pmo, gzip);
    return measurePmoSize(pmo, { gzip }).then((size) => ({ fileName, size }));
  });
  /** The last preview, so asking again for the same build does not write the whole PMO again. */
  let previewMemo: {
    readonly pmo: PortableMicrohaplotypeObject;
    readonly maxLength: number | undefined;
    readonly preview: PmoTextPreview;
  } | null = null;
  let suggestionsMemo: {
    readonly sources: readonly (SectionResult<SectionId> | undefined)[];
    readonly value: Suggestions;
  } | null = null;

  const parseEntry = async (entry: TableEntry): Promise<ParsedFile> =>
    parse(
      entry.source,
      entry.fileName,
      entry.sheetName === null ? undefined : { sheetName: entry.sheetName },
    );

  const ensureParsed = async (id: string): Promise<void> => {
    const entry = tables.get(id);
    if (entry === undefined) return;
    if (entry.state.kind === "parsing") {
      await entry.state.promise;
      return;
    }
    if (entry.state.kind !== "pending") return;
    const promise = (async () => {
      try {
        if (entry.stream) {
          const inspection = await inspectDelimitedStream(entry.source, {
            fileName: entry.fileName,
          });
          if (inspection.kind === "delimited") {
            entry.state = {
              kind: "streamed",
              meta: inspection.meta,
              exactRowCount: inspection.meta.exactRowCount,
              runNameValues: null,
            };
          } else {
            const parsed = await parseEntry(entry);
            entry.state = { kind: "ready", parsed };
          }
        } else {
          const parsed = await parseEntry(entry);
          entry.state = { kind: "ready", parsed };
        }
      } catch (error) {
        entry.state = {
          kind: "failed",
          message: isImportError(error)
            ? importFailureMessage(failureOf(error))
            : describeError(error),
        };
      }
      entry.revision += 1;
    })();
    entry.state = { kind: "parsing", promise };
    await promise;
  };

  const lookup: TableLookup = (id): TableLookupResult => {
    const entry = tables.get(id);
    if (entry === undefined) return { kind: "missing" };
    switch (entry.state.kind) {
      case "ready":
        return { kind: "ready", table: entry.state.parsed.table };
      case "failed":
        return { kind: "failed", message: entry.state.message };
      case "pending":
      case "parsing":
      case "streamed":
        return { kind: "missing" };
      default:
        return { kind: "missing" };
    }
  };

  const tableKey = (id: string): string => {
    const entry = tables.get(id);
    return entry === undefined ? `${id}:missing` : `${id}@${entry.revision}:${entry.state.kind}`;
  };

  /**
   * The suggestions, worked out again only when a section they read from was
   * built afresh: they scan whole columns, which is slow for a large table.
   */
  const suggestionsFor = (
    draft: Draft,
    results: ReadonlyMap<SectionId, SectionResult<SectionId>>,
  ): Suggestions => {
    const sources = SUGGESTION_SOURCES.map((section) => results.get(section));
    if (
      suggestionsMemo !== null &&
      sources.every((result, index) => result === suggestionsMemo?.sources[index])
    ) {
      return suggestionsMemo.value;
    }
    let value = draftSuggestions(draft, lookup);
    const mhap = draft.microhaplotypes;
    if (mhap.runName.mode === "column" && mhap.runName.column !== null && mhap.table !== null) {
      const entry = tables.get(mhap.table.table.id);
      if (
        entry !== undefined &&
        entry.state.kind === "streamed" &&
        entry.state.runNameValues !== null &&
        entry.state.runNameValues.column === mhap.runName.column
      ) {
        value = { ...value, runNames: entry.state.runNameValues.values };
      }
    }
    suggestionsMemo = { sources, value };
    return value;
  };

  return {
    async importFile(input) {
      const entry: TableEntry = {
        id: newId(),
        fileName: input.fileName,
        source: input.file,
        stream: shouldStream(input.stream, input.file),
        sheetName: input.sheetName ?? null,
        revision: 0,
        state: { kind: "pending" },
      };
      try {
        if (entry.stream) {
          const inspection = await inspectDelimitedStream(entry.source, {
            fileName: entry.fileName,
          });
          if (inspection.kind === "delimited") {
            entry.state = {
              kind: "streamed",
              meta: inspection.meta,
              exactRowCount: inspection.meta.exactRowCount,
              runNameValues: null,
            };
            entry.sheetName = null;
            tables.set(entry.id, entry);
            return { kind: "imported", table: toStreamedRef(entry, inspection.meta) };
          }
        }
        const parsed = await parseEntry(entry);
        entry.state = { kind: "ready", parsed };
        entry.sheetName = parsed.sheetName;
        tables.set(entry.id, entry);
        return { kind: "imported", table: toRef(entry, parsed) };
      } catch (error) {
        return importFailed(failureOf(error), input.fileName);
      }
    },

    restoreFile(input) {
      const previous = tables.get(input.tableId);
      tables.set(input.tableId, {
        id: input.tableId,
        fileName: input.fileName,
        source: input.file,
        stream: shouldStream(input.stream, input.file),
        sheetName: input.sheetName,
        revision: (previous?.revision ?? 0) + 1,
        state: { kind: "pending" },
      });
      return Promise.resolve();
    },

    async chooseSheet(tableId, sheetName) {
      const entry = tables.get(tableId);
      if (entry === undefined) return importFailed({ code: "not-loaded" }, "");
      try {
        const parsed = await parse(entry.source, entry.fileName, { sheetName });
        entry.sheetName = parsed.sheetName;
        entry.state = { kind: "ready", parsed };
        entry.revision += 1;
        return { kind: "imported", table: toRef(entry, parsed) };
      } catch (error) {
        return importFailed(failureOf(error), entry.fileName);
      }
    },

    dropTable(tableId) {
      tables.delete(tableId);
      return Promise.resolve();
    },

    async previewRows(request) {
      await ensureParsed(request.tableId);
      const entry = tables.get(request.tableId);
      if (entry === undefined) return { kind: "missing" };
      const offset = Math.max(0, request.offset ?? 0);
      const limit = Math.max(0, request.limit ?? 50);
      if (entry.state.kind === "streamed") {
        const { meta } = entry.state;
        const allCached =
          meta.exactRowCount !== null && meta.previewRows.length >= meta.exactRowCount;
        if (limit === 0 || allCached || offset + limit <= meta.previewRows.length) {
          return {
            kind: "ready",
            columns: meta.columns,
            rows: meta.previewRows.slice(offset, offset + limit),
            offset,
            totalRows: entry.state.exactRowCount,
          };
        }
        const rows: RawRow[] = [];
        let seen = 0;
        try {
          for await (const chunk of streamDelimitedChunks(entry.source, {
            fileName: entry.fileName,
            delimiter: meta.delimiter,
            encoding: meta.encoding,
            columns: meta.columns,
            chunkSize: Math.max(limit, 1_000),
          })) {
            const chunkEnd = seen + chunk.length;
            if (chunkEnd > offset) {
              const start = Math.max(0, offset - seen);
              for (let i = start; i < chunk.length && rows.length < limit; i += 1) {
                const row = chunk[i];
                if (row !== undefined) rows.push(row);
              }
            }
            seen = chunkEnd;
            if (rows.length >= limit) break;
          }
        } catch (error) {
          return {
            kind: "failed",
            message: isImportError(error)
              ? importFailureMessage(failureOf(error))
              : describeError(error),
          };
        }
        return {
          kind: "ready",
          columns: meta.columns,
          rows,
          offset,
          totalRows: entry.state.exactRowCount,
        };
      }
      const found = lookup(request.tableId);
      if (found.kind !== "ready") return found;
      return {
        kind: "ready",
        columns: found.table.columns,
        rows: found.table.rows.slice(offset, offset + limit),
        offset,
        totalRows: found.table.rows.length,
      };
    },

    async distinctValues(request) {
      await ensureParsed(request.tableId);
      const entry = tables.get(request.tableId);
      if (entry === undefined) return null;
      if (entry.state.kind === "streamed") {
        if (!entry.state.meta.columns.includes(request.column)) return null;
        try {
          return await streamDistinctValues(entry.source, {
            fileName: entry.fileName,
            delimiter: entry.state.meta.delimiter,
            encoding: entry.state.meta.encoding,
            column: request.column,
            limit: request.limit ?? 200,
          });
        } catch {
          return null;
        }
      }
      const found = lookup(request.tableId);
      if (found.kind !== "ready" || !found.table.columns.includes(request.column)) return null;
      return columnDistinctValues(found.table, request.column, request.limit ?? 200);
    },

    async build(draft, buildOptions = {}) {
      latestRequest += 1;
      const request = latestRequest;
      const superseded = (): boolean => request !== latestRequest;
      const reportProgress = (progress: BuildProgress): void => {
        if (superseded()) return;
        progressActive = progress.phase !== "idle";
        options.onProgress?.(progress);
      };

      try {
        await Promise.all(referencedTableIds(draft).map((id) => ensureParsed(id)));
        await yieldToQueue();
        if (superseded()) return { kind: "superseded" };

        const context = { tables: lookup, deps };
        const rebuilt: SectionId[] = [];
        const results = new Map<SectionId, SectionResult<SectionId>>();
        for (const section of SECTION_IDS) {
          const input = sectionInput(draft, section, buildOptions);
          const tableKeys = sectionTableIds(draft, section).map(tableKey).join(",");
          const memo = memos.get(section);
          if (memo !== undefined && memo.tables === tableKeys && sameInput(memo.input, input)) {
            results.set(section, memo.result);
            continue;
          }
          if (section === "microhaplotypes" && draft.microhaplotypes.table !== null) {
            const entry = tables.get(draft.microhaplotypes.table.table.id);
            if (entry !== undefined && entry.state.kind === "streamed") {
              const streamedState = entry.state;
              // oxlint-disable-next-line no-await-in-loop -- sections build in order; only a streamed allele table is async
              const streamed = await buildMicrohaplotypesStream({
                section: draft.microhaplotypes,
                source: { kind: "ready", blob: entry.source, meta: streamedState.meta },
                deps,
                onProgress: (progress) => reportProgress({ phase: "reading", ...progress }),
                isSuperseded: superseded,
              });
              if (streamed.kind === "superseded" || superseded()) return { kind: "superseded" };
              if (streamed.totalRows > 0) {
                streamedState.exactRowCount = streamed.totalRows;
                if (
                  draft.microhaplotypes.runName.mode === "column" &&
                  draft.microhaplotypes.runName.column !== null
                ) {
                  streamedState.runNameValues = {
                    column: draft.microhaplotypes.runName.column,
                    values: streamed.runNameValues,
                  };
                }
              }
              memos.set(section, { input, tables: tableKeys, result: streamed.result });
              results.set(section, streamed.result);
              rebuilt.push(section);
              continue;
            }
          }
          const result = buildSection(section, draft, context);
          memos.set(section, { input, tables: tableKeys, result });
          results.set(section, result);
          rebuilt.push(section);
        }
        const sections = collect(results);
        await yieldToQueue();
        if (superseded()) return { kind: "superseded" };

        // If Pass 1 was skipped on a header-only mapping error, still gather run-name suggestions by streaming.
        const mhap = draft.microhaplotypes;
        if (mhap.runName.mode === "column" && mhap.runName.column !== null && mhap.table !== null) {
          const entry = tables.get(mhap.table.table.id);
          const runColumn = mhap.runName.column;
          if (
            entry !== undefined &&
            entry.state.kind === "streamed" &&
            entry.state.meta.columns.includes(runColumn) &&
            entry.state.runNameValues?.column !== runColumn
          ) {
            try {
              const distinct = await streamDistinctValues(entry.source, {
                fileName: entry.fileName,
                delimiter: entry.state.meta.delimiter,
                encoding: entry.state.meta.encoding,
                column: runColumn,
                isSuperseded: superseded,
              });
              if (superseded()) return { kind: "superseded" };
              entry.state.runNameValues = { column: runColumn, values: distinct.values };
            } catch {
              // Ignore suggestion-read failures; the section already reports any file error.
            }
          }
        }

        const creationDate = buildOptions.creationDate ?? today();
        const reuse =
          mergeMemo !== null &&
          mergeMemo.key === creationDate &&
          SECTION_IDS.every((id) => mergeMemo?.sections[id] === sections[id]);
        const merge =
          reuse && mergeMemo !== null
            ? mergeMemo.result
            : mergeSections(sections, { creationDate });
        mergeMemo = { key: creationDate, sections, result: merge };
        latestPmo = merge.outcome.kind === "built" ? merge.outcome.pmo : null;
        fileCache.clearIfNot(latestPmo);
        sizeCache.clearIfNot(latestPmo);
        if (previewMemo !== null && previewMemo.pmo !== latestPmo) previewMemo = null;

        buildRevision += 1;
        return {
          kind: "built",
          view: {
            revision: buildRevision,
            sections: {
              microhaplotypes: view(sections.microhaplotypes, merge.notices),
              panel: view(sections.panel, merge.notices),
              specimens: view(sections.specimens, merge.notices),
              librarySamples: view(sections.librarySamples, merge.notices),
              project: view(sections.project, merge.notices),
              sequencing: view(sections.sequencing, merge.notices),
              bioinformatics: view(sections.bioinformatics, merge.notices),
              readCounts: view(sections.readCounts, merge.notices),
            },
            overall: {
              status: merge.status,
              notices: merge.notices,
              summary: merge.outcome.kind === "built" ? merge.outcome.summary : null,
              publication: merge.outcome.kind === "built" ? merge.outcome.publication : null,
              pmo:
                merge.outcome.kind === "built"
                  ? merge.outcome.valid
                    ? "valid"
                    : "invalid"
                  : "none",
              schemaErrors: merge.outcome.kind === "built" ? merge.outcome.schemaErrors : 0,
            },
            suggestions: suggestionsFor(draft, results),
            rebuilt,
          },
        };
      } finally {
        if (!superseded() && progressActive) {
          progressActive = false;
          options.onProgress?.({ phase: "idle" });
        }
      }
    },

    async getPmoFile(fileOptions = {}) {
      const pmo = latestPmo;
      if (pmo === null) return null;
      return fileCache.getOrCreate(pmo, fileOptions.gzip ?? true);
    },

    async getPmoFileSize(fileOptions = {}) {
      const pmo = latestPmo;
      if (pmo === null) return null;
      const gzip = fileOptions.gzip ?? true;
      const existing = fileCache.peek(pmo, gzip);
      if (existing !== undefined) {
        const file = await existing;
        return { fileName: file.fileName, size: file.blob.size };
      }
      return sizeCache.getOrCreate(pmo, gzip);
    },

    getPmoText(textOptions = {}) {
      const pmo = latestPmo;
      if (pmo === null) return Promise.resolve(null);
      const maxLength = textOptions.maxLength;
      if (previewMemo === null || previewMemo.pmo !== pmo || previewMemo.maxLength !== maxLength) {
        previewMemo = { pmo, maxLength, preview: previewPmo(pmo, maxLength) };
      }
      return Promise.resolve(previewMemo.preview);
    },

    async workingPmo(call) {
      const step = answerWorkingPmo(held, call);
      held = step.held;
      const work = await step.work;
      const settled = settleWorkingPmo({ held, call, work });
      held = settled.held;
      return settled.result;
    },

    getPanelFragment(panelId) {
      const panel = memos.get("panel")?.result;
      if (panel === undefined || panel.section !== "panel") return Promise.resolve(null);
      const fragment = sectionFragment(panel, panelId);
      return Promise.resolve(fragment === undefined ? null : toJsonValue(fragment));
    },

    dispose() {
      tables.clear();
      memos.clear();
      mergeMemo = null;
      latestPmo = null;
      fileCache.clear();
      sizeCache.clear();
      previewMemo = null;
      suggestionsMemo = null;
      held = NOTHING_HELD;
      if (progressActive) {
        progressActive = false;
        options.onProgress?.({ phase: "idle" });
      }
      return Promise.resolve();
    },
  };
}

function draftSuggestions(draft: Draft, lookup: TableLookup): Suggestions {
  try {
    return collectSuggestions(draft, lookup);
  } catch {
    return NO_SUGGESTIONS;
  }
}

function sectionFragment(result: SectionResult<SectionId>, panelId: string): unknown {
  const fragment: unknown = result.fragment;
  if (typeof fragment !== "object" || fragment === null || !("byPanel" in fragment))
    return undefined;
  const byPanel: unknown = fragment.byPanel;
  if (typeof byPanel !== "object" || byPanel === null) return undefined;
  return Object.getOwnPropertyDescriptor(byPanel, panelId)?.value;
}

/** Puts per-section results back into a typed record, checking each one's section. */
function collect(results: ReadonlyMap<SectionId, SectionResult<SectionId>>): SectionResults {
  const pick = <S extends SectionId>(id: S): SectionResult<S> => {
    const result = results.get(id);
    if (result === undefined || !isResultFor(result, id))
      throw new Error(`Section ${id} was not built`);
    return result;
  };
  return {
    microhaplotypes: pick("microhaplotypes"),
    panel: pick("panel"),
    specimens: pick("specimens"),
    librarySamples: pick("librarySamples"),
    project: pick("project"),
    sequencing: pick("sequencing"),
    bioinformatics: pick("bioinformatics"),
    readCounts: pick("readCounts"),
  };
}

function isResultFor<S extends SectionId>(
  result: SectionResult<SectionId>,
  id: S,
): result is SectionResult<S> {
  return result.section === id;
}
