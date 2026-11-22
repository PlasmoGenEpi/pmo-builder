/** Catalogue entries for tests of the "Published PMOs" pages. */
import type { MergeSummary } from "@/domain/build";
import {
  INDEX_VERSION,
  type PublishedDataset,
  type RepositoryIndex,
} from "@/domain/repository/types";

const SUMMARY: MergeSummary = {
  specimens: 50,
  librarySamples: 50,
  librarySamplesWithDetections: 49,
  panels: 1,
  targets: 276,
  targetsWithCalls: 21,
  genomes: 0,
  sequencingRuns: 1,
  projects: 1,
  bioinformaticsRuns: 1,
  librarySamplesWithReadCounts: 0,
};

/** A dataset with every field filled in. Pass the fields a test cares about. */
export function dataset(
  fields: Partial<PublishedDataset> & { readonly id: string },
): PublishedDataset {
  return {
    title: `Dataset ${fields.id}`,
    creators: ["Okello, Grace", "Mensah, Kofi"],
    published: "2026-11-14",
    version: null,
    licence: { id: "cc-by-4.0", title: "Creative Commons Attribution 4.0 International" },
    doi: `10.5281/zenodo.${fields.id}`,
    zenodoUrl: `https://zenodo.org/records/${fields.id}`,
    file: {
      name: "study.pmo.json.gz",
      size: 21_895,
      url: `https://zenodo.org/api/records/${fields.id}/files/study.pmo.json.gz/content`,
      fingerprint: JSON.stringify([
        "checksum",
        fields.id,
        "study.pmo.json.gz",
        21_895,
        `md5:${fields.id}`,
      ]),
    },
    summary: SUMMARY,
    panels: ["Mad4hatter"],
    countries: ["Mozambique"],
    collectionYears: { first: 2015, last: 2019 },
    taxa: [5833],
    bioProjects: [],
    ...fields,
  };
}

/** Three datasets that differ in panel, country and years. */
export const DATASETS: readonly PublishedDataset[] = [
  dataset({
    id: "301",
    title: "Maputo surveillance 2015 to 2019",
    bioProjects: ["PRJNA0000001"],
  }),
  dataset({
    id: "302",
    title: "Northern Uganda cohort",
    creators: ["Achan, Sarah"],
    panels: ["AMPLseq"],
    countries: ["Uganda"],
    collectionYears: { first: 2021, last: 2021 },
    summary: { ...SUMMARY, specimens: 1200, librarySamples: 1234, targets: 128 },
  }),
  dataset({
    id: "303",
    title: "Border travellers, Mozambique and Eswatini",
    panels: ["Mad4hatter", "AMPLseq"],
    countries: ["Eswatini", "Mozambique"],
    collectionYears: null,
    taxa: [5833, 5855],
    summary: { ...SUMMARY, specimens: 8, librarySamples: 8 },
  }),
];

/** A catalogue of {@link DATASETS}, or of the datasets given. */
export function catalogue(datasets: readonly PublishedDataset[] = DATASETS): RepositoryIndex {
  return {
    version: INDEX_VERSION,
    harvestedAt: "2026-11-15T03:00:00.000Z",
    community: "pmocommunity",
    datasets,
  };
}
