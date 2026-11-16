/**
 * The working PMO session: the one PMO file open in My PMO file, owned on
 * the main thread from the moment it is opened until it is closed or
 * replaced.
 *
 * The session counts opens and closes in a generation, keeps the opened
 * file's bytes and origin, and runs each open to the end, refusal and
 * failure included, whether or not the page that started it is still there.
 * Every request to the worker carries the generation, so an answer for a PMO
 * that has since been replaced comes back stale and is ignored.
 *
 * Pages read the state through the hooks in `workingPmoHooks.ts` and change
 * it only through the session's methods.
 */
import { t } from "@lingui/core/macro";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { PmoFileCheck } from "@/domain/build/checkFileResult";
import { unreachable } from "@/domain/draft";
import type {
  OpenOutcome,
  SubsetMade,
  SubsetRequest,
  WorkingPmoAnswer,
  WorkingPmoKind,
  WorkingPmoQuery,
  WorkingPmoQueryKind,
  WorkingPmoRequest,
  WorkingSource,
} from "@/domain/tools/types";
import { isEngineStoppedError, type Engine } from "@/worker";

/** An opened file's details, as the worker described it. */
export type Opened = Extract<OpenOutcome, { kind: "opened" }>;

/** Where a working PMO came from. */
export type WorkingPmoOrigin =
  /** A file the user chose. */
  | { readonly kind: "chosen" }
  /** The PMO this app built from the draft. */
  | { readonly kind: "built" }
  /** A published PMO, downloaded from its Zenodo record. */
  | {
      readonly kind: "published";
      /** The record's id, as in `#/published/<id>`. */
      readonly id: string;
      readonly title: string;
      readonly recordUrl: string;
    };

/** Where the working PMO's file stands. */
export type OpenState =
  | { readonly kind: "none" }
  | { readonly kind: "opening"; readonly name: string; readonly size: number }
  | {
      readonly kind: "opened";
      /** The file's bytes, for downloading or depositing it as it is. */
      readonly file: Blob;
      readonly name: string;
      readonly size: number;
      readonly opened: Opened;
      readonly origin: WorkingPmoOrigin;
    }
  | {
      readonly kind: "refused";
      readonly name: string;
      readonly size: number;
      readonly check: Exclude<PmoFileCheck, { kind: "ready" }>;
    }
  | { readonly kind: "failed"; readonly name: string; readonly size: number };

/** Everything the session holds that pages read. */
export interface WorkingPmoState {
  /** Goes up with every open and close. */
  readonly generation: number;
  readonly open: OpenState;
  /**
   * The minimum reads for a microhaplotype to count in Summary and Compare,
   * shared so the two tabs agree. `null`: count them all. Reset on each open.
   */
  readonly minReads: number | null;
  /** The subset made of the original, if any. Reset on each open. */
  readonly subset: SubsetState;
  /** Which PMO the Summary and Compare tabs sum up. Reset to the original on each open. */
  readonly summarySource: WorkingSource;
  /** Which PMO the Tables tab writes tables of. Reset to the original on each open. */
  readonly tableSource: WorkingSource;
  /** Which PMO the Publish tab deposits. Reset to the original on each open. */
  readonly publishSource: WorkingSource;
}

/** The subset of the working PMO. */
export type SubsetState =
  | { readonly kind: "none" }
  | {
      readonly kind: "made";
      /** What the subset was made from, so it can be made again. */
      readonly request: SubsetRequest;
      readonly made: Extract<SubsetMade, { readonly kind: "made" }>;
    };

/** What to open. */
export type OpenSource =
  /** A file's bytes: one the user chose, or a published PMO downloaded from Zenodo. */
  | {
      readonly kind: "file";
      readonly file: Blob;
      readonly name: string;
      readonly origin: Exclude<WorkingPmoOrigin, { kind: "built" }>;
    }
  /** The PMO the draft builds. The draft is built first if it changed. */
  | { readonly kind: "built" };

/** How an open ended, for the page that started it. */
export type OpenResult =
  | { readonly kind: "opened" }
  | { readonly kind: "refused" }
  | { readonly kind: "failed" }
  /** Opening the built PMO, and the draft builds none. */
  | { readonly kind: "no-built-pmo" }
  /** A newer open or a close started before this one finished. */
  | { readonly kind: "superseded" };

/** What checking a PMO file found, in a word. `failed` when the check could not run. */
export type PmoFileCheckResult =
  | "ready"
  | "example"
  | "too-large"
  | "unreadable"
  | "not-pmo"
  | "wrong-version"
  | "invalid"
  | "failed";

/** The word for what a file check found. */
export function fileCheckResult(check: PmoFileCheck | null): PmoFileCheckResult {
  if (check === null) return "failed";
  switch (check.kind) {
    case "ready":
      return check.publication.exampleData ? "example" : "ready";
    case "unreadable":
      return check.reason === "not-pmo" ? "not-pmo" : "unreadable";
    case "too-large":
    case "wrong-version":
    case "invalid":
      return check.kind;
    default:
      return unreachable(check);
  }
}

/** What the session reports for usage counts. */
export type WorkingPmoEvent =
  /** A PMO file was opened, and its check found `result`. */
  | { readonly kind: "pmo-file-checked"; readonly result: PmoFileCheckResult }
  | { readonly kind: "engine-stopped" };

/** What {@link createWorkingPmoSession} needs. */
export interface WorkingPmoSessionOptions {
  readonly engine: Engine;
  /** Builds the draft now if it changed, so the built PMO is current. */
  readonly flush: () => Promise<void>;
  /** Reports an event for usage counts. */
  readonly emit: (event: WorkingPmoEvent) => void;
}

/** The session's state, to read and watch. */
export type WorkingPmoStore = Pick<
  StoreApi<WorkingPmoState>,
  "getState" | "getInitialState" | "subscribe"
>;

/** The working PMO session. */
export interface WorkingPmoSession {
  /** The state. Read it with the hooks in `workingPmoHooks.ts`. */
  readonly state: WorkingPmoStore;
  /**
   * Opens a file or the built PMO in place of whatever was open, and runs
   * the open to the end. The open that started last wins.
   */
  open(source: OpenSource): Promise<OpenResult>;
  /** Closes the working PMO, letting the worker free it. */
  close(): Promise<void>;
  /** Asks the worker about the working PMO, as it is now. */
  query<K extends WorkingPmoQueryKind>(request: WorkingPmoQuery<K>): Promise<WorkingPmoAnswer<K>>;
  /**
   * Makes a subset of the original in place of the one made before, which
   * is let go of first. The subset made last wins: an older one still being
   * made is answered as stale.
   */
  subset(request: SubsetRequest): Promise<WorkingPmoAnswer<"subset">>;
  /** Sets the minimum reads for Summary and Compare. */
  setMinReads(value: number | null): void;
  /** Sets which PMO the Summary and Compare tabs sum up. */
  setSummarySource(source: WorkingSource): void;
  /** Sets which PMO the Tables tab writes tables of. */
  setTableSource(source: WorkingSource): void;
  /** Sets which PMO the Publish tab deposits. */
  setPublishSource(source: WorkingSource): void;
}

const NO_SUBSET: SubsetState = { kind: "none" };

const INITIAL: WorkingPmoState = {
  generation: 0,
  open: { kind: "none" },
  minReads: null,
  subset: NO_SUBSET,
  summarySource: "original",
  tableSource: "original",
  publishSource: "original",
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What usage counts call an open's outcome. */
function checkResultOf(outcome: OpenOutcome | null): PmoFileCheckResult {
  if (outcome === null) return "failed";
  if (outcome.kind === "refused") return fileCheckResult(outcome.check);
  return outcome.publication.exampleData ? "example" : "ready";
}

/** Creates a working PMO session on `engine`. Nothing is open at first. */
export function createWorkingPmoSession(options: WorkingPmoSessionOptions): WorkingPmoSession {
  const { engine, flush, emit } = options;
  const store = createStore<WorkingPmoState>(() => INITIAL);

  /** Sends a request for `generation`, answering an engine that throws as failed. */
  const send = async <K extends WorkingPmoKind>(
    generation: number,
    request: WorkingPmoRequest<K>,
  ): Promise<WorkingPmoAnswer<K>> => {
    try {
      return await engine.workingPmo({ generation, request });
    } catch (error) {
      if (isEngineStoppedError(error)) emit({ kind: "engine-stopped" });
      return { kind: "failed", message: describeError(error) };
    }
  };

  /** Starts a new generation, showing `open` and resetting what belongs to the last file. */
  const nextGeneration = (open: OpenState): number => {
    const generation = store.getState().generation + 1;
    store.setState({
      generation,
      open,
      minReads: null,
      subset: NO_SUBSET,
      summarySource: "original",
      tableSource: "original",
      publishSource: "original",
    });
    return generation;
  };

  const isCurrent = (generation: number): boolean => store.getState().generation === generation;

  /** Counts subset requests, so only the latest one's subset is kept. */
  let subsets = 0;

  /** The bytes to open: the file given, or the built PMO exported. */
  const bytesOf = async (
    source: OpenSource,
  ): Promise<
    | { readonly kind: "bytes"; readonly file: Blob; readonly name: string }
    | { readonly kind: "none" }
    | { readonly kind: "failed" }
  > => {
    if (source.kind === "file") return { kind: "bytes", file: source.file, name: source.name };
    try {
      await flush();
      const file = await engine.getPmoFile({ gzip: true });
      return file === null
        ? { kind: "none" }
        : { kind: "bytes", file: file.blob, name: file.fileName };
    } catch (error) {
      if (isEngineStoppedError(error)) emit({ kind: "engine-stopped" });
      return { kind: "failed" };
    }
  };

  return {
    state: store,

    async open(source) {
      const generation =
        source.kind === "file"
          ? nextGeneration({ kind: "opening", name: source.name, size: source.file.size })
          : nextGeneration({ kind: "opening", name: t`Your built PMO`, size: 0 });
      const bytes = await bytesOf(source);
      if (!isCurrent(generation)) return { kind: "superseded" };
      if (bytes.kind !== "bytes") {
        // The built PMO could not be had: nothing is open.
        store.setState({ open: { kind: "none" } });
        return bytes.kind === "none" ? { kind: "no-built-pmo" } : { kind: "failed" };
      }
      const { file, name } = bytes;
      const answer = await send(generation, { kind: "open", file, fileName: name });
      if (answer.kind === "stale" || !isCurrent(generation)) return { kind: "superseded" };
      const outcome = answer.kind === "ok" ? answer.value : null;
      emit({ kind: "pmo-file-checked", result: checkResultOf(outcome) });
      const size = file.size;
      if (outcome === null) {
        store.setState({ open: { kind: "failed", name, size } });
        return { kind: "failed" };
      }
      if (outcome.kind === "refused") {
        store.setState({ open: { kind: "refused", name, size, check: outcome.check } });
        return { kind: "refused" };
      }
      const origin: WorkingPmoOrigin = source.kind === "file" ? source.origin : { kind: "built" };
      store.setState({ open: { kind: "opened", file, name, size, opened: outcome, origin } });
      return { kind: "opened" };
    },

    async close() {
      const generation = nextGeneration({ kind: "none" });
      await send(generation, { kind: "close" });
    },

    query(request) {
      return send(store.getState().generation, request);
    },

    async subset(request) {
      const { generation } = store.getState();
      subsets += 1;
      const run = subsets;
      // The worker lets go of the previous subset before making this one.
      store.setState({ subset: NO_SUBSET });
      const answer = await send(generation, { kind: "subset", ...request });
      if (!isCurrent(generation) || run !== subsets) return { kind: "stale" };
      if (answer.kind === "ok" && answer.value.kind === "made") {
        store.setState({ subset: { kind: "made", request, made: answer.value } });
      }
      return answer;
    },

    setMinReads(value) {
      store.setState({ minReads: value });
    },

    setSummarySource(source) {
      store.setState({ summarySource: source });
    },

    setTableSource(source) {
      store.setState({ tableSource: source });
    },

    setPublishSource(source) {
      store.setState({ publishSource: source });
    },
  };
}
