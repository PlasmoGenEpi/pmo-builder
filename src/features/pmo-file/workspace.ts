/**
 * What the My PMO file workspace has open. Kept outside the page, so the open
 * file and its subset survive moving between tabs and sections. The PMO
 * itself is in the worker; this holds what the page shows.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { PmoFileCheck } from "@/domain/build/checkFileResult";
import type { OpenOutcome, SubsetOutcome, WorkingSource } from "@/domain/tools/types";

/** An opened file's details, as the worker described it. */
export type Opened = Extract<OpenOutcome, { kind: "opened" }>;

/** Where an open file came from. */
export type FileOrigin =
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

/** Where the workspace's file stands. */
export type WorkspaceFile =
  | { readonly kind: "none" }
  | { readonly kind: "opening"; readonly name: string; readonly size: number }
  | {
      readonly kind: "opened";
      /** The file's bytes, for depositing it on Zenodo as it is. */
      readonly file: Blob;
      readonly name: string;
      readonly size: number;
      readonly opened: Opened;
      readonly origin: FileOrigin;
    }
  | {
      readonly kind: "refused";
      readonly name: string;
      readonly size: number;
      readonly check: Exclude<PmoFileCheck, { kind: "ready" }>;
    }
  | { readonly kind: "failed"; readonly name: string; readonly size: number };

/** Everything the workspace holds. */
export interface WorkspaceState {
  readonly file: WorkspaceFile;
  /** The latest subset made of the open file. */
  readonly subset: SubsetOutcome | null;
  /** Which PMO the Tables tab lists. */
  readonly tableSource: WorkingSource;
  /** Which PMO the Publish tab deposits. */
  readonly publishSource: WorkingSource;
  /** Counts opens, so a slow open overtaken by a newer one is ignored. */
  readonly generation: number;
}

const INITIAL: WorkspaceState = {
  file: { kind: "none" },
  subset: null,
  tableSource: "original",
  publishSource: "original",
  generation: 0,
};

const store = createStore<WorkspaceState>(() => INITIAL);

/** Reads the workspace. */
export function useWorkspace<T>(select: (state: WorkspaceState) => T): T {
  return useStore(store, select);
}

/** The workspace as it is now, outside React. */
export function workspaceState(): WorkspaceState {
  return store.getState();
}

/** Replaces part of the workspace. */
export function updateWorkspace(change: Partial<WorkspaceState>): void {
  store.setState(change);
}

/**
 * Starts opening a file: clears what was open and returns the generation to
 * pass to {@link finishOpening}.
 */
export function startOpening(name: string, size: number): number {
  const generation = store.getState().generation + 1;
  store.setState({
    file: { kind: "opening", name, size },
    subset: null,
    tableSource: "original",
    publishSource: "original",
    generation,
  });
  return generation;
}

/** Records the outcome of an open, unless a newer open has started since. */
export function finishOpening(generation: number, file: WorkspaceFile): void {
  if (store.getState().generation !== generation) return;
  store.setState({ file });
}

/** Closes the file. */
export function closeWorkspace(): void {
  store.setState({ ...INITIAL, generation: store.getState().generation + 1 });
}

/** Forgets everything. For tests. */
export function resetWorkspace(): void {
  store.setState(INITIAL);
}
