/**
 * The fixed words a usage record may contain.
 *
 * Every value in a record comes from one of these lists, from a bucket label
 * in `buckets.ts`, or from the issue code list in `codes.ts`. The lists are
 * repeated here rather than imported from `@/domain` so that this module has
 * no runtime dependency on the domain. `vocabulary.test.ts` checks at compile
 * time that they still match the domain types.
 */

/** Sections of a PMO, one per step. Mirrors `SECTION_IDS` in `@/domain/types`. */
export const SECTIONS = [
  "microhaplotypes",
  "panel",
  "specimens",
  "librarySamples",
  "project",
  "sequencing",
  "bioinformatics",
  "readCounts",
] as const;

/** A section of the PMO. */
export type AnalyticsSection = (typeof SECTIONS)[number];

/** Pages a user can open: every section, plus home and the review step. */
export const STEPS = ["home", ...SECTIONS, "review"] as const;

/** A page a user can open. */
export type AnalyticsStep = (typeof STEPS)[number];

/** Pages outside the builder's steps. A dataset page is counted, never which dataset. */
export const PAGES = ["published", "dataset", "publish-file", "pmo-tools"] as const;

/** A page outside the builder's steps. */
export type AnalyticsPage = (typeof PAGES)[number];

/** Where the PMO being published came from: built from the draft, or a file the user chose. */
export const PUBLISH_SOURCES = ["built", "file"] as const;

/** Where the PMO being published came from. */
export type PublishSource = (typeof PUBLISH_SOURCES)[number];

/** How a deposit on Zenodo ended. */
export const DEPOSIT_OUTCOMES = [
  "draft-ready",
  "cancelled",
  "pop-up-blocked",
  "sign-in-refused",
  "sign-in-timed-out",
  "signed-out",
  "not-allowed",
  "no-community",
  "too-large",
  "offline",
  "refused",
  "no-record",
  "not-owner",
  "other-community",
  "failed",
] as const;

/** How a deposit ended. */
export type DepositOutcome = (typeof DEPOSIT_OUTCOMES)[number];

/** What checking a PMO file on the publish page found. */
export const FILE_CHECK_RESULTS = [
  "ready",
  "example",
  "too-large",
  "unreadable",
  "not-pmo",
  "wrong-version",
  "invalid",
  "failed",
] as const;

/** What checking a PMO file found. */
export type FileCheckResult = (typeof FILE_CHECK_RESULTS)[number];

/** Kinds of table a user can import. Mirrors `FIELD_SET_IDS` in `@/domain/types`. */
export const TABLES = [
  "microhaplotypes",
  "panelTargets",
  "genomes",
  "specimens",
  "librarySamples",
  "project",
  "sequencing",
  "bioinformaticsMethods",
  "bioinformaticsRuns",
  "readCountTotals",
  "readCountsByStage",
] as const;

/** A kind of table. */
export type AnalyticsTable = (typeof TABLES)[number];

/** Where each section stands. Mirrors `SectionStatus` in `@/domain/types`. */
export const SECTION_STATUSES = ["empty", "incomplete", "ready", "error"] as const;

/** Where a section stands. */
export type AnalyticsSectionStatus = (typeof SECTION_STATUSES)[number];

/** How a table got into the app. */
export const IMPORT_ROUTES = ["upload", "example", "saved-panel"] as const;

/** How a table got into the app. */
export type ImportRoute = (typeof IMPORT_ROUTES)[number];

/** The file formats the app reads, plus `other` for anything else. */
export const FILE_FORMATS = ["csv", "tsv", "txt", "xlsx", "other"] as const;

/** A file format. */
export type FileFormat = (typeof FILE_FORMATS)[number];

/** How a PMO file was downloaded. */
export const DOWNLOAD_KINDS = ["plain", "gzip"] as const;

/** How a PMO file was downloaded. */
export type DownloadKind = (typeof DOWNLOAD_KINDS)[number];

/** The result of the last schema validation in a session. */
export const VALIDATION_RESULTS = ["not-run", "valid", "invalid"] as const;

/** The result of the last schema validation. */
export type ValidationResult = (typeof VALIDATION_RESULTS)[number];

/** How serious an issue is. */
export const ISSUE_SEVERITIES = ["error", "warning"] as const;

/** How serious an issue is. */
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/** True when `value` is one of the members of `list`. Narrows `unknown`. */
export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && list.some((member) => member === value);
}
