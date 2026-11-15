/**
 * The catalogue of PMO files published in the Zenodo community: what the
 * harvester writes and the "Published PMOs" pages read.
 *
 * The catalogue is derived from Zenodo and can be rebuilt from it at any
 * time. Nothing is entered into it by hand.
 */
import type { MergeSummary, YearRange } from "@/domain/build";

/** Bumped when the shape of the index changes. */
export const INDEX_VERSION = 1;

/** Where the harvester writes, under `public/`, and the pages read from. */
export const REPOSITORY_PATH = "repository";

/** The PMO file of a published record. */
export interface PublishedFile {
  readonly name: string;
  /** Bytes, as stored on Zenodo. */
  readonly size: number;
  /** Where the file can be downloaded from Zenodo. */
  readonly url: string;
}

/** The licence a record was published under. */
export interface PublishedLicence {
  readonly id: string;
  readonly title: string;
}

/** One published PMO. */
export interface PublishedDataset {
  /** The Zenodo record's identifier. */
  readonly id: string;
  readonly title: string;
  /** Authors' names as Zenodo gives them, such as "Okello, Grace". */
  readonly creators: readonly string[];
  /** The publication date, `YYYY-MM-DD` or as much of it as the record gives. */
  readonly published: string;
  readonly version: string | null;
  readonly licence: PublishedLicence | null;
  readonly doi: string | null;
  /** The record's page on Zenodo. */
  readonly zenodoUrl: string;
  readonly file: PublishedFile;
  readonly summary: MergeSummary;
  readonly panels: readonly string[];
  /** Distinct collection countries, sorted. */
  readonly countries: readonly string[];
  readonly collectionYears: YearRange | null;
  /** Distinct NCBI taxon identifiers of the specimens, sorted. */
  readonly taxa: readonly number[];
  readonly bioProjects: readonly string[];
}

/** The catalogue. */
export interface RepositoryIndex {
  readonly version: typeof INDEX_VERSION;
  /** When the harvester last ran, as an ISO date and time. */
  readonly harvestedAt: string;
  /** The Zenodo community the records come from. */
  readonly community: string;
  /** Newest first. */
  readonly datasets: readonly PublishedDataset[];
}

/**
 * One specimen of one published PMO. Written beside the index for a later
 * search across datasets; no page reads it yet.
 */
export interface SpecimenRow {
  readonly dataset: string;
  readonly specimen: string;
  readonly country: string | null;
  readonly date: string | null;
  readonly taxa: readonly number[];
  readonly librarySamples: number;
}

/** A record the harvester left out, and why. For the curators, not for the pages. */
export interface SkippedRecord {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
}

/** What one harvest gives. */
export interface HarvestResult {
  readonly index: RepositoryIndex;
  readonly specimens: readonly SpecimenRow[];
  readonly skipped: readonly SkippedRecord[];
}
