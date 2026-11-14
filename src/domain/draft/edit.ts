/**
 * Pure edits to a draft: adding, removing and changing list items, and
 * switching modes. Each returns a new draft and leaves its input untouched.
 */
import type {
  Draft,
  EntryMode,
  GenomeMode,
  MethodRecord,
  MethodStepRecord,
  PanelEntry,
  PanelSourceMode,
  ProjectRecord,
  RunMethodMode,
  RunNameMode,
  RunRecord,
  SequencingRecord,
} from "./model";
import {
  createMethodRecord,
  createMethodStep,
  createPanelEntry,
  createProjectRecord,
  createRunRecord,
  createSequencingRecord,
  unreachable,
} from "./model";

/** A list of items in the draft that the user can add to and remove from. */
export type ListPath =
  | { readonly list: "panels" }
  | { readonly list: "projects" }
  | { readonly list: "sequencingRuns" }
  | { readonly list: "methods" }
  | { readonly list: "methodSteps"; readonly methodId: string }
  | { readonly list: "runs" };

/** A change to one item of a list. The recipe gets the item and returns its new version. */
export type ItemUpdate =
  | {
      readonly list: "panels";
      readonly id: string;
      readonly recipe: (item: PanelEntry) => PanelEntry;
    }
  | {
      readonly list: "projects";
      readonly id: string;
      readonly recipe: (item: ProjectRecord) => ProjectRecord;
    }
  | {
      readonly list: "sequencingRuns";
      readonly id: string;
      readonly recipe: (item: SequencingRecord) => SequencingRecord;
    }
  | {
      readonly list: "methods";
      readonly id: string;
      readonly recipe: (item: MethodRecord) => MethodRecord;
    }
  | {
      readonly list: "methodSteps";
      readonly methodId: string;
      readonly id: string;
      readonly recipe: (item: MethodStepRecord) => MethodStepRecord;
    }
  | { readonly list: "runs"; readonly id: string; readonly recipe: (item: RunRecord) => RunRecord };

/** A change to one value of a hand-entered record. */
export type RecordValueChange =
  | {
      readonly list: "projects";
      readonly id: string;
      readonly key: keyof ProjectRecord["values"];
      readonly value: string;
    }
  | {
      readonly list: "sequencingRuns";
      readonly id: string;
      readonly key: keyof SequencingRecord["values"];
      readonly value: string;
    }
  | {
      readonly list: "methodSteps";
      readonly methodId: string;
      readonly id: string;
      readonly key: keyof MethodStepRecord["values"];
      readonly value: string;
    }
  | {
      readonly list: "runs";
      readonly id: string;
      readonly key: keyof RunRecord["values"];
      readonly value: string;
    };

interface Identified {
  readonly id: string;
}

/** Reads and writes one list of the draft. */
interface Lens<T extends Identified> {
  readonly get: (draft: Draft) => readonly T[];
  readonly set: (draft: Draft, items: readonly T[]) => Draft;
  readonly create: () => T;
}

const panelsLens: Lens<PanelEntry> = {
  get: (draft) => draft.panel.panels,
  set: (draft, panels) => ({ ...draft, panel: { panels } }),
  create: () => createPanelEntry(),
};

const projectsLens: Lens<ProjectRecord> = {
  get: (draft) => draft.project.records,
  set: (draft, records) => ({ ...draft, project: { ...draft.project, records } }),
  create: () => createProjectRecord(),
};

const sequencingLens: Lens<SequencingRecord> = {
  get: (draft) => draft.sequencing.records,
  set: (draft, records) => ({ ...draft, sequencing: { ...draft.sequencing, records } }),
  create: () => createSequencingRecord(),
};

const methodsLens: Lens<MethodRecord> = {
  get: (draft) => draft.bioinformatics.methods.records,
  set: (draft, records) => ({
    ...draft,
    bioinformatics: {
      ...draft.bioinformatics,
      methods: { ...draft.bioinformatics.methods, records },
    },
  }),
  create: () => createMethodRecord(),
};

const runsLens: Lens<RunRecord> = {
  get: (draft) => draft.bioinformatics.runs.records,
  set: (draft, records) => ({
    ...draft,
    bioinformatics: { ...draft.bioinformatics, runs: { ...draft.bioinformatics.runs, records } },
  }),
  create: () => createRunRecord(),
};

function stepsLens(methodId: string): Lens<MethodStepRecord> {
  return {
    get: (draft) => methodsLens.get(draft).find((method) => method.id === methodId)?.steps ?? [],
    set: (draft, steps) =>
      methodsLens.set(
        draft,
        methodsLens
          .get(draft)
          // oxlint-disable-next-line oxc/no-map-spread -- the draft is immutable state; items must be new objects
          .map((method) => (method.id === methodId ? { ...method, steps } : method)),
      ),
    create: () => createMethodStep(),
  };
}

/** Calls `visit` with the lens of the list a path names. */
function withLens<R>(path: ListPath, visit: <T extends Identified>(lens: Lens<T>) => R): R {
  switch (path.list) {
    case "panels":
      return visit(panelsLens);
    case "projects":
      return visit(projectsLens);
    case "sequencingRuns":
      return visit(sequencingLens);
    case "methods":
      return visit(methodsLens);
    case "methodSteps":
      return visit(stepsLens(path.methodId));
    case "runs":
      return visit(runsLens);
    default:
      return unreachable(path);
  }
}

/** What {@link addListItem} returns. */
export interface AddedItem {
  readonly draft: Draft;
  /** The new item's id. */
  readonly id: string;
}

/**
 * Appends a blank item to a list. A step added to a method that does not
 * exist changes nothing.
 */
export function addListItem(draft: Draft, path: ListPath): AddedItem {
  return withLens(path, (lens) => {
    const item = lens.create();
    if (
      path.list === "methodSteps" &&
      !methodsLens.get(draft).some((m) => m.id === path.methodId)
    ) {
      return { draft, id: item.id };
    }
    return { draft: lens.set(draft, [...lens.get(draft), item]), id: item.id };
  });
}

/** Removes one item from a list by id. */
export function removeListItem(draft: Draft, path: ListPath, id: string): Draft {
  return withLens(path, (lens) =>
    lens.set(
      draft,
      lens.get(draft).filter((item) => item.id !== id),
    ),
  );
}

/** Moves one item of a list to a new position (0-based, clamped to the list). */
export function moveListItem(draft: Draft, path: ListPath, id: string, toIndex: number): Draft {
  return withLens(path, (lens) => {
    const items = lens.get(draft);
    const moved = items.find((item) => item.id === id);
    if (moved === undefined) return draft;
    const rest = items.filter((item) => item.id !== id);
    const at = Math.max(0, Math.min(toIndex, rest.length));
    return lens.set(draft, [...rest.slice(0, at), moved, ...rest.slice(at)]);
  });
}

/** Whether a list has an item with this id. */
export function hasListItem(draft: Draft, path: ListPath, id: string): boolean {
  return withLens(path, (lens) => lens.get(draft).some((item) => item.id === id));
}

function updateWith<T extends Identified>(
  draft: Draft,
  lens: Lens<T>,
  id: string,
  recipe: (item: T) => T,
): Draft {
  const items = lens.get(draft);
  if (!items.some((item) => item.id === id)) return draft;
  return lens.set(
    draft,
    // oxlint-disable-next-line oxc/no-map-spread -- the draft is immutable state; items must be new objects
    items.map((item) => (item.id === id ? { ...recipe(item), id } : item)),
  );
}

/** Changes one item of a list. The item keeps its id whatever the recipe returns. */
export function updateListItem(draft: Draft, update: ItemUpdate): Draft {
  switch (update.list) {
    case "panels":
      return updateWith(draft, panelsLens, update.id, update.recipe);
    case "projects":
      return updateWith(draft, projectsLens, update.id, update.recipe);
    case "sequencingRuns":
      return updateWith(draft, sequencingLens, update.id, update.recipe);
    case "methods":
      return updateWith(draft, methodsLens, update.id, update.recipe);
    case "methodSteps":
      return updateWith(draft, stepsLens(update.methodId), update.id, update.recipe);
    case "runs":
      return updateWith(draft, runsLens, update.id, update.recipe);
    default:
      return unreachable(update);
  }
}

/** Sets one value of a hand-entered record. */
export function setRecordValue(draft: Draft, change: RecordValueChange): Draft {
  switch (change.list) {
    case "projects":
      return updateWith(draft, projectsLens, change.id, (item) => ({
        ...item,
        values: { ...item.values, [change.key]: change.value },
      }));
    case "sequencingRuns":
      return updateWith(draft, sequencingLens, change.id, (item) => ({
        ...item,
        values: { ...item.values, [change.key]: change.value },
      }));
    case "methodSteps":
      return updateWith(draft, stepsLens(change.methodId), change.id, (item) => ({
        ...item,
        values: { ...item.values, [change.key]: change.value },
      }));
    case "runs":
      return updateWith(draft, runsLens, change.id, (item) => ({
        ...item,
        values: { ...item.values, [change.key]: change.value },
      }));
    default:
      return unreachable(change);
  }
}

/** A change of mode somewhere in the draft. Data entered in other modes is kept. */
export type ModeChange =
  | { readonly target: "project"; readonly mode: EntryMode }
  | { readonly target: "sequencing"; readonly mode: EntryMode }
  | { readonly target: "bioinformaticsMethods"; readonly mode: EntryMode }
  | { readonly target: "bioinformaticsRuns"; readonly mode: EntryMode }
  | { readonly target: "runsMethod"; readonly mode: RunMethodMode }
  | { readonly target: "panelSource"; readonly panelId: string; readonly mode: PanelSourceMode }
  | { readonly target: "panelGenome"; readonly panelId: string; readonly mode: GenomeMode }
  | { readonly target: "microhaplotypesRunName"; readonly mode: RunNameMode }
  | { readonly target: "readCountsRunName"; readonly mode: RunNameMode };

/** Switches a mode. Nothing entered under another mode is removed. */
export function applyModeChange(draft: Draft, change: ModeChange): Draft {
  const bio = draft.bioinformatics;
  switch (change.target) {
    case "project":
      return { ...draft, project: { ...draft.project, mode: change.mode } };
    case "sequencing":
      return { ...draft, sequencing: { ...draft.sequencing, mode: change.mode } };
    case "bioinformaticsMethods":
      return {
        ...draft,
        bioinformatics: { ...bio, methods: { ...bio.methods, mode: change.mode } },
      };
    case "bioinformaticsRuns":
      return { ...draft, bioinformatics: { ...bio, runs: { ...bio.runs, mode: change.mode } } };
    case "runsMethod":
      return {
        ...draft,
        bioinformatics: {
          ...bio,
          runs: { ...bio.runs, table: { ...bio.runs.table, methodMode: change.mode } },
        },
      };
    case "panelSource":
      return updateWith(draft, panelsLens, change.panelId, (panel) => ({
        ...panel,
        source: change.mode,
      }));
    case "panelGenome":
      return updateWith(draft, panelsLens, change.panelId, (panel) => ({
        ...panel,
        genome: { ...panel.genome, mode: change.mode },
      }));
    case "microhaplotypesRunName":
      return {
        ...draft,
        microhaplotypes: {
          ...draft.microhaplotypes,
          runName: { ...draft.microhaplotypes.runName, mode: change.mode },
        },
      };
    case "readCountsRunName":
      return {
        ...draft,
        readCounts: {
          ...draft.readCounts,
          runName: { ...draft.readCounts.runName, mode: change.mode },
        },
      };
    default:
      return unreachable(change);
  }
}
