/**
 * React bindings for the working and published PMO sessions. Pages read state
 * and run queries through these; they change state only through a session's
 * methods.
 *
 * Shared panels (`SummaryPanel`, `CompareTab`, `TablesPanel`) read the active
 * session via {@link usePmoSession} and {@link usePmoQuery}, which follow the
 * nearest {@link PmoSessionProvider} and default to the working PMO session.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import type { WorkingPmoAnswer, WorkingPmoQuery, WorkingPmoQueryKind } from "@/domain/tools/types";

import { useAppStore } from "./hooks";
import { publishedPmoSessionOf, workingPmoSessionOf } from "./store";
import type { WorkingPmoSession, WorkingPmoState } from "./workingPmoSession";

const PmoSessionContext = createContext<WorkingPmoSession | null>(null);

/** Props for {@link PmoSessionProvider}. */
export interface PmoSessionProviderProps {
  readonly session: WorkingPmoSession;
  readonly children: ReactNode;
}

/** Provides `session` to {@link usePmoSession} and {@link usePmoQuery} in its subtree. */
export function PmoSessionProvider({ session, children }: PmoSessionProviderProps): ReactNode {
  return <PmoSessionContext value={session}>{children}</PmoSessionContext>;
}

/** The working PMO session of the store in context. */
export function useWorkingPmoSession(): WorkingPmoSession {
  return workingPmoSessionOf(useAppStore());
}

/** Selects part of the working PMO session's state. Return stable values from `select`. */
export function useWorkingPmo<T>(select: (state: WorkingPmoState) => T): T {
  return useStore(useWorkingPmoSession().state, select);
}

/** The published view's PMO session of the store in context. */
export function usePublishedPmoSession(): WorkingPmoSession {
  return publishedPmoSessionOf(useAppStore());
}

/** Selects part of the published view's PMO session state. Return stable values from `select`. */
export function usePublishedPmo<T>(select: (state: WorkingPmoState) => T): T {
  return useStore(usePublishedPmoSession().state, select);
}

/** The PMO session for the active view: the nearest {@link PmoSessionProvider}, or the working PMO session. */
export function usePmoSession(): WorkingPmoSession {
  const fromContext = useContext(PmoSessionContext);
  const working = useWorkingPmoSession();
  return fromContext ?? working;
}

/** A query's answer, or that it is still being worked out. A stale answer is never shown. */
export type WorkingPmoQueryState<K extends WorkingPmoQueryKind> =
  | { readonly kind: "loading" }
  | Exclude<WorkingPmoAnswer<K>, { readonly kind: "stale" }>;

const LOADING: { readonly kind: "loading" } = { kind: "loading" };

function useSessionQuery<K extends WorkingPmoQueryKind>(
  session: WorkingPmoSession,
  request: WorkingPmoQuery<K>,
): WorkingPmoQueryState<K> {
  const generation = useStore(session.state, (state) => state.generation);
  const [lastAnswer, setLastAnswer] = useState<{
    readonly session: WorkingPmoSession;
    readonly generation: number;
    readonly request: WorkingPmoQuery<K>;
    readonly answer: Exclude<WorkingPmoAnswer<K>, { readonly kind: "stale" }>;
  } | null>(null);

  useEffect(() => {
    let live = true;
    async function run(): Promise<void> {
      const answer = await session.query(request);
      if (!live || answer.kind === "stale") return;
      setLastAnswer({ session, generation, request, answer });
    }
    void run();
    return () => {
      live = false;
    };
  }, [session, generation, request]);

  return lastAnswer !== null &&
    lastAnswer.session === session &&
    lastAnswer.generation === generation &&
    lastAnswer.request === request
    ? lastAnswer.answer
    : LOADING;
}

/**
 * Runs a query against the active view's PMO session ({@link usePmoSession}),
 * and runs it again whenever another file is opened or `request` changes.
 * Give it a stable request, such as a memoised object. A stale answer is ignored.
 */
export function usePmoQuery<K extends WorkingPmoQueryKind>(
  request: WorkingPmoQuery<K>,
): WorkingPmoQueryState<K> {
  return useSessionQuery(usePmoSession(), request);
}

/**
 * Runs a query about the working PMO, and runs it again whenever another
 * file is opened or `request` changes. Give it a stable request, such as a
 * memoised object. A stale answer is ignored.
 */
export function useWorkingPmoQuery<K extends WorkingPmoQueryKind>(
  request: WorkingPmoQuery<K>,
): WorkingPmoQueryState<K> {
  return useSessionQuery(useWorkingPmoSession(), request);
}
