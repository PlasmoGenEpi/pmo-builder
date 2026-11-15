/**
 * Collects what happens during one page load and turns it into a session
 * record. Pure: no DOM, no timers, no storage.
 *
 * Every method accepts anything at runtime. Input that does not fit the
 * vocabulary is dropped or counted as `other`, never copied.
 */
import { bucketColumns, bucketCount, bucketDuration, bucketRows, bucketSize } from "./buckets";
import type { CountBucket, SizeBucket } from "./buckets";
import { toIssueCode } from "./codes";
import type { IssueCode } from "./codes";
import { MAX_ISSUES, PAYLOAD_VERSION } from "./payload";
import type { AppVersion, ImportSummary, IssueCount, SessionRecord, TableSummary } from "./payload";
import {
  DEPOSIT_OUTCOMES,
  DOWNLOAD_KINDS,
  FILE_CHECK_RESULTS,
  PAGES,
  PUBLISH_SOURCES,
  FILE_FORMATS,
  IMPORT_ROUTES,
  ISSUE_SEVERITIES,
  SECTION_STATUSES,
  SECTIONS,
  STEPS,
  TABLES,
  isOneOf,
} from "./vocabulary";
import type {
  AnalyticsPage,
  AnalyticsSection,
  AnalyticsSectionStatus,
  AnalyticsStep,
  AnalyticsTable,
  DepositOutcome,
  DownloadKind,
  FileCheckResult,
  FileFormat,
  ImportRoute,
  IssueSeverity,
  PublishSource,
  ValidationResult,
} from "./vocabulary";

/** What `recordTableImported` takes. Raw counts are bucketed before they are kept. */
export interface TableImport {
  readonly table: AnalyticsTable;
  readonly route: ImportRoute;
  readonly format: FileFormat;
  /** Whether the file was gzip-compressed. */
  readonly gzip: boolean;
  readonly rows: number;
  readonly columns: number;
}

/** What `recordBuild` takes. */
export interface BuildOutcome {
  readonly outcome: "built" | "failed";
}

/** What `recordValidation` takes. */
export interface ValidationOutcome {
  /** How many schema errors the validator reported. `0` means valid. */
  readonly schemaErrors: number;
}

/** What `recordDownload` takes. */
export interface Download {
  readonly kind: DownloadKind;
  /** Size of the downloaded file in bytes. */
  readonly bytes: number;
}

/** What `recordIssue` takes. */
export interface Issue {
  /** A stable code such as `PmoError.code`. Never a message. */
  readonly code: string;
  readonly severity: IssueSeverity;
}

/** The running tally for one page load. */
export interface Session {
  stepOpened(step: unknown): void;
  pageOpened(page: unknown): void;
  publishOpened(source: unknown): void;
  depositStarted(source: unknown): void;
  depositFinished(outcome: unknown): void;
  fileChecked(result: unknown): void;
  tableImported(input: unknown): void;
  mappingEdited(table: unknown): void;
  sectionStatus(section: unknown, status: unknown): void;
  build(input: unknown): void;
  validation(input: unknown): void;
  download(input: unknown): void;
  issue(input: unknown): void;
  draftRestored(): void;
  /** Whether the user did anything worth a session record. */
  isActive(): boolean;
  /** The record for this session so far, or `null` when the user did nothing. */
  summarise(app: AppVersion, elapsedMilliseconds: number): SessionRecord | null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

interface IssueTally {
  readonly code: IssueCode;
  readonly severity: IssueSeverity;
  count: number;
}

/** Reads an import, or returns `null` when the table or route is not one we know. */
function readImport(input: unknown): [AnalyticsTable, ImportSummary] | null {
  if (!isRecord(input)) return null;
  const { table, route, format, gzip, rows, columns } = input;
  if (!isOneOf(TABLES, table) || !isOneOf(IMPORT_ROUTES, route)) return null;
  return [
    table,
    {
      route,
      format: isOneOf(FILE_FORMATS, format) ? format : "other",
      gzip: gzip === true,
      rows: bucketRows(rows),
      columns: bucketColumns(columns),
    },
  ];
}

/** The counts that happened, bucketed, in the order of `keys`. */
function countsOf<K extends string>(
  keys: readonly K[],
  counts: ReadonlyMap<K, number>,
): Partial<Record<K, CountBucket>> {
  const result: Partial<Record<K, CountBucket>> = {};
  for (const key of keys) {
    const count = counts.get(key);
    if (count !== undefined) result[key] = bucketCount(count);
  }
  return result;
}

/** Starts an empty tally. */
export function createSession(): Session {
  let active = false;
  const steps = new Set<AnalyticsStep>();
  const pages = new Set<AnalyticsPage>();
  const opened: Record<PublishSource, number> = { built: 0, file: 0 };
  const deposits: Record<PublishSource, number> = { built: 0, file: 0 };
  const outcomes = new Map<DepositOutcome, number>();
  const fileChecks = new Map<FileCheckResult, number>();
  const tables = new Map<AnalyticsTable, TableSummary>();
  const sections = new Map<AnalyticsSection, AnalyticsSectionStatus>();
  const issues = new Map<string, IssueTally>();
  let built = 0;
  let failed = 0;
  let validation: ValidationResult = "not-run";
  let schemaErrors = 0;
  const downloads: Record<DownloadKind, number> = { plain: 0, gzip: 0 };
  let downloadSize: SizeBucket | null = null;
  let restored = false;

  return {
    stepOpened(step) {
      if (!isOneOf(STEPS, step)) return;
      steps.add(step);
      active = true;
    },
    pageOpened(page) {
      if (!isOneOf(PAGES, page)) return;
      pages.add(page);
      active = true;
    },
    publishOpened(source) {
      if (!isOneOf(PUBLISH_SOURCES, source)) return;
      opened[source] += 1;
      active = true;
    },
    depositStarted(source) {
      if (!isOneOf(PUBLISH_SOURCES, source)) return;
      deposits[source] += 1;
      active = true;
    },
    depositFinished(outcome) {
      if (!isOneOf(DEPOSIT_OUTCOMES, outcome)) return;
      outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
      active = true;
    },
    fileChecked(result) {
      if (!isOneOf(FILE_CHECK_RESULTS, result)) return;
      fileChecks.set(result, (fileChecks.get(result) ?? 0) + 1);
      active = true;
    },
    tableImported(input) {
      const parsed = readImport(input);
      if (parsed === null) return;
      const [table, summary] = parsed;
      tables.set(table, { import: summary, mappingEdited: false });
      active = true;
    },
    mappingEdited(table) {
      if (!isOneOf(TABLES, table)) return;
      tables.set(table, { import: tables.get(table)?.import ?? null, mappingEdited: true });
      active = true;
    },
    sectionStatus(section, status) {
      if (!isOneOf(SECTIONS, section) || !isOneOf(SECTION_STATUSES, status)) return;
      sections.set(section, status);
    },
    build(input) {
      if (!isRecord(input)) return;
      if (input["outcome"] === "built") built += 1;
      else if (input["outcome"] === "failed") failed += 1;
      else return;
      active = true;
    },
    validation(input) {
      if (!isRecord(input)) return;
      const count = input["schemaErrors"];
      if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return;
      validation = count === 0 ? "valid" : "invalid";
      schemaErrors = count;
      active = true;
    },
    download(input) {
      if (!isRecord(input)) return;
      const kind = input["kind"];
      if (!isOneOf(DOWNLOAD_KINDS, kind)) return;
      downloads[kind] += 1;
      downloadSize = bucketSize(input["bytes"]);
      active = true;
    },
    issue(input) {
      if (!isRecord(input)) return;
      const severity = input["severity"];
      if (!isOneOf(ISSUE_SEVERITIES, severity)) return;
      let code = toIssueCode(input["code"]);
      if (!issues.has(`${severity} ${code}`) && issues.size >= MAX_ISSUES - 2) {
        // Keep two places for `other`, one per severity.
        code = "other";
      }
      const key = `${severity} ${code}`;
      const tally = issues.get(key);
      if (tally === undefined) issues.set(key, { code, severity, count: 1 });
      else tally.count += 1;
    },
    draftRestored() {
      restored = true;
    },
    isActive() {
      return active;
    },
    summarise(app, elapsedMilliseconds) {
      if (!active) return null;
      const issueList: IssueCount[] = [...issues.values()]
        .toSorted((a, b) =>
          a.code === b.code ? a.severity.localeCompare(b.severity) : a.code < b.code ? -1 : 1,
        )
        .map(({ code, severity, count }) => ({ code, severity, count: bucketCount(count) }));
      return {
        v: PAYLOAD_VERSION,
        kind: "session",
        app,
        steps: STEPS.filter((step) => steps.has(step)),
        pages: PAGES.filter((page) => pages.has(page)),
        tables: Object.fromEntries(
          TABLES.flatMap((table) => {
            const summary = tables.get(table);
            return summary === undefined ? [] : [[table, summary]];
          }),
        ),
        sections: Object.fromEntries(
          SECTIONS.flatMap((section) => {
            const status = sections.get(section);
            return status === undefined ? [] : [[section, status]];
          }),
        ),
        build: {
          built: bucketCount(built),
          failed: bucketCount(failed),
          validation,
          schemaErrors: bucketCount(schemaErrors),
          downloads: { plain: bucketCount(downloads.plain), gzip: bucketCount(downloads.gzip) },
          downloadSize,
        },
        publish: {
          opened: { built: bucketCount(opened.built), file: bucketCount(opened.file) },
          deposits: { built: bucketCount(deposits.built), file: bucketCount(deposits.file) },
          outcomes: countsOf(DEPOSIT_OUTCOMES, outcomes),
          fileChecks: countsOf(FILE_CHECK_RESULTS, fileChecks),
        },
        issues: issueList,
        draftRestored: restored,
        duration: bucketDuration(elapsedMilliseconds),
      };
    },
  };
}
