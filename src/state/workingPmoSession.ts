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
 * When the background worker stops, it loses the PMO it held. The next
 * request that finds it gone opens the kept bytes again in the new worker,
 * makes the subset again from the request it was made from, and is sent once
 * more. If that fails too, the open state becomes failed.
 *
 * Pages read the state through the hooks in `workingPmoHooks.ts` and change
 * it only through the session's methods.
 */
import { t } from "@lingui/core/macro";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { PmoFileCheck } from "@/domain/build/checkFileResult";
import { describeError, unreachable } from "@/domain/draft";
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
export type OpenedFile = Extract<OpenOutcome, { kind: "opened" }>;

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
      readonly opened: OpenedFile;
      readonly origin: WorkingPmoOrigin;
    }
  | {
      readonly kind: "refused";
      readonly name: string;
      readonly size: number;
      readonly check: Exclude<PmoFileCheck, { kind: "ready" }>;
    }
  | {
      readonly kind: "failed";
      readonly name: string;
      readonly size: number;
      /**
       * `open`: the file could not be opened. `lost`: it was open, the
       * background worker stopped, and opening it again in the new worker
       * failed too.
       */
      readonly cause: "open" | "lost";
    };

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
  /**
   * Which PMO Summary, Compare, Tables and Publish work on. The subset only
   * while one is made: making one switches to it, and losing it switches
   * back. Reset to the original on each open.
   */
  readonly source: WorkingSource;
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
export type PmoToOpen =
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
  open(toOpen: PmoToOpen): Promise<OpenResult>;
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
  /**
   * Sets which PMO Summary, Compare, Tables and Publish work on. The subset
   * can be chosen only once one is made.
   */
  setSource(source: WorkingSource): void;
}

const NO_SUBSET: SubsetState = { kind: "none" };

const INITIAL: WorkingPmoState = {
  generation: 0,
  open: { kind: "none" },
  minReads: null,
  subset: NO_SUBSET,
  source: "original",
};

/** A request the worker stopped before answering. */
interface Stopped {
  readonly kind: "stopped";
  readonly message: string;
}

/** What a request sent once answered, with a stopped worker answered as failed. */
function answerOf<K extends WorkingPmoKind>(
  answer: WorkingPmoAnswer<K> | Stopped,
): WorkingPmoAnswer<K> {
  return answer.kind === "stopped" ? { kind: "failed", message: answer.message } : answer;
}

/** What usage counts call an open's outcome. `null`: the file could not be opened. */
function checkResultOf(outcome: OpenOutcome | null): PmoFileCheckResult {
  if (outcome === null) return "failed";
  if (outcome.kind === "opened") return outcome.publication.exampleData ? "example" : "ready";
  const { check } = outcome;
  switch (check.kind) {
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

/** Creates a working PMO session on `engine`. Nothing is open at first. */
export function createWorkingPmoSession(options: WorkingPmoSessionOptions): WorkingPmoSession {
  const { engine, flush, emit } = options;
  const store = createStore<WorkingPmoState>(() => INITIAL);

  /**
   * Sends a request for `generation` once. An engine that throws answers
   * failed, or `stopped` when its worker stopped.
   */
  const post = async <K extends WorkingPmoKind>(
    generation: number,
    request: WorkingPmoRequest<K>,
  ): Promise<WorkingPmoAnswer<K> | Stopped> => {
    try {
      return await engine.workingPmo({ generation, request });
    } catch (error) {
      if (!isEngineStoppedError(error)) return { kind: "failed", message: describeError(error) };
      emit({ kind: "engine-stopped" });
      return { kind: "stopped", message: describeError(error) };
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
      source: "original",
    });
    return generation;
  };

  const isCurrent = (generation: number): boolean => store.getState().generation === generation;

  /**
   * Whether the worker lost the working PMO of `generation`: it stopped
   * while answering, or it answers that nothing is open while a file is.
   * Only a worker started again after stopping can do that.
   */
  const isLost = (generation: number, answer: { readonly kind: string }): boolean =>
    answer.kind === "stopped" ||
    (answer.kind === "not-open" &&
      isCurrent(generation) &&
      store.getState().open.kind === "opened");

  /** The restore under way, shared by every request that finds the PMO lost meanwhile. */
  let restoring: { readonly generation: number; readonly done: Promise<boolean> } | null = null;

  /**
   * Opens the kept bytes of `generation` again in the worker, and makes the
   * subset again. Tried once: if it fails, the open state becomes failed.
   * Resolves whether the worker holds the working PMO again.
   */
  const reopen = async (generation: number): Promise<boolean> => {
    const { open } = store.getState();
    if (!isCurrent(generation) || open.kind !== "opened") return false;
    const fail = (): false => {
      if (isCurrent(generation)) {
        store.setState({
          open: { kind: "failed", name: open.name, size: open.size, cause: "lost" },
          subset: NO_SUBSET,
          source: "original",
        });
      }
      return false;
    };
    const opened = await post(generation, {
      kind: "open",
      file: open.file,
      fileName: open.name,
    });
    if (!isCurrent(generation)) return false;
    if (opened.kind !== "ok" || opened.value.kind !== "opened") return fail();
    // Read after opening, so a subset made meanwhile is the one made again.
    const { subset } = store.getState();
    if (subset.kind === "none") return true;
    const remade = await post(generation, { kind: "subset", ...subset.request });
    if (!isCurrent(generation)) return false;
    return remade.kind === "ok" && remade.value.kind === "made" ? true : fail();
  };

  /** Restores the working PMO of `generation`, joining a restore of it already under way. */
  const restore = (generation: number): Promise<boolean> => {
    if (restoring?.generation === generation) return restoring.done;
    const done = reopen(generation).finally(() => {
      if (restoring?.done === done) restoring = null;
    });
    restoring = { generation, done };
    return done;
  };

  /**
   * Sends a request for `generation`. If the worker lost the working PMO,
   * restores it and sends the request once more.
   */
  const send = async <K extends WorkingPmoKind>(
    generation: number,
    request: WorkingPmoRequest<K>,
  ): Promise<WorkingPmoAnswer<K>> => {
    const first = await post(generation, request);
    if (!isLost(generation, first)) return answerOf(first);
    if (!isCurrent(generation)) return { kind: "stale" };
    if (!(await restore(generation))) {
      // The open state says what happened, for the page to show.
      return isCurrent(generation)
        ? { kind: "failed", message: "The worker lost the file and could not open it again." }
        : { kind: "stale" };
    }
    return answerOf(await post(generation, request));
  };

  /** Counts subset requests, so only the latest one's subset is kept. */
  let subsets = 0;

  /** The bytes to open: the file given, or the built PMO exported. */
  const bytesOf = async (
    toOpen: PmoToOpen,
  ): Promise<
    | { readonly kind: "bytes"; readonly file: Blob; readonly name: string }
    | { readonly kind: "none" }
    | { readonly kind: "failed" }
  > => {
    if (toOpen.kind === "file") return { kind: "bytes", file: toOpen.file, name: toOpen.name };
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

    async open(toOpen) {
      const opening =
        toOpen.kind === "file"
          ? { name: toOpen.name, size: toOpen.file.size }
          : { name: t`Your built PMO`, size: 0 };
      const generation = nextGeneration({ kind: "opening", ...opening });
      const bytes = await bytesOf(toOpen);
      if (!isCurrent(generation)) return { kind: "superseded" };
      if (bytes.kind === "none") {
        store.setState({ open: { kind: "none" } });
        return { kind: "no-built-pmo" };
      }
      if (bytes.kind === "failed") {
        emit({ kind: "pmo-file-checked", result: "failed" });
        store.setState({ open: { kind: "failed", ...opening, cause: "open" } });
        return { kind: "failed" };
      }
      const { file, name } = bytes;
      const request: WorkingPmoRequest<"open"> = { kind: "open", file, fileName: name };
      const first = await post(generation, request);
      // A worker that stopped while reading is started again: read the file once more.
      const answer: WorkingPmoAnswer<"open"> =
        first.kind === "stopped" && isCurrent(generation)
          ? answerOf<"open">(await post(generation, request))
          : answerOf<"open">(first);
      if (answer.kind === "stale" || !isCurrent(generation)) return { kind: "superseded" };
      const outcome = answer.kind === "ok" ? answer.value : null;
      emit({ kind: "pmo-file-checked", result: checkResultOf(outcome) });
      const size = file.size;
      if (outcome === null) {
        store.setState({ open: { kind: "failed", name, size, cause: "open" } });
        return { kind: "failed" };
      }
      if (outcome.kind === "refused") {
        store.setState({ open: { kind: "refused", name, size, check: outcome.check } });
        return { kind: "refused" };
      }
      const origin: WorkingPmoOrigin = toOpen.kind === "file" ? toOpen.origin : { kind: "built" };
      store.setState({ open: { kind: "opened", file, name, size, opened: outcome, origin } });
      return { kind: "opened" };
    },

    async close() {
      const generation = nextGeneration({ kind: "none" });
      await post(generation, { kind: "close" });
    },

    query(request) {
      return send(store.getState().generation, request);
    },

    async subset(request) {
      const { generation } = store.getState();
      subsets += 1;
      const run = subsets;
      // The worker lets go of the previous subset before making this one.
      store.setState({ subset: NO_SUBSET, source: "original" });
      const answer = await send(generation, { kind: "subset", ...request });
      if (!isCurrent(generation) || run !== subsets) return { kind: "stale" };
      if (answer.kind === "ok" && answer.value.kind === "made") {
        store.setState({ subset: { kind: "made", request, made: answer.value }, source: "subset" });
      }
      return answer;
    },

    setMinReads(value) {
      store.setState({ minReads: value });
    },

    setSource(source) {
      if (source === "subset" && store.getState().subset.kind !== "made") return;
      store.setState({ source });
    },
  };
}
