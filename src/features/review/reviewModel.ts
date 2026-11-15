/**
 * What the review page says, worked out from the latest build: the verdict,
 * one line for each section, and the notices worth checking.
 */
import { plural, t } from "@lingui/core/macro";

import type { SectionSummaries } from "@/domain/build";
import {
  REQUIRED_SECTION_IDS,
  SECTION_IDS,
  type Notice,
  type SectionId,
  type SectionStatus,
} from "@/domain/types";
import { intlLocale } from "@/i18n/languages";
import type { BuildView, SectionView } from "@/worker";

/** Why a section stops the PMO from being built. */
export type BlockerProblem = "missing" | "unfinished" | "errors";

/** A section that stops the PMO from being built. */
export interface Blocker {
  readonly section: SectionId;
  readonly problem: BlockerProblem;
}

/** Whether the user can download a PMO, and why not. */
export type Verdict =
  /** The first build has not finished yet. */
  | { readonly kind: "waiting" }
  /** Nothing has been entered anywhere. */
  | { readonly kind: "empty" }
  /**
   * No PMO was built. `blockers` lists the sections at fault; it is empty
   * when every section is fine but the tables could not be put together.
   */
  | { readonly kind: "not-ready"; readonly blockers: readonly Blocker[] }
  /** A PMO was built, with warnings, or it does not fully match the schema. */
  | {
      readonly kind: "check";
      /** False when the PMO fails the schema or the integrity check. */
      readonly valid: boolean;
      readonly errors: number;
      readonly warnings: number;
    }
  /** A valid PMO was built with nothing to check. */
  | { readonly kind: "ready" };

const REQUIRED: ReadonlySet<SectionId> = new Set(REQUIRED_SECTION_IDS);

/** True for the allele table and the panel. */
export function isRequiredSection(section: SectionId): boolean {
  return REQUIRED.has(section);
}

/**
 * The notices worth checking on the review page: everything from the merge,
 * the schema validation and the integrity check, and the errors and warnings
 * of sections that go into the PMO or have errors. Unfinished sections are
 * left out, and their own notices stay on their steps. Each section notice
 * points at its section.
 */
export function reviewNotices(view: BuildView): readonly Notice[] {
  const fromSections: Notice[] = [];
  for (const id of SECTION_IDS) {
    const section: SectionView = view.sections[id];
    if (section.status !== "ready" && section.status !== "error") continue;
    for (const notice of section.notices) {
      if (notice.severity === "info") continue;
      fromSections.push(
        notice.sections === undefined || notice.sections.length === 0
          ? { ...notice, sections: [id] }
          : notice,
      );
    }
  }
  return [...view.overall.notices, ...fromSections];
}

function blockerFor(section: SectionId, status: SectionStatus): Blocker | null {
  if (status === "error") return { section, problem: "errors" };
  if (!isRequiredSection(section)) return null;
  if (status === "empty") return { section, problem: "missing" };
  if (status === "incomplete") return { section, problem: "unfinished" };
  return null;
}

/** The notice that says how many schema problems are not listed. It is not a problem itself. */
const SCHEMA_MORE = "schema/more";

/**
 * How many problems the errors among `notices` stand for. A schema notice is
 * one place in the PMO, however many rules it breaks there, and the "more
 * are not listed" line counts as the problems it holds back, taken from
 * `schemaProblems` (every place in the PMO that fails the schema).
 */
export function problemCount(notices: readonly Notice[], schemaProblems: number): number {
  let other = 0;
  let schema = 0;
  for (const notice of notices) {
    if (notice.severity !== "error" || notice.code === SCHEMA_MORE) continue;
    if (notice.code.startsWith("schema/")) schema += 1;
    else other += 1;
  }
  return other + Math.max(schema, schemaProblems);
}

/** The verdict for a build, or `waiting` before the first one. */
export function getVerdict(view: BuildView | null): Verdict {
  if (view === null) return { kind: "waiting" };
  const { overall } = view;
  if (overall.pmo === "none") {
    if (overall.status === "empty") return { kind: "empty" };
    const blockers = SECTION_IDS.flatMap((id) => {
      const blocker = blockerFor(id, view.sections[id].status);
      return blocker === null ? [] : [blocker];
    });
    return { kind: "not-ready", blockers };
  }
  const notices = reviewNotices(view);
  const errors = problemCount(notices, overall.schemaErrors);
  const warnings = notices.filter((notice) => notice.severity === "warning").length;
  const valid = overall.pmo === "valid";
  if (valid && errors === 0 && warnings === 0) return { kind: "ready" };
  return { kind: "check", valid, errors, warnings };
}

/** How a section stands on the review page. */
export type ChecklistState =
  | "ready"
  | "errors"
  /** A required section that is started but not finished. */
  | "unfinished"
  /** An optional section that is started but not finished, so it stays out of the PMO. */
  | "left-out"
  /** A required section with nothing in it. */
  | "needed"
  /** An optional section with nothing in it. */
  | "not-added";

/** The checklist state of a section. */
export function checklistState(section: SectionId, status: SectionStatus): ChecklistState {
  const required = isRequiredSection(section);
  if (status === "ready") return "ready";
  if (status === "error") return "errors";
  if (status === "incomplete") return required ? "unfinished" : "left-out";
  return required ? "needed" : "not-added";
}

/**
 * "1 target", "276 targets", with thousands separators, always in English.
 * For text on screen use `plural` from `@lingui/core/macro`; this is for text
 * that stays English, such as the Zenodo record.
 */
export function count(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${new Intl.NumberFormat("en-US").format(value)} ${value === 1 ? singular : pluralForm}`;
}

/** Joins a few short names: "a", "a and b", "a, b and 2 more". */
function names(values: readonly string[], max = 2): string {
  const shown = values.slice(0, max);
  const rest = values.length - shown.length;
  if (rest > 0) {
    const shownNames = shown.join(", ");
    return plural(rest, { one: `${shownNames} and # more`, other: `${shownNames} and # more` });
  }
  return new Intl.ListFormat(intlLocale(), { type: "conjunction" }).format(shown);
}

type Summaries = { readonly [S in SectionId]: (summary: SectionSummaries[S]) => string };

const SUMMARIES: Summaries = {
  microhaplotypes: (summary) => {
    const alleleCalls = summary.rows;
    const samples = summary.librarySamples;
    const targets = summary.targets;
    const alleles = summary.microhaplotypes;
    return t`${plural(alleleCalls, { one: "# allele call", other: "# allele calls" })} for ${plural(samples, { one: "# sample", other: "# samples" })} at ${plural(targets, { one: "# target", other: "# targets" })}, ${plural(alleles, { one: "# distinct allele", other: "# distinct alleles" })}`;
  },
  panel: (summary) => {
    const targets = summary.targets;
    const genomes = summary.genomes;
    const panels = summary.panels.length;
    const [only] = summary.panels;
    if (panels === 1 && only !== undefined && only.name.trim() !== "") {
      const panelName = only.name;
      return genomes === 0
        ? t`Panel "${panelName}" with ${plural(targets, { one: "# target", other: "# targets" })}, no genome`
        : t`Panel "${panelName}" with ${plural(targets, { one: "# target", other: "# targets" })}, ${plural(genomes, { one: "# genome", other: "# genomes" })}`;
    }
    return genomes === 0
      ? t`${plural(panels, { one: "# panel", other: "# panels" })} with ${plural(targets, { one: "# target", other: "# targets" })}, no genome`
      : t`${plural(panels, { one: "# panel", other: "# panels" })} with ${plural(targets, { one: "# target", other: "# targets" })}, ${plural(genomes, { one: "# genome", other: "# genomes" })}`;
  },
  specimens: (summary) => plural(summary.specimens, { one: "# specimen", other: "# specimens" }),
  librarySamples: (summary) =>
    plural(summary.librarySamples, { one: "# library sample", other: "# library samples" }),
  project: (summary) => {
    if (summary.names.length === 0)
      return plural(summary.projects, { one: "# project", other: "# projects" });
    const projectNames = names(summary.names.map((name) => `"${name}"`));
    return plural(summary.projects, {
      one: `Project ${projectNames}`,
      other: `Projects ${projectNames}`,
    });
  },
  sequencing: (summary) =>
    plural(summary.runs, { one: "# sequencing run", other: "# sequencing runs" }),
  bioinformatics: (summary) => {
    const methods = summary.methods.length;
    const runs = summary.runs;
    return t`${plural(methods, { one: "# method", other: "# methods" })}, ${plural(runs, { one: "# run", other: "# runs" })}`;
  },
  readCounts: (summary) => {
    const samples = summary.librarySamples;
    const stages = summary.stages.length;
    if (stages === 0)
      return t`${plural(samples, { one: "# sample", other: "# samples" })} over ${plural(stages, { one: "# stage", other: "# stages" })}`;
    const stageNames = names(summary.stages, 3);
    return t`${plural(samples, { one: "# sample", other: "# samples" })} over ${plural(stages, { one: "# stage", other: "# stages" })} (${stageNames})`;
  },
};

/** A one-line summary of a ready section, such as "50 specimens". */
export function summaryLine<S extends SectionId>(section: S, summary: SectionSummaries[S]): string {
  const summarise: (summary: SectionSummaries[S]) => string = SUMMARIES[section];
  return summarise(summary);
}

/** What the checklist says under a section that is not ready. */
export const STATE_LINE: Readonly<Record<Exclude<ChecklistState, "ready">, string>> = {
  errors: t`Has problems to fix before a PMO can be built.`,
  unfinished: t`Needed for a PMO, and not finished yet.`,
  "left-out": t`Not finished, so it is left out of the PMO.`,
  needed: t`Nothing added yet. A PMO needs this step.`,
  "not-added": t`Optional.`,
};
