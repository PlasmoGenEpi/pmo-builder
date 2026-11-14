/**
 * What building one section gives, and the summary and fragment of each.
 */
import {
  collectWarnings,
  type BioinformaticsMethodInfo,
  type BioinformaticsRunInfo,
  type LibrarySampleInfoRecord,
  type MhapTableToPmoResult,
  type PanelInfoFragment,
  type ProjectInfo,
  type ReadCountByStageResult,
  type SequencingInfo,
  type SpecimenInfoRecord,
  type WarningSink,
} from "pmotools-ts";

import type { Notice, SectionId, SectionStatus } from "@/domain/types";

import { errorNotice, warningNotice, type TableIssueContext } from "./notices";

/** What the microhaplotypes step shows once the allele table builds. */
export interface MicrohaplotypesSummary {
  readonly rows: number;
  readonly librarySamples: number;
  readonly targets: number;
  /** Distinct representative microhaplotypes over all targets. */
  readonly microhaplotypes: number;
  /** Run names found in the table, in table order. Empty when no run name is given. */
  readonly runNames: readonly string[];
}

/** One panel of the panel section, as built. */
export interface PanelEntrySummary {
  readonly id: string;
  readonly name: string;
  readonly targets: number;
  readonly genomes: number;
  /** `panelContentKey` of the built fragment, to tell whether it is already saved. */
  readonly contentKey: string;
}

/** What the panel step shows once its panels build. */
export interface PanelSummary {
  readonly panels: readonly PanelEntrySummary[];
  /** Targets after merging the panels. */
  readonly targets: number;
  readonly genomes: number;
}

/** What the specimens step shows. */
export interface SpecimensSummary {
  readonly specimens: number;
}

/** What the library samples step shows. */
export interface LibrarySamplesSummary {
  readonly librarySamples: number;
}

/** What the project step shows. */
export interface ProjectSummary {
  readonly projects: number;
  readonly names: readonly string[];
}

/** What the sequencing step shows. */
export interface SequencingSummary {
  readonly runs: number;
  readonly names: readonly string[];
}

/** A bioinformatics method a run can refer to. */
export interface MethodOption {
  /** The value for `RunRecord.methodRef` and `RunTableDraft.methodRef`. */
  readonly key: string;
  /** The method's name. The value a method column must hold. */
  readonly name: string;
  readonly steps: number;
}

/** What the bioinformatics step shows. Present even when runs are not finished, so runs can pick a method. */
export interface BioinformaticsSummary {
  readonly methods: readonly MethodOption[];
  readonly runs: number;
  readonly runNames: readonly string[];
}

/** What the read counts step shows. */
export interface ReadCountsSummary {
  readonly librarySamples: number;
  readonly runs: number;
  /** Stage names in order of first appearance. */
  readonly stages: readonly string[];
}

/** The summary type of each section. */
export interface SectionSummaries {
  readonly microhaplotypes: MicrohaplotypesSummary;
  readonly panel: PanelSummary;
  readonly specimens: SpecimensSummary;
  readonly librarySamples: LibrarySamplesSummary;
  readonly project: ProjectSummary;
  readonly sequencing: SequencingSummary;
  readonly bioinformatics: BioinformaticsSummary;
  readonly readCounts: ReadCountsSummary;
}

/** The panel section's fragment: the merged panels, and each panel alone (for saving to the library). */
export interface PanelSectionFragment {
  readonly merged: PanelInfoFragment;
  readonly byPanel: Readonly<Record<string, PanelInfoFragment>>;
}

/** Bioinformatics methods and runs, ready for `mergeToPmo`. */
export interface BioinformaticsFragment {
  readonly methods: readonly BioinformaticsMethodInfo[];
  readonly runs: readonly BioinformaticsRunInfo[];
}

/** The fragment type of each section: what `mergeToPmo` takes for it. */
export interface SectionFragments {
  readonly microhaplotypes: MhapTableToPmoResult;
  readonly panel: PanelSectionFragment;
  readonly specimens: readonly SpecimenInfoRecord[];
  readonly librarySamples: readonly LibrarySampleInfoRecord[];
  readonly project: readonly ProjectInfo[];
  readonly sequencing: readonly SequencingInfo[];
  readonly bioinformatics: BioinformaticsFragment;
  readonly readCounts: ReadCountByStageResult;
}

/**
 * What building one section gives. `fragment` is set exactly when `status`
 * is `ready`. `summary` is set when there is something to show, which for
 * most sections is also only when `ready`.
 */
export interface SectionResult<S extends SectionId> {
  readonly section: S;
  readonly status: SectionStatus;
  readonly notices: readonly Notice[];
  readonly summary: SectionSummaries[S] | null;
  readonly fragment: SectionFragments[S] | null;
}

/** Results for every section. */
export type SectionResults = { readonly [S in SectionId]: SectionResult<S> };

/** A result with no fragment. */
export function notReady<S extends SectionId>(
  section: S,
  status: Exclude<SectionStatus, "ready">,
  notices: readonly Notice[] = [],
  summary: SectionSummaries[S] | null = null,
): SectionResult<S> {
  return { section, status, notices, summary, fragment: null };
}

/** A ready result. */
export function ready<S extends SectionId>(
  section: S,
  fragment: SectionFragments[S],
  summary: SectionSummaries[S],
  notices: readonly Notice[] = [],
): SectionResult<S> {
  return { section, status: "ready", notices, summary, fragment };
}

/** What {@link runBuilder} returns. */
export type BuilderRun<T> =
  | { readonly ok: true; readonly result: T; readonly notices: readonly Notice[] }
  | { readonly ok: false; readonly notices: readonly Notice[] };

/**
 * Runs a pmotools-ts builder inside `collectWarnings`, turning its warnings
 * and any thrown error into notices worded for the table.
 */
export function runBuilder<T>(
  issues: TableIssueContext,
  run: (onWarning: WarningSink) => T,
): BuilderRun<T> {
  try {
    const { result, warnings } = collectWarnings(run);
    return { ok: true, result, notices: warnings.map((warning) => warningNotice(warning, issues)) };
  } catch (error) {
    return { ok: false, notices: [errorNotice(error, issues)] };
  }
}

/** The worst of several statuses: error, then incomplete, then ready, then empty. */
export function worstStatus(statuses: readonly SectionStatus[]): SectionStatus {
  const order: readonly SectionStatus[] = ["error", "incomplete", "ready", "empty"];
  return order.find((status) => statuses.includes(status)) ?? "empty";
}
