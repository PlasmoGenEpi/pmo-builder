/**
 * Usage counts for PMO Builder.
 *
 * Feature code calls the `record*` functions. They are cheap, safe to call
 * anywhere and never throw. Nothing leaves the browser unless the build sets
 * `VITE_ANALYTICS_URL`, and even then not when the browser sends Global
 * Privacy Control or Do Not Track, or the user has switched it off.
 *
 * The app shell calls `initAnalytics()` once at start-up. See
 * `docs/analytics.md` for what is collected and why.
 */
import { createAnalytics } from "./analytics";
import type { AnalyticsEnvironment, TransparencyEntry, TransparencySnapshot } from "./analytics";
import { createAnalyticsHooks } from "./hooks";
import type { AnalyticsPreference } from "./hooks";
import type { BuildOutcome, Download, Issue, TableImport, ValidationOutcome } from "./session";
import { PREFERENCE_KEY } from "./status";
import type { AnalyticsStatus } from "./status";
import type {
  AnalyticsPage,
  AnalyticsSection,
  AnalyticsSectionStatus,
  AnalyticsStep,
  AnalyticsTable,
  DepositOutcome,
  FileCheckResult,
  PublishSource,
} from "./vocabulary";

export type { AnalyticsPreference } from "./hooks";
export type { AnalyticsRecord, SessionRecord, VisitRecord } from "./payload";
export type { AnalyticsOffReason, AnalyticsStatus } from "./status";
export type { BuildOutcome, Download, Issue, TableImport, ValidationOutcome } from "./session";
export type { TransparencyEntry, TransparencySnapshot } from "./analytics";
export type {
  AnalyticsPage,
  AnalyticsSection,
  AnalyticsSectionStatus,
  AnalyticsStep,
  AnalyticsTable,
  DepositOutcome,
  FileCheckResult,
  PublishSource,
  DownloadKind,
  FileFormat,
  ImportRoute,
  IssueSeverity,
} from "./vocabulary";
export { fileFormatFromName } from "./formats";

function readStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function browserEnvironment(): AnalyticsEnvironment {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    destination: import.meta.env.VITE_ANALYTICS_URL,
    appVersion: import.meta.env.PMO_BUILDER_VERSION,
    signals:
      nav === undefined
        ? undefined
        : {
            globalPrivacyControl: Reflect.get(nav, "globalPrivacyControl"),
            doNotTrack: Reflect.get(nav, "doNotTrack"),
          },
    storage: readStorage(),
    sendBeacon:
      typeof nav?.sendBeacon === "function" ? (url, body) => nav.sendBeacon(url, body) : undefined,
    fetch: typeof fetch === "function" ? (url, init) => fetch(url, init) : undefined,
    now: () => performance.now(),
    onPageHidden: (callback) => {
      if (typeof document === "undefined" || typeof window === "undefined") return;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") callback();
      });
      window.addEventListener("pagehide", callback);
    },
    onPreferenceChanged: (callback) => {
      if (typeof window === "undefined") return;
      window.addEventListener("storage", (change) => {
        if (change.key === PREFERENCE_KEY || change.key === null) callback();
      });
    },
  };
}

const analytics = createAnalytics(browserEnvironment());
const hooks = createAnalyticsHooks(analytics);

/** Sends the visit record and starts watching for the page being closed. Call once at start-up. */
export function initAnalytics(): void {
  analytics.start();
}

/** Records that the user opened a step. Call on every navigation; repeats are counted once. */
export function recordStepOpened(step: AnalyticsStep): void {
  analytics.recordStepOpened(step);
}

/**
 * Records that a table was imported. Pass raw row and column counts; only
 * coarse buckets are kept. Use `fileFormatFromName` for `format` and `gzip`.
 */
/** Counts a page outside the builder's steps being opened. */
export function recordPageOpened(page: AnalyticsPage): void {
  analytics.recordPageOpened(page);
}

/** Counts the publish dialog being opened. */
export function recordPublishOpened(source: PublishSource): void {
  analytics.recordPublishOpened(source);
}

/** Counts a deposit on Zenodo being started. */
export function recordDepositStarted(source: PublishSource): void {
  analytics.recordDepositStarted(source);
}

/** Counts how a deposit on Zenodo ended. */
export function recordDepositFinished(outcome: DepositOutcome): void {
  analytics.recordDepositFinished(outcome);
}

/** Counts what checking a PMO file on the publish page found. */
export function recordFileChecked(result: FileCheckResult): void {
  analytics.recordFileChecked(result);
}

export function recordTableImported(input: TableImport): void {
  analytics.recordTableImported(input);
}

/** Records that the user changed an automatic column match for a table. */
export function recordMappingEdited(table: AnalyticsTable): void {
  analytics.recordMappingEdited(table);
}

/** Records the current status of a section. The last value in a session is reported. */
export function recordSectionStatus(
  section: AnalyticsSection,
  status: AnalyticsSectionStatus,
): void {
  analytics.recordSectionStatus(section, status);
}

/** Records that a PMO build finished or failed. */
export function recordBuild(input: BuildOutcome): void {
  analytics.recordBuild(input);
}

/** Records a schema validation and how many errors it found. */
export function recordValidation(input: ValidationOutcome): void {
  analytics.recordValidation(input);
}

/** Records a PMO download. Pass the size in bytes; only a bucket is kept. */
export function recordDownload(input: Download): void {
  analytics.recordDownload(input);
}

/**
 * Records an error or warning by its stable code, such as `PmoError.code`.
 * Never pass a message. Unknown codes are counted as `<module>/other` or `other`.
 */
export function recordIssue(input: Issue): void {
  analytics.recordIssue(input);
}

/** Records that a saved draft was restored on load. */
export function recordDraftRestored(): void {
  analytics.recordDraftRestored();
}

/** Whether usage counts are sent, and if not, why not. */
export function getAnalyticsStatus(): AnalyticsStatus {
  return analytics.getStatus();
}

/** Sets the user's own switch. Stored in `localStorage` under `pmo-builder:usage-counts`. */
export function setAnalyticsEnabled(enabled: boolean): void {
  analytics.setEnabledByUser(enabled);
}

/** Every record sent, or that would have been sent, during this page load, with its exact body. */
export function getTransparencyLog(): readonly TransparencyEntry[] {
  return analytics.getTransparencySnapshot().entries;
}

/** The session record as it stands now, as the exact JSON that would be sent, or `null`. */
export function previewSessionSummary(): string | null {
  return analytics.getTransparencySnapshot().pending;
}

/** The current status. Re-renders when the user changes the switch. */
export function useAnalyticsStatus(): AnalyticsStatus {
  return hooks.useAnalyticsStatus();
}

/** The user's own switch and a setter, for a settings control. */
/**
 * Whether to ask the user about usage counts: they are set up, the browser
 * does not refuse them, and the user has not chosen. Until they choose,
 * nothing is sent.
 */
export function useUsageChoiceNeeded(): boolean {
  return hooks.useUsageChoiceNeeded();
}

export function useAnalyticsPreference(): AnalyticsPreference {
  return hooks.useAnalyticsPreference();
}

/** The transparency log and the pending session record. Re-renders as they change. */
export function useTransparencyLog(): TransparencySnapshot {
  return hooks.useTransparencyLog();
}
