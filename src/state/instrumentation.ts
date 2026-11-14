/**
 * Usage counts, wired in one place: this module watches the store's state
 * and events and calls the `record*` functions of `@/analytics`. Pages do
 * not record anything themselves.
 *
 * What is recorded, and when:
 *
 * - a table imported, with how it arrived (`upload`, `example`, or
 *   `saved-panel` for a panel from the library), its format and its bucketed
 *   size; an import that failed, by its code;
 * - a mapping the user changed, as opposed to the automatic match on import;
 * - each section's status once a build settles (no newer change waiting);
 * - each finished or failed build, and the schema validation of a settled
 *   build that made a PMO, once the user has changed something this session,
 *   so a visit that only restores a draft does not count as activity;
 * - each download;
 * - the stable code of each error or warning notice when it first appears;
 * - a restored draft, a draft set aside, a failed save and a stopped worker.
 *
 * Only fixed names, codes and counts are passed on: never a file name,
 * column name or cell value. `@/analytics` checks that again.
 */
import {
  fileFormatFromName,
  recordBuild,
  recordDownload,
  recordDraftRestored,
  recordIssue,
  recordMappingEdited,
  recordSectionStatus,
  recordTableImported,
  recordValidation,
} from "@/analytics";
import { fieldSetForSlot } from "@/domain/draft";
import { SECTION_IDS, type Notice } from "@/domain/types";
import type { BuildView, ImportFailure } from "@/worker";

import { subscribeAppEvents, type AppEvent, type AppStore } from "./store";

/** The recording functions the instrumentation calls. The real ones by default. */
export interface UsageRecorder {
  readonly recordTableImported: typeof recordTableImported;
  readonly recordMappingEdited: typeof recordMappingEdited;
  readonly recordSectionStatus: typeof recordSectionStatus;
  readonly recordBuild: typeof recordBuild;
  readonly recordValidation: typeof recordValidation;
  readonly recordDownload: typeof recordDownload;
  readonly recordIssue: typeof recordIssue;
  readonly recordDraftRestored: typeof recordDraftRestored;
}

/** The functions of `@/analytics`. */
export const ANALYTICS_RECORDER: UsageRecorder = {
  recordTableImported,
  recordMappingEdited,
  recordSectionStatus,
  recordBuild,
  recordValidation,
  recordDownload,
  recordIssue,
  recordDraftRestored,
};

/**
 * The usage code for an import failure. Codes the usage vocabulary does not
 * list yet are counted there as `import/other`.
 */
export function importIssueCode(failure: ImportFailure): string {
  switch (failure.code) {
    case "unsupported-type":
      return "import/unsupported-format";
    case "engine-stopped":
      return "worker/crashed";
    case "empty-file":
    case "no-rows":
    case "unreadable-file":
    case "unreadable-workbook":
    case "missing-sheet":
    case "too-large":
    case "not-loaded":
    case "unexpected":
      return `import/${failure.code}`;
    default:
      return "import/other";
  }
}

function recordEvent(event: AppEvent, recorder: UsageRecorder): void {
  switch (event.kind) {
    case "table-imported":
      recorder.recordTableImported({
        table: fieldSetForSlot(event.slot),
        route: event.route,
        ...fileFormatFromName(event.table.fileName),
        rows: event.table.rowCount,
        columns: event.table.columns.length,
      });
      return;
    case "import-failed":
      recorder.recordIssue({ code: importIssueCode(event.failure), severity: "error" });
      return;
    case "saved-panel-applied":
      recorder.recordTableImported({
        table: "panelTargets",
        route: "saved-panel",
        format: "other",
        gzip: false,
        rows: event.targets,
        columns: 0,
      });
      return;
    case "mapping-edited":
      recorder.recordMappingEdited(fieldSetForSlot(event.slot));
      return;
    case "pmo-downloaded":
      recorder.recordDownload({ kind: event.gzip ? "gzip" : "plain", bytes: event.bytes });
      return;
    case "draft-restored":
      recorder.recordDraftRestored();
      return;
    case "draft-set-aside":
      recorder.recordIssue({ code: "draft/restore-failed", severity: "error" });
      return;
    case "save-failed":
      recorder.recordIssue({ code: "draft/save-failed", severity: "error" });
      return;
    case "engine-stopped":
      recorder.recordIssue({ code: "worker/crashed", severity: "error" });
      return;
    default:
      return;
  }
}

/** Every error and warning of a build, keyed so a notice that stays is counted once. */
function noticeKeys(view: BuildView): Map<string, Notice> {
  const notices = [
    ...SECTION_IDS.flatMap((id) => view.sections[id].notices),
    ...view.overall.notices,
  ];
  const keys = new Map<string, Notice>();
  for (const notice of notices) {
    if (notice.severity === "info") continue;
    keys.set(
      `${notice.severity}\u0000${notice.code}\u0000${(notice.sections ?? []).join(",")}\u0000${notice.tableId ?? ""}\u0000${notice.fieldKey ?? ""}`,
      notice,
    );
  }
  return keys;
}

/**
 * Starts recording usage counts for a store. Call once per store, before
 * `initialise` so a restored draft is counted. Returns a function that stops.
 */
export function instrumentAppStore(
  store: AppStore,
  recorder: UsageRecorder = ANALYTICS_RECORDER,
): () => void {
  /** Whether the user has changed the draft this session (restoring it does not count). */
  let acted = false;
  let lastBuilt: number | null = null;
  let lastSettled: number | null = null;
  let issues = new Map<string, Notice>();

  const settle = (view: BuildView): void => {
    for (const id of SECTION_IDS) recorder.recordSectionStatus(id, view.sections[id].status);
    if (acted && view.overall.pmo !== "none") {
      recorder.recordValidation({ schemaErrors: view.overall.schemaErrors });
    }
    const current = noticeKeys(view);
    for (const [key, notice] of current) {
      if (issues.has(key)) continue;
      if (notice.severity === "error" || notice.severity === "warning") {
        recorder.recordIssue({ code: notice.code, severity: notice.severity });
      }
    }
    issues = current;
    lastSettled = view.revision;
  };

  const stopEvents = subscribeAppEvents(store, (event) => recordEvent(event, recorder));
  const stopState = store.subscribe((state, previous) => {
    if (state.draft !== previous.draft && previous.restore.kind !== "pending") acted = true;
    const build = state.build;
    if (build.phase === "failed" && previous.build.phase !== "failed" && acted) {
      recorder.recordBuild({ outcome: "failed" });
    }
    const view = build.view;
    if (view === null) return;
    if (view.revision !== lastBuilt) {
      lastBuilt = view.revision;
      if (acted) recorder.recordBuild({ outcome: "built" });
    }
    if (build.phase === "idle" && view.revision !== lastSettled) settle(view);
  });
  return () => {
    stopEvents();
    stopState();
  };
}
