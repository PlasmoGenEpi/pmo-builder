/**
 * What working with an existing PMO gives and takes, kept apart so pages can
 * use the types without loading pmotools-ts onto the main thread.
 */
import type { PmoFileCheck } from "@/domain/build/checkFileResult";
import type { MergeSummary } from "@/domain/build/merge";
import type { PublicationSummary } from "@/domain/build/publication";

import type { AlleleLabel } from "./alleleLabels";

/** A flat table that can be downloaded from a PMO. */
export const TABLE_IDS = [
  "alleles",
  "specimens",
  "librarySamples",
  "targets",
  "panels",
  "travel",
  "projects",
  "sequencing",
  "bioinformaticsRuns",
  "bioinformaticsMethods",
  "genomes",
  "header",
] as const;

/** One of {@link TABLE_IDS}. */
export type TableId = (typeof TABLE_IDS)[number];

/** A table the PMO can give, with how many rows it has. */
export interface TableInfo {
  readonly id: TableId;
  readonly rows: number;
}

/** A specimen metadata value that specimens can be chosen by. */
export interface MetaValue {
  /** The value as compared: what the PMO holds, written as text. */
  readonly value: string;
  /** What to show: the value, or the name it stands for (a project's name for its id). */
  readonly label: string;
  /** How many specimens have it. */
  readonly count: number;
}

/** A specimen metadata field that specimens can be chosen by. */
export interface MetaField {
  readonly field: string;
  readonly values: readonly MetaValue[];
}

/** What can be chosen when making a subset. */
export interface PmoChoices {
  /**
   * Every specimen, with how many library samples it has (a specimen with
   * none cannot be kept) and its values for each field in {@link metadata}.
   */
  readonly specimens: readonly {
    readonly name: string;
    readonly librarySamples: number;
    readonly values: Readonly<Record<string, string>>;
  }[];
  /** Fields with between 2 and {@link MAX_META_VALUES} distinct values, such as the country. */
  readonly metadata: readonly MetaField[];
  /** Targets with at least one detected microhaplotype, the only ones a subset can keep. */
  readonly targets: readonly string[];
  /** How many targets have no detected microhaplotype, and so cannot be chosen. */
  readonly targetsWithoutData: number;
  /** The most reads any detected microhaplotype has. */
  readonly maxReads: number;
}

/** The most distinct values a metadata field may have to be offered as a choice. */
export const MAX_META_VALUES = 60;

/** What opening a PMO file gave. */
export type OpenOutcome =
  | {
      readonly kind: "opened";
      readonly fileName: string;
      readonly summary: MergeSummary;
      /** What a Zenodo record of the file would say. */
      readonly publication: PublicationSummary;
      /** Things worth a look that do not stop working with or publishing the file. */
      readonly warnings: readonly string[];
      readonly choices: PmoChoices;
      readonly tables: readonly TableInfo[];
    }
  /** The file cannot be worked with. Says why, as checking for publishing does. */
  | { readonly kind: "refused"; readonly check: Exclude<PmoFileCheck, { kind: "ready" }> };

/** Which specimens a subset keeps. */
export type SpecimenChoice =
  | { readonly kind: "all" }
  | { readonly kind: "names"; readonly names: readonly string[] }
  /** Specimens matching every field, each to one of its values. */
  | { readonly kind: "metadata"; readonly criteria: Readonly<Record<string, readonly string[]>> };

/** Which targets a subset keeps. */
export type TargetChoice =
  | { readonly kind: "all" }
  | { readonly kind: "names"; readonly names: readonly string[] };

/** A subset to make of the opened PMO. */
export interface SubsetRequest {
  readonly specimens: SpecimenChoice;
  readonly targets: TargetChoice;
  /** Keep only detected microhaplotypes with at least this many reads. 0 keeps all. */
  readonly minReads: number;
}

/**
 * What a subset would keep, counted without making it. The counts are those
 * the made subset's summary gives.
 */
export interface SubsetPreview {
  readonly specimens: number;
  readonly librarySamples: number;
  /** Library samples with at least one microhaplotype left. None means nothing is left. */
  readonly librarySamplesWithData: number;
  /** Targets with at least one microhaplotype left. */
  readonly targetsWithCalls: number;
}

/** What making a subset gave. */
export type SubsetOutcome =
  | {
      readonly kind: "made";
      readonly fileName: string;
      readonly summary: MergeSummary;
      /** What a Zenodo record of the subset would say. */
      readonly publication: PublicationSummary;
      readonly tables: readonly TableInfo[];
      /** Problems found when checking the subset. Empty when it is a valid PMO. */
      readonly problems: readonly string[];
    }
  /** No library sample has data left. */
  | { readonly kind: "empty" }
  /** No PMO is open. */
  | { readonly kind: "not-open" }
  | { readonly kind: "failed"; readonly message: string };

/** Which PMO a download comes from. */
export type WorkingSource = "original" | "subset";

/** A table as a file. */
export interface TableFile {
  readonly fileName: string;
  readonly text: string;
}

/** Every table of a PMO, as files in one zip. */
export interface TablesArchive {
  readonly fileName: string;
  readonly blob: Blob;
}

/** The delimited formats a table can be written in. */
export type TableFormat = "csv" | "tsv";

/** What kind of control a specimen is, from its `specimen_type`. */
export type ControlKind = "negative" | "positive" | "other";

/** Where a library was prepared on a plate. */
export interface PlateWell {
  readonly plate: string;
  /** The row letter, such as `B`. */
  readonly row: string;
  /** The column, counted from 1. */
  readonly col: number;
}

/** A parasite density, and where it came from. */
export interface Density {
  /** Parasites per microlitre. */
  readonly value: number;
  readonly method: string;
  /** `library` for the library sample's qPCR, `specimen` for the specimen's own. */
  readonly from: "library" | "specimen";
}

/** One library sample of one run, in a PMO's summary. */
export interface SampleSummary {
  /** Its index in `library_sample_info`. */
  readonly libraryId: number;
  readonly name: string;
  readonly specimen: string | null;
  /**
   * The bioinformatics run's name, or its position when it has none. Empty for
   * a library sample with no detected microhaplotypes in any run.
   */
  readonly run: string;
  /** Targets with at least one microhaplotype counted. */
  readonly targets: number;
  /** Reads of the microhaplotypes counted, over every target. */
  readonly reads: number;
  /**
   * The most microhaplotypes counted at any one target: a simple estimate of
   * the number of clones (complexity of infection) in the sample.
   */
  readonly maxAlleles: number;
  /** `null` for a field sample, or when the specimen has no `specimen_type`. */
  readonly control: ControlKind | null;
  readonly plate: PlateWell | null;
  readonly density: Density | null;
  /** Total raw reads from the read counts by stage, when given. */
  readonly rawReads: number | null;
  /** Reads at each stage of `PmoSummary.stages`, summed over targets; `null` where not given. */
  readonly stageReads: readonly (number | null)[];
}

/** A specimen field the Compare tab can group by. */
export type GroupKey =
  | "collection_country"
  | "geo_admin1"
  | "geo_admin2"
  | "geo_admin3"
  | "collection_year"
  | "collection_month"
  | "project";

/** A field that can group specimens, and how much of the file has it. */
export interface GroupField {
  readonly key: GroupKey;
  /** Specimens with a value. */
  readonly present: number;
  readonly total: number;
  /** Distinct values. */
  readonly distinct: number;
}

/** A panel reaction (pool), and the targets amplified in it. */
export interface ReactionGroup {
  readonly panel: string;
  readonly name: string;
  /** Indexes into `PmoSummary.targets`. */
  readonly targets: readonly number[];
}

/** One microhaplotype of a target, and how often it was seen. */
export interface AlleleShare {
  readonly mhapId: number;
  readonly seq: string;
  /** What tells it apart from the target's other microhaplotypes. */
  readonly label: AlleleLabel;
  /** How many library samples carry it. */
  readonly count: number;
  /** Its share of the target's detections, 0 to 1. */
  readonly freq: number;
}

/** One target, in a PMO's summary. */
export interface TargetSummary {
  readonly name: string;
  /** Library samples with at least one microhaplotype counted here. */
  readonly samples: number;
  /** Its microhaplotypes, most frequent first. */
  readonly alleles: readonly AlleleShare[];
  /** Expected heterozygosity, 1 minus the sum of squared frequencies; `null` without data. */
  readonly heterozygosity: number | null;
}

/** What the Summary tab shows. */
export interface PmoSummary {
  /** Microhaplotypes with fewer reads were left out of every figure. */
  readonly minReads: number;
  readonly runs: number;
  readonly librarySamples: number;
  /**
   * One per library sample of each run, in file order, including those with
   * nothing above the threshold; then each library sample with no detections.
   */
  readonly samples: readonly SampleSummary[];
  /** Every target, in the order of the panel's target table. */
  readonly targets: readonly TargetSummary[];
  /**
   * Reads per sample and target: row `i` is `samples[i]`, column `j` is
   * `targets[j]`, stored row by row. `0` where nothing was counted.
   */
  readonly grid: { readonly columns: number; readonly reads: readonly number[] };
  /** The pipeline stages in the read counts by stage, in the order first given. */
  readonly stages: readonly string[];
  /** The panels' reactions, in order. */
  readonly reactions: readonly ReactionGroup[];
  /** Fields the Compare tab can group by: those with at least one value. */
  readonly groupFields: readonly GroupField[];
  readonly headline: {
    readonly samplesWithData: number;
    readonly targetsWithData: number;
    readonly medianTargets: number | null;
    readonly medianReads: number | null;
    /** Samples with more than one microhaplotype at some target. */
    readonly polyclonal: number;
  };
}

/** One group in a comparison. */
export interface GroupRow {
  /** The value, or `null` for specimens without one. */
  readonly name: string | null;
  readonly specimens: number;
  readonly librarySamples: number;
  /** Library samples with at least one microhaplotype counted. */
  readonly withData: number;
  /** Library samples with two or more alleles at some target. */
  readonly polyclonal: number;
  /** Mean expected heterozygosity over targets with data in the group. */
  readonly meanHeterozygosity: number | null;
  /** Distinct microhaplotypes seen in the group, over every target. */
  readonly alleles: number;
}

/** One target across the groups of a comparison. */
export interface TargetAcrossGroups {
  readonly name: string;
  /** Per group, in the order of `GroupComparison.groups`. */
  readonly heterozygosity: readonly (number | null)[];
  /** Its microhaplotypes, most frequent overall first, with their frequency in each group. */
  readonly alleles: readonly {
    readonly mhapId: number;
    readonly seq: string;
    readonly label: AlleleLabel;
    readonly freqs: readonly (number | null)[];
  }[];
}

/** Specimens grouped by one field, side by side. */
export interface GroupComparison {
  readonly key: GroupKey;
  readonly groups: readonly GroupRow[];
  readonly targets: readonly TargetAcrossGroups[];
  /** Specimens per month (or per year, when no date gives the month), oldest first. */
  readonly timeline: readonly { readonly period: string; readonly specimens: number }[];
  readonly timelineUnit: "month" | "year" | null;
  /** Specimens whose date gives the period, of all specimens. */
  readonly dated: number;
}

/**
 * What each kind of request about the working PMO carries, besides its kind.
 * A new operation is a new kind here, its answer in {@link WorkingPmoValues},
 * and its handler in `answerWorkingPmo`.
 */
export interface WorkingPmoRequests {
  /** Reads and checks a PMO file, and holds it in place of the PMO held before. */
  readonly open: { readonly file: Blob; readonly fileName: string };
  /** Lets go of the PMO held, and its subset. */
  readonly close: object;
  /** The summary of the original or the subset, counting microhaplotypes with at least `minReads` reads. */
  readonly summary: { readonly source: WorkingSource; readonly minReads: number };
  /** One table of the original or the subset, as a CSV or TSV file. */
  readonly table: {
    readonly source: WorkingSource;
    readonly id: TableId;
    readonly format: TableFormat;
  };
  /** Every table of the original or the subset, as files in one zip. */
  readonly tables: { readonly source: WorkingSource; readonly format: TableFormat };
}

/** One kind of request about the working PMO. */
export type WorkingPmoKind = keyof WorkingPmoRequests;

/** A request about the working PMO, of kind `K` (any kind by default), sent to the worker. */
export type WorkingPmoRequest<K extends WorkingPmoKind = WorkingPmoKind> = {
  readonly [P in K]: { readonly kind: P } & WorkingPmoRequests[P];
}[K];

/** The kinds of request that read the working PMO without opening or closing it. */
export type WorkingPmoQueryKind = Exclude<WorkingPmoKind, "open" | "close">;

/** A request that reads the working PMO without opening or closing it. */
export type WorkingPmoQuery<K extends WorkingPmoQueryKind = WorkingPmoQueryKind> =
  WorkingPmoRequest<K>;

/** What each kind of request gives when it succeeds. */
export interface WorkingPmoValues {
  readonly open: OpenOutcome;
  readonly close: null;
  readonly summary: PmoSummary;
  readonly table: TableFile;
  readonly tables: TablesArchive;
}

/** A request, with the generation of the working PMO it is meant for. */
export interface WorkingPmoCall<K extends WorkingPmoKind = WorkingPmoKind> {
  /** Goes up with every open or close. A request for an older generation is answered as stale. */
  readonly generation: number;
  readonly request: WorkingPmoRequest<K>;
}

/** What a request about the working PMO gives. */
export type WorkingPmoResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** No PMO is open. */
  | { readonly kind: "not-open" }
  /** The request is for the subset, and none has been made. */
  | { readonly kind: "no-subset" }
  /** The request was for a PMO that has since been closed or replaced. Callers ignore it. */
  | { readonly kind: "stale" }
  | { readonly kind: "failed"; readonly message: string };

/** What a request of kind `K` gives. */
export type WorkingPmoAnswer<K extends WorkingPmoKind> = WorkingPmoResult<WorkingPmoValues[K]>;
