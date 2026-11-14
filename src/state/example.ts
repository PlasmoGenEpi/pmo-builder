/**
 * The MAD4HATTER example: which file in `public/examples` goes into which
 * slot. The metadata table is imported twice, as specimens and as library
 * samples, as a user would.
 */
import type { TableSlot } from "@/domain/draft";

/** A slot for an example file. A panel slot's `panelId` is filled in with the draft's first panel. */
export type ExampleSlot =
  | Exclude<TableSlot, { readonly section: "panel" }>
  | { readonly section: "panel"; readonly part: "targets" | "genome" };

/** One example file and where it goes. */
export interface ExampleFile {
  /** Relative to the page, so the app's own origin serves it under any base path. */
  readonly path: string;
  readonly fileName: string;
  readonly slot: ExampleSlot;
}

function example(fileName: string, slot: ExampleSlot): ExampleFile {
  return { path: `examples/${fileName}`, fileName, slot };
}

/**
 * The example files, in import order. Each is mapped by the plain suggested
 * mapping, as a user's file would be.
 */
export const EXAMPLE_FILES: readonly ExampleFile[] = [
  example("mad4hatter_allele_data_example.csv", { section: "microhaplotypes" }),
  example("mad4hatter_panel_info_example.csv", { section: "panel", part: "targets" }),
  example("mad4hatter_metadata_example.tsv", { section: "specimens" }),
  example("mad4hatter_metadata_example.tsv", { section: "librarySamples" }),
  example("example_raw_reads.txt", { section: "readCounts", part: "totals" }),
  example("reads_per_stage.txt", { section: "readCounts", part: "byStage" }),
];
