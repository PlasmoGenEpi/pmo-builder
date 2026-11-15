/**
 * What working with an existing PMO gives and takes, kept apart so pages can
 * use the types without loading pmotools-ts onto the main thread.
 */
import type { PmoFileCheck } from "@/domain/build/checkFileResult";
import type { MergeSummary } from "@/domain/build/merge";
import type { PublicationSummary } from "@/domain/build/publication";

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

/** The delimited formats a table can be written in. */
export type TableFormat = "csv" | "tsv";
