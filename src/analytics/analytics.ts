/**
 * The instrumentation itself, built from an explicit environment so tests can
 * run it without a browser. `index.ts` builds the one the app uses.
 */
import type { SessionRecord, VisitRecord } from "./payload";
import { PAYLOAD_VERSION } from "./payload";
import { createSession } from "./session";
import type { BuildOutcome, Download, Issue, TableImport, ValidationOutcome } from "./session";
import {
  computeStatus,
  parseDestination,
  readSwitchedOff,
  sameStatus,
  writeSwitchedOff,
} from "./status";
import type {
  AnalyticsOffReason,
  AnalyticsStatus,
  PreferenceStorage,
  PrivacySignals,
} from "./status";
import { transmit } from "./transport";
import type { BeaconSender, FetchSender } from "./transport";
import { toAppVersion } from "./version";
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

/** Everything the instrumentation reads from the outside world. */
export interface AnalyticsEnvironment {
  /** The raw `VITE_ANALYTICS_URL`, or `undefined`. */
  readonly destination: string | undefined;
  readonly appVersion: string | undefined;
  readonly signals: PrivacySignals | undefined;
  readonly storage: PreferenceStorage | undefined;
  readonly sendBeacon: BeaconSender | undefined;
  readonly fetch: FetchSender | undefined;
  /** Milliseconds from any fixed point. Used only to bucket the session length. */
  readonly now: () => number;
  /** Calls `callback` when the page is hidden or closed. */
  readonly onPageHidden: (callback: () => void) => void;
  /** Calls `callback` when another tab changes the stored preference. */
  readonly onPreferenceChanged: (callback: () => void) => void;
}

/** One record that was sent, or would have been sent, during this page load. */
export type TransparencyEntry =
  | {
      readonly kind: "visit" | "session";
      /** The exact request body. */
      readonly body: string;
      readonly outcome: "sent";
      /** The origin the record was sent to. */
      readonly destination: string;
    }
  | {
      readonly kind: "visit" | "session";
      /** The exact body that would have been sent. */
      readonly body: string;
      readonly outcome: "not-sent";
      readonly reason: AnalyticsOffReason;
    };

/** What the transparency view shows. */
export interface TransparencySnapshot {
  readonly entries: readonly TransparencyEntry[];
  /**
   * The session record as it stands now, which is what would be sent if the
   * page were closed now. `null` when the user has done nothing yet or the
   * record has already gone.
   */
  readonly pending: string | null;
}

/** The instrumentation for one page load. Every method is cheap and never throws. */
export interface Analytics {
  /** Sends the visit record and starts listening for the page being hidden. Runs once. */
  readonly start: () => void;
  readonly recordStepOpened: (step: AnalyticsStep) => void;
  readonly recordPageOpened: (page: AnalyticsPage) => void;
  readonly recordPublishOpened: (source: PublishSource) => void;
  readonly recordDepositStarted: (source: PublishSource) => void;
  readonly recordDepositFinished: (outcome: DepositOutcome) => void;
  readonly recordFileChecked: (result: FileCheckResult) => void;
  readonly recordTableImported: (input: TableImport) => void;
  readonly recordMappingEdited: (table: AnalyticsTable) => void;
  readonly recordSectionStatus: (section: AnalyticsSection, status: AnalyticsSectionStatus) => void;
  readonly recordBuild: (input: BuildOutcome) => void;
  readonly recordValidation: (input: ValidationOutcome) => void;
  readonly recordDownload: (input: Download) => void;
  readonly recordIssue: (input: Issue) => void;
  readonly recordDraftRestored: () => void;
  /** Sends the session record now, if there is one and it has not gone yet. */
  readonly flush: () => void;
  readonly getStatus: () => AnalyticsStatus;
  /** Whether the user's own switch is on. The browser can still turn sending off. */
  readonly isEnabledByUser: () => boolean;
  readonly setEnabledByUser: (enabled: boolean) => void;
  readonly getTransparencySnapshot: () => TransparencySnapshot;
  /** Calls `listener` after any change to the status or the transparency snapshot. */
  readonly subscribe: (listener: () => void) => () => void;
}

/** Runs `action`, swallowing any error, so a recording call can never break the app. */
function safely<A extends unknown[]>(action: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    try {
      action(...args);
    } catch {
      // Instrumentation must never get in the user's way.
    }
  };
}

/** Builds the instrumentation from an environment. */
export function createAnalytics(env: AnalyticsEnvironment): Analytics {
  const destination = parseDestination(env.destination);
  const app = toAppVersion(env.appVersion);
  const startedAt = env.now();
  const session = createSession();
  const listeners = new Set<() => void>();
  let started = false;
  let sessionSent = false;
  let entries: readonly TransparencyEntry[] = [];
  let version = 0;
  let snapshot: TransparencySnapshot | null = null;
  let snapshotVersion = -1;

  // Kept in memory as well as in storage, so the choice holds for this page
  // even when storage is blocked.
  let switchedOff = readSwitchedOff(env.storage);
  const readStatus = (): AnalyticsStatus =>
    computeStatus({ destination, signals: env.signals, switchedOff });
  let status = readStatus();

  const changed = (): void => {
    version += 1;
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A broken listener must not stop the others.
      }
    }
  };

  const refreshStatus = (): void => {
    switchedOff = readSwitchedOff(env.storage);
    const next = readStatus();
    if (sameStatus(next, status)) return;
    status = next;
    changed();
  };

  const emit = (record: VisitRecord | SessionRecord): void => {
    const body = JSON.stringify(record);
    const current = status;
    if (current.state === "on" && destination !== null && destination !== "invalid") {
      transmit({ url: destination.url, body, sendBeacon: env.sendBeacon, fetch: env.fetch });
      entries = [
        ...entries,
        { kind: record.kind, body, outcome: "sent", destination: current.destination },
      ];
    } else if (current.state === "off") {
      entries = [
        ...entries,
        { kind: record.kind, body, outcome: "not-sent", reason: current.reason },
      ];
    }
    changed();
  };

  const flush = (): void => {
    if (sessionSent) return;
    const record = session.summarise(app, env.now() - startedAt);
    if (record === null) return;
    sessionSent = true;
    emit(record);
  };

  /** Wraps a session update so listeners hear about it. */
  const update =
    <A extends unknown[]>(apply: (...args: A) => void) =>
    (...args: A): void => {
      apply(...args);
      changed();
    };

  return {
    start: safely(() => {
      if (started) return;
      started = true;
      env.onPageHidden(safely(flush));
      env.onPreferenceChanged(safely(refreshStatus));
      emit({ v: PAYLOAD_VERSION, kind: "visit", app });
    }),
    recordStepOpened: safely(update((step: unknown) => session.stepOpened(step))),
    recordPageOpened: safely(update((page: unknown) => session.pageOpened(page))),
    recordPublishOpened: safely(update((source: unknown) => session.publishOpened(source))),
    recordDepositStarted: safely(update((source: unknown) => session.depositStarted(source))),
    recordDepositFinished: safely(update((outcome: unknown) => session.depositFinished(outcome))),
    recordFileChecked: safely(update((result: unknown) => session.fileChecked(result))),
    recordTableImported: safely(update((input: unknown) => session.tableImported(input))),
    recordMappingEdited: safely(update((table: unknown) => session.mappingEdited(table))),
    recordSectionStatus: safely(
      update((section: unknown, sectionStatus: unknown) =>
        session.sectionStatus(section, sectionStatus),
      ),
    ),
    recordBuild: safely(update((input: unknown) => session.build(input))),
    recordValidation: safely(update((input: unknown) => session.validation(input))),
    recordDownload: safely(update((input: unknown) => session.download(input))),
    recordIssue: safely(update((input: unknown) => session.issue(input))),
    recordDraftRestored: safely(update(() => session.draftRestored())),
    flush: safely(flush),
    getStatus: () => status,
    isEnabledByUser: () => !switchedOff,
    setEnabledByUser: safely((enabled: boolean) => {
      switchedOff = !enabled;
      writeSwitchedOff(env.storage, switchedOff);
      status = readStatus();
      changed();
    }),
    getTransparencySnapshot: () => {
      if (snapshot === null || snapshotVersion !== version) {
        let pending: string | null = null;
        try {
          const record = sessionSent ? null : session.summarise(app, env.now() - startedAt);
          pending = record === null ? null : JSON.stringify(record);
        } catch {
          pending = null;
        }
        snapshot = { entries, pending };
        snapshotVersion = version;
      }
      return snapshot;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
