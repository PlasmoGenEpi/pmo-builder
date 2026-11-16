/**
 * The engine's interface and the data that crosses the worker boundary.
 *
 * Types only: the main thread imports this module, and it must not pull in
 * the engine itself (or pmotools-ts) at run time.
 */
import type {
  DistinctValues,
  MergeSummary,
  PublicationSummary,
  PmoFile,
  PmoFileCheck,
  SectionSummaries,
  Suggestions,
  BuildDeps,
} from "@/domain/build";
import type { Draft, JsonValue, TableRef } from "@/domain/draft";
import type {
  GroupComparison,
  GroupKey,
  PmoSummary,
  SubsetOutcome,
  SubsetPreview,
  SubsetRequest,
  TableFile,
  TableFormat,
  TableId,
  TablesArchive,
  WorkingPmoAnswer,
  WorkingPmoCall,
  WorkingPmoKind,
  WorkingSource,
} from "@/domain/tools/types";
import type { ImportFailure, parseFile } from "@/domain/import";
import type { Notice, RawRow, SectionId, SectionStatus } from "@/domain/types";

export type { ImportFailure, ImportFailureCode } from "@/domain/import";

/** A file to import. */
export interface ImportFileInput {
  readonly file: Blob;
  readonly fileName: string;
  /** Which sheet of a workbook to read. Defaults to the first. */
  readonly sheetName?: string;
}

/** What importing a file gives: its metadata for the draft, or why it could not be read. */
export type ImportOutcome =
  | { readonly kind: "imported"; readonly table: TableRef }
  | {
      readonly kind: "failed";
      /** For the user. Its `code` is `import/<failure code>`. */
      readonly notice: Notice;
      /** Why, as a code the interface can word (see `importFailureMessage`). */
      readonly failure: ImportFailure;
    };

/** A stored file to register again after a reload. It is parsed when first needed. */
export interface RestoreFileInput {
  readonly tableId: string;
  readonly file: Blob;
  readonly fileName: string;
  readonly sheetName: string | null;
}

/** Which rows of a table to preview. */
export interface PreviewRequest {
  readonly tableId: string;
  /** First row, 0-based. Default 0. */
  readonly offset?: number;
  /** Most rows. Default 50. */
  readonly limit?: number;
}

/** Rows of an imported table, as text. */
export type TablePreview =
  | {
      readonly kind: "ready";
      readonly columns: readonly string[];
      readonly rows: readonly RawRow[];
      readonly offset: number;
      readonly totalRows: number;
    }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly message: string };

/** Which column's values to list. */
export interface DistinctValuesRequest {
  readonly tableId: string;
  readonly column: string;
  /** Most values. Default 200. */
  readonly limit?: number;
}

/** What one section looks like to the main thread: no fragment. */
export interface SectionView<S extends SectionId = SectionId> {
  readonly status: SectionStatus;
  readonly notices: readonly Notice[];
  readonly summary: SectionSummaries[S] | null;
}

/** Every section's view. */
export type SectionViews = { readonly [S in SectionId]: SectionView<S> };

/** Whether a PMO was built, and whether it is valid. */
export type PmoAvailability = "none" | "valid" | "invalid";

/** The whole-draft part of a build. */
export interface OverallView {
  /** See `MergeResult.status`. */
  readonly status: SectionStatus;
  readonly notices: readonly Notice[];
  readonly summary: MergeSummary | null;
  /** Set whenever `summary` is. */
  readonly publication: PublicationSummary | null;
  /** `valid` or `invalid` when a PMO can be downloaded; `none` otherwise. */
  readonly pmo: PmoAvailability;
  /** How many problems the schema validation found. `0` when valid or when no PMO was built. */
  readonly schemaErrors: number;
}

/** One finished build, as the main thread sees it. */
export interface BuildView {
  /** Counts up with each finished build. */
  readonly revision: number;
  readonly sections: SectionViews;
  readonly overall: OverallView;
  readonly suggestions: Suggestions;
  /** Sections that were built afresh; the others were unchanged and reused. */
  readonly rebuilt: readonly SectionId[];
}

/** What a build request gives: the result, or word that a newer request replaced it. */
export type BuildOutcome =
  | { readonly kind: "built"; readonly view: BuildView }
  | { readonly kind: "superseded" };

/** Options for a build. */
export interface BuildRequestOptions {
  /** `pmo_header.creation_date`. Default: today, in local time. */
  readonly creationDate?: string;
  /**
   * A token for each section of the draft that stands for the section
   * object's identity on the caller's side: the same token means the very
   * same object, so that part of the draft has not changed. The worker client
   * sets these, because a draft that crosses to the worker arrives as a fresh
   * copy whose objects are all new. Without a token the engine compares the
   * section objects themselves.
   */
  readonly sectionTokens?: Readonly<Partial<Record<SectionId, string>>>;
}

/** A preview of the PMO's JSON text. */
export interface PmoTextPreview {
  readonly text: string;
  readonly truncated: boolean;
  /** Length of the whole text. */
  readonly length: number;
}

/**
 * The engine's interface. The in-thread engine and the worker client both
 * implement it, so callers do not know which they have.
 */
export interface Engine {
  /** Parses a file and keeps it. The new table's id is in the returned metadata. */
  importFile(input: ImportFileInput): Promise<ImportOutcome>;
  /** Registers a stored file under its old id. It is parsed again when first needed. */
  restoreFile(input: RestoreFileInput): Promise<void>;
  /** Reads another sheet of an imported workbook. The table keeps its id. */
  chooseSheet(tableId: string, sheetName: string): Promise<ImportOutcome>;
  /** Forgets an imported table. */
  dropTable(tableId: string): Promise<void>;
  /** Some rows of an imported table. */
  previewRows(request: PreviewRequest): Promise<TablePreview>;
  /** The distinct non-blank values of one column, capped. `null` when the table or column is not there. */
  distinctValues(request: DistinctValuesRequest): Promise<DistinctValues | null>;
  /**
   * Builds a draft. Sections whose part of the draft and tables did not
   * change are reused. A newer call supersedes an older one still running.
   */
  build(draft: Draft, options?: BuildRequestOptions): Promise<BuildOutcome>;
  /** The latest PMO as a file (gzipped by default), or `null` when none was built. */
  getPmoFile(options?: { readonly gzip?: boolean }): Promise<PmoFile | null>;
  /**
   * The name and size in bytes of the file {@link Engine.getPmoFile} would
   * give, or `null` when no PMO was built. The file is made once per build and
   * format and kept, so a download after this reuses it.
   */
  getPmoFileSize(options?: {
    readonly gzip?: boolean;
  }): Promise<{ readonly fileName: string; readonly size: number } | null>;
  /** The latest PMO as JSON text for a preview, or `null` when none was built. */
  getPmoText(options?: { readonly maxLength?: number }): Promise<PmoTextPreview | null>;
  /** One panel's built fragment, for saving to the library, or `null` when it has not built. */
  getPanelFragment(panelId: string): Promise<JsonValue | null>;
  /** Reads and checks a PMO file the user already has, for publishing. Leaves the draft alone. */
  checkPmoFile(file: Blob): Promise<PmoFileCheck>;
  /**
   * Carries every request about the working PMO: opening, closing, and
   * reading it. A request for an older generation than the newest open or
   * close is answered as stale. Opening a file lets go of the PMO held before,
   * before reading the new one.
   */
  workingPmo<K extends WorkingPmoKind>(call: WorkingPmoCall<K>): Promise<WorkingPmoAnswer<K>>;
  /** Makes a subset of the opened PMO and keeps it, replacing any earlier subset. */
  subsetPmo(request: SubsetRequest): Promise<SubsetOutcome>;
  /** What a subset of the opened PMO would keep, without making it. `null` when none is open. */
  previewSubset(request: SubsetRequest): Promise<SubsetPreview | null>;
  /** One table of the opened PMO or its subset, or `null` when there is none. */
  workingPmoTable(request: {
    readonly source: WorkingSource;
    readonly id: TableId;
    readonly format: TableFormat;
  }): Promise<TableFile | null>;
  /** Every table of the opened PMO or its subset in one zip, or `null` when there is none. */
  workingPmoTables(request: {
    readonly source: WorkingSource;
    readonly format: TableFormat;
  }): Promise<TablesArchive | null>;
  /**
   * The summary of the opened PMO or its subset, counting microhaplotypes with
   * at least `minReads` reads. `null` when there is none.
   */
  workingPmoSummary(request: {
    readonly source: WorkingSource;
    readonly minReads: number;
  }): Promise<PmoSummary | null>;
  /**
   * The opened PMO or its subset with its specimens grouped by `key`, counting
   * microhaplotypes with at least `minReads` reads. `null` when there is none.
   */
  workingPmoGroups(request: {
    readonly source: WorkingSource;
    readonly minReads: number;
    readonly key: GroupKey;
  }): Promise<GroupComparison | null>;
  /** The opened PMO's subset as a file, or `null` when none was made. */
  workingPmoFile(request: { readonly gzip: boolean }): Promise<PmoFile | null>;
  /** Releases the engine. A worker is terminated. */
  dispose(): Promise<void>;
}

/** Options for {@link createInThreadEngine}. */
export interface InThreadEngineOptions {
  /** Reads a file. Default: `parseFile` from `@/domain/import`. */
  readonly parseFile?: typeof parseFile;
  /** Default: the real import, fields and matching functions. */
  readonly deps?: BuildDeps;
  /** Lets queued messages run between build stages, so a newer build can supersede. Default: a zero timeout. */
  readonly yieldToQueue?: () => Promise<void>;
}
