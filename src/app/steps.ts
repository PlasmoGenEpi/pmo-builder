import { createElement, lazy, type ComponentType } from "react";

import type { SectionId } from "@/domain/types";

/** Every step in the app: the eight data sections and the review step. */
export type StepId = SectionId | "review";

/** Sidebar groups, in order. */
export const STEP_GROUPS = [
  "Required",
  "Samples",
  "Study and methods",
  "Extras",
  "Finish",
] as const;

/** One sidebar group. */
export type StepGroup = (typeof STEP_GROUPS)[number];

/** One step of the app. */
export interface StepDefinition {
  id: StepId;
  /** Route path, such as `/panel`. The URL is `#/panel`. */
  path: `/${string}`;
  /** Page title and sidebar label, in sentence case. */
  title: string;
  /** One sentence saying what the step is for. Shown under the title. */
  description: string;
  group: StepGroup;
  /** Whether a PMO can be built without this step. */
  required: boolean;
  /** The page, loaded when the step is first opened or preloaded. */
  component: ComponentType;
  /** Loads the page's code without showing it, so opening it later shows no loading state. */
  preload: () => Promise<void>;
}

/** A page whose code is loaded on demand. */
export interface PageModule {
  readonly component: ComponentType;
  readonly preload: () => Promise<void>;
}

/**
 * A page loaded on demand. Once its code has loaded, by visiting it or by
 * `preload`, it renders at once instead of suspending, so moving to a
 * preloaded step shows no loading skeleton. A failed load is retried on the
 * next attempt.
 */
export function page(load: () => Promise<ComponentType>): PageModule {
  let loaded: ComponentType | null = null;
  let pending: Promise<ComponentType> | null = null;
  const start = (): Promise<ComponentType> => {
    pending ??= load().then(
      (component) => {
        loaded = component;
        return component;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
    return pending;
  };
  const Lazy = lazy(() => start().then((component) => ({ default: component })));
  function Page() {
    return createElement(loaded ?? Lazy);
  }
  return {
    component: Page,
    preload: () =>
      start().then(
        () => undefined,
        () => undefined,
      ),
  };
}

/**
 * The step registry, in navigation order. The sidebar, the routes and the
 * Back and Next buttons all follow it.
 */
export const STEPS: readonly StepDefinition[] = [
  {
    id: "microhaplotypes",
    path: "/microhaplotypes",
    title: "Microhaplotypes",
    description: "Add your allele table: the microhaplotypes found in each sample and their reads.",
    group: "Required",
    required: true,
    ...page(() =>
      import("@/features/microhaplotypes/MicrohaplotypesStep").then(
        (module) => module.MicrohaplotypesStep,
      ),
    ),
  },
  {
    id: "panel",
    path: "/panel",
    title: "Panel",
    description:
      "Add the targets and primers of your panel, and the reference genome if you have it.",
    group: "Required",
    required: true,
    ...page(() => import("@/features/panel/PanelStep").then((module) => module.PanelStep)),
  },
  {
    id: "specimens",
    path: "/specimens",
    title: "Specimens",
    description: "Describe each specimen: where and when it was collected, and from which host.",
    group: "Samples",
    required: false,
    ...page(() =>
      import("@/features/specimens/SpecimensStep").then((module) => module.SpecimensStep),
    ),
  },
  {
    id: "librarySamples",
    path: "/library-samples",
    title: "Library samples",
    description: "Link each sequenced library to its specimen, panel and sequencing run.",
    group: "Samples",
    required: false,
    ...page(() =>
      import("@/features/librarySamples/LibrarySamplesStep").then(
        (module) => module.LibrarySamplesStep,
      ),
    ),
  },
  {
    id: "project",
    path: "/project",
    title: "Project",
    description: "Name the project this data belongs to and the people behind it.",
    group: "Study and methods",
    required: false,
    ...page(() => import("@/features/project/ProjectStep").then((module) => module.ProjectStep)),
  },
  {
    id: "sequencing",
    path: "/sequencing",
    title: "Sequencing",
    description: "Record how and where the libraries were sequenced.",
    group: "Study and methods",
    required: false,
    ...page(() =>
      import("@/features/sequencing/SequencingStep").then((module) => module.SequencingStep),
    ),
  },
  {
    id: "bioinformatics",
    path: "/bioinformatics",
    title: "Bioinformatics",
    description: "Describe the pipeline and the runs that produced your allele table.",
    group: "Study and methods",
    required: false,
    ...page(() =>
      import("@/features/bioinformatics/BioinformaticsStep").then(
        (module) => module.BioinformaticsStep,
      ),
    ),
  },
  {
    id: "readCounts",
    path: "/read-counts",
    title: "Read counts by stage",
    description: "Add how many reads each sample kept at each stage of the pipeline.",
    group: "Extras",
    required: false,
    ...page(() =>
      import("@/features/readCounts/ReadCountsStep").then((module) => module.ReadCountsStep),
    ),
  },
  {
    id: "review",
    path: "/review",
    title: "Review and download",
    description: "See what is ready, fix what is missing, and download your PMO file.",
    group: "Finish",
    required: false,
    ...page(() => import("@/features/review/ReviewStep").then((module) => module.ReviewStep)),
  },
];

/** Looks up a step. Every `StepId` has one. */
export function getStep(id: StepId): StepDefinition {
  const step = STEPS.find((candidate) => candidate.id === id);
  if (step === undefined) throw new Error(`No step is registered for ${id}`);
  return step;
}

/** The steps before and after this one in navigation order, or `null` at either end. */
export function getAdjacentSteps(id: StepId): {
  previous: StepDefinition | null;
  next: StepDefinition | null;
} {
  const index = STEPS.findIndex((step) => step.id === id);
  return { previous: STEPS[index - 1] ?? null, next: STEPS[index + 1] ?? null };
}

/** The steps of each group, in order, for the sidebar. */
export function stepsByGroup(): { group: StepGroup; steps: StepDefinition[] }[] {
  return STEP_GROUPS.map((group) => ({
    group,
    steps: STEPS.filter((step) => step.group === group),
  }));
}
