/**
 * The two records that may leave the browser.
 *
 * Every property is a boolean, a member of a fixed list, or a bucket label.
 * Nothing is typed `string` or `number`, so a file name, a column name or a
 * cell value has nowhere to go. The JSON Schema in
 * `docs/analytics-payload.schema.json` is generated from the same lists.
 *
 * There are no identifiers and no timestamps. A visit record and a session
 * record from the same page load share nothing that links them.
 */
import type { ColumnBucket, CountBucket, DurationBucket, RowBucket, SizeBucket } from "./buckets";
import type { IssueCode } from "./codes";
import type {
  AnalyticsSection,
  AnalyticsSectionStatus,
  AnalyticsStep,
  AnalyticsTable,
  DownloadKind,
  FileFormat,
  ImportRoute,
  IssueSeverity,
  ValidationResult,
} from "./vocabulary";

/** Bumped when the shape of a record changes. */
export const PAYLOAD_VERSION = 1;

/**
 * The app version as `major.minor.patch`, or `unknown`. Only `toAppVersion`
 * in `version.ts` can produce one.
 */
export type AppVersion = "unknown" | (string & { readonly __brand: "AppVersion" });

/** Sent once when the app loads. */
export interface VisitRecord {
  readonly v: typeof PAYLOAD_VERSION;
  readonly kind: "visit";
  readonly app: AppVersion;
}

/** One imported table. */
export interface ImportSummary {
  readonly route: ImportRoute;
  readonly format: FileFormat;
  readonly gzip: boolean;
  readonly rows: RowBucket;
  readonly columns: ColumnBucket;
}

/** What happened to one kind of table during the session. */
export interface TableSummary {
  /** The last import of this kind of table, or `null` if none this session. */
  readonly import: ImportSummary | null;
  /** Whether the user changed the automatic column matches. */
  readonly mappingEdited: boolean;
}

/** Builds, validation and downloads during the session. */
export interface BuildSummary {
  readonly built: CountBucket;
  readonly failed: CountBucket;
  readonly validation: ValidationResult;
  /** Schema errors found by the last validation. `0` when it was not run. */
  readonly schemaErrors: CountBucket;
  readonly downloads: Readonly<Record<DownloadKind, CountBucket>>;
  /** Size of the last download, or `null` when nothing was downloaded. */
  readonly downloadSize: SizeBucket | null;
}

/** How often one code was seen. */
export interface IssueCount {
  readonly code: IssueCode;
  readonly severity: IssueSeverity;
  readonly count: CountBucket;
}

/** Sent at most once per page load, when the page is hidden or closed. */
export interface SessionRecord {
  readonly v: typeof PAYLOAD_VERSION;
  readonly kind: "session";
  readonly app: AppVersion;
  /** Steps opened, in navigation order, each once. */
  readonly steps: readonly AnalyticsStep[];
  readonly tables: Partial<Readonly<Record<AnalyticsTable, TableSummary>>>;
  /** The last status the app reported for each section. */
  readonly sections: Partial<Readonly<Record<AnalyticsSection, AnalyticsSectionStatus>>>;
  readonly build: BuildSummary;
  /** Sorted by code, at most `MAX_ISSUES` entries. */
  readonly issues: readonly IssueCount[];
  readonly draftRestored: boolean;
  readonly duration: DurationBucket;
}

/** Either record. */
export type AnalyticsRecord = VisitRecord | SessionRecord;

/** The most distinct codes a session record lists. The rest are counted as `other`. */
export const MAX_ISSUES = 32;
