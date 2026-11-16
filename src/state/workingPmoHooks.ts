/**
 * React bindings for the working PMO session. Pages read the session's state
 * and run queries through these; they change it only through the session's
 * methods.
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";

import type { WorkingPmoAnswer, WorkingPmoQuery, WorkingPmoQueryKind } from "@/domain/tools/types";

import { useAppStore } from "./hooks";
import { workingPmoSessionOf } from "./store";
import type { WorkingPmoSession, WorkingPmoState } from "./workingPmoSession";

/** The working PMO session of the store in context. */
export function useWorkingPmoSession(): WorkingPmoSession {
  return workingPmoSessionOf(useAppStore());
}

/** Selects part of the working PMO session's state. Return stable values from `select`. */
export function useWorkingPmo<T>(select: (state: WorkingPmoState) => T): T {
  return useStore(useWorkingPmoSession().state, select);
}

/** A query's answer, or that it is still being worked out. A stale answer is never shown. */
export type WorkingPmoQueryState<K extends WorkingPmoQueryKind> =
  | { readonly kind: "loading" }
  | Exclude<WorkingPmoAnswer<K>, { readonly kind: "stale" }>;

const LOADING: { readonly kind: "loading" } = { kind: "loading" };

/**
 * Runs a query about the working PMO, and runs it again whenever another
 * file is opened or `request` changes. Give it a stable request, such as a
 * memoised object. A stale answer is ignored.
 */
export function useWorkingPmoQuery<K extends WorkingPmoQueryKind>(
  request: WorkingPmoQuery<K>,
): WorkingPmoQueryState<K> {
  const session = useWorkingPmoSession();
  const generation = useWorkingPmo((state) => state.generation);
  const [lastAnswer, setLastAnswer] = useState<{
    readonly generation: number;
    readonly request: WorkingPmoQuery<K>;
    readonly answer: Exclude<WorkingPmoAnswer<K>, { readonly kind: "stale" }>;
  } | null>(null);

  useEffect(() => {
    let live = true;
    async function run(): Promise<void> {
      const answer = await session.query(request);
      if (!live || answer.kind === "stale") return;
      setLastAnswer({ generation, request, answer });
    }
    void run();
    return () => {
      live = false;
    };
  }, [session, generation, request]);

  return lastAnswer !== null &&
    lastAnswer.generation === generation &&
    lastAnswer.request === request
    ? lastAnswer.answer
    : LOADING;
}
