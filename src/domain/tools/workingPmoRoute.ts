/**
 * The worker's side of the working PMO: what it holds, and how it answers
 * each request about it. This alone decides which PMO a request means (the
 * original or the subset) and whether a request is still current. The engine
 * stores what these functions return and nothing else.
 *
 * A request is carried out in two steps. {@link answerWorkingPmo} says at
 * once what to hold while the work runs (an open lets go of the previous PMO
 * here, before reading the new one) and starts the work. Once the work is
 * done, {@link settleWorkingPmo} checks it against what is held by then, so
 * a slow open overtaken by a newer one is answered as stale and not kept.
 */
import type { PortableMicrohaplotypeObject } from "pmotools-ts";

import { comparableFields, compareGroups } from "./groups";
import { summaryOf } from "./summary";
import type { WorkingPmoAnswer, WorkingPmoCall, WorkingPmoKind, WorkingSource } from "./types";
import { openPmo } from "./workingPmo";

type Pmo = PortableMicrohaplotypeObject;

/** A PMO the worker holds: the original as opened, and its subset if one was made. */
export interface HeldPmo {
  readonly fileName: string;
  readonly original: Pmo;
  readonly subset: Pmo | null;
}

/** What the worker holds for the working PMO. */
export interface WorkingPmoHeld {
  /** The newest open or close the worker has seen. */
  readonly generation: number;
  readonly pmo: HeldPmo | null;
}

/** What a worker holds before anything is opened. */
export const NOTHING_HELD: WorkingPmoHeld = { generation: 0, pmo: null };

/** What a request's work found, before it is checked against what is held by then. */
export type WorkingPmoWork<K extends WorkingPmoKind> =
  /** An answer that leaves what is held alone. */
  | { readonly kind: "answer"; readonly result: WorkingPmoAnswer<K> }
  /** An answer, and the PMO to hold from now on if the request is still current. */
  | { readonly kind: "hold"; readonly pmo: HeldPmo | null; readonly result: WorkingPmoAnswer<K> };

/** A request under way. */
export interface WorkingPmoStep<K extends WorkingPmoKind> {
  /** What to hold while the work runs. */
  readonly held: WorkingPmoHeld;
  /** The work. Pass what it gives to {@link settleWorkingPmo}. */
  readonly work: Promise<WorkingPmoWork<K>>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function answered<K extends WorkingPmoKind>(
  held: WorkingPmoHeld,
  result: WorkingPmoAnswer<K>,
): WorkingPmoStep<K> {
  return { held, work: Promise.resolve({ kind: "answer", result }) };
}

/** Which PMO `source` means, or why there is none. */
function pmoFor(
  held: WorkingPmoHeld,
  source: WorkingSource,
):
  | { readonly kind: "found"; readonly pmo: Pmo }
  | { readonly kind: "not-open" }
  | { readonly kind: "no-subset" } {
  if (held.pmo === null) return { kind: "not-open" };
  if (source === "original") return { kind: "found", pmo: held.pmo.original };
  return held.pmo.subset === null ? { kind: "no-subset" } : { kind: "found", pmo: held.pmo.subset };
}

/** Runs `work`, answering an error it throws as failed. */
async function guarded<K extends WorkingPmoKind>(
  work: () => Promise<WorkingPmoWork<K>> | WorkingPmoWork<K>,
): Promise<WorkingPmoWork<K>> {
  try {
    return await work();
  } catch (error) {
    return { kind: "answer", result: { kind: "failed", message: describeError(error) } };
  }
}

type Handlers = {
  readonly [K in WorkingPmoKind]: (
    held: WorkingPmoHeld,
    call: WorkingPmoCall<K>,
  ) => WorkingPmoStep<K>;
};

const HANDLERS: Handlers = {
  open(held, call) {
    if (call.generation < held.generation) return answered(held, { kind: "stale" });
    const { file, fileName } = call.request;
    return {
      // Let go of the previous PMO before reading the new one, so two are never held.
      held: { generation: call.generation, pmo: null },
      work: guarded(async () => {
        const { outcome, pmo } = await openPmo(file, fileName);
        return {
          kind: "hold",
          pmo: pmo === null ? null : { fileName, original: pmo, subset: null },
          result: { kind: "ok", value: outcome },
        };
      }),
    };
  },

  close(held, call) {
    if (call.generation < held.generation) return answered(held, { kind: "stale" });
    return answered({ generation: call.generation, pmo: null }, { kind: "ok", value: null });
  },

  summary(held, call) {
    if (call.generation < held.generation) return answered(held, { kind: "stale" });
    const found = pmoFor(held, call.request.source);
    if (found.kind !== "found") return answered(held, found);
    const { minReads } = call.request;
    return {
      held,
      work: guarded(() => ({
        kind: "answer",
        result: { kind: "ok", value: summaryOf(found.pmo, minReads) },
      })),
    };
  },

  groupFields(held, call) {
    if (call.generation < held.generation) return answered(held, { kind: "stale" });
    const found = pmoFor(held, call.request.source);
    if (found.kind !== "found") return answered(held, found);
    return {
      held,
      work: guarded(() => ({
        kind: "answer",
        result: { kind: "ok", value: comparableFields(found.pmo) },
      })),
    };
  },

  groups(held, call) {
    if (call.generation < held.generation) return answered(held, { kind: "stale" });
    const found = pmoFor(held, call.request.source);
    if (found.kind !== "found") return answered(held, found);
    const { key, minReads } = call.request;
    return {
      held,
      work: guarded(() => ({
        kind: "answer",
        result: { kind: "ok", value: compareGroups(found.pmo, key, minReads) },
      })),
    };
  },
};

/**
 * Starts answering a request about the working PMO, given what the worker
 * holds. Hold the step's `held` at once, then settle its work.
 *
 * A request for an older generation than the worker has seen is stale. One
 * for a newer generation than any it has seen, which happens only when the
 * worker started again and lost what it held, finds nothing open.
 */
export function answerWorkingPmo<K extends WorkingPmoKind>(
  held: WorkingPmoHeld,
  call: WorkingPmoCall<K>,
): WorkingPmoStep<K> {
  const handler: Handlers[K] = HANDLERS[call.request.kind];
  return handler(held, call);
}

/**
 * Ends a request: what to hold from now on, and the answer. Work for a
 * generation that is no longer the newest is stale, and what it found is not
 * kept.
 */
export function settleWorkingPmo<K extends WorkingPmoKind>(
  held: WorkingPmoHeld,
  call: WorkingPmoCall<K>,
  work: WorkingPmoWork<K>,
): { readonly held: WorkingPmoHeld; readonly result: WorkingPmoAnswer<K> } {
  if (call.generation < held.generation) return { held, result: { kind: "stale" } };
  if (work.kind === "answer") return { held, result: work.result };
  return { held: { generation: call.generation, pmo: work.pmo }, result: work.result };
}
