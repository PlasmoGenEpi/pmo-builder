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

const LARGE_COUNTRIES = [
  "Angola",
  "Benin",
  "Brazil",
  "Burkina Faso",
  "Cambodia",
  "Cameroon",
  "Democratic Republic of the Congo",
  "Ethiopia",
  "Gambia",
  "Ghana",
  "Kenya",
  "Madagascar",
  "Malawi",
  "Mali",
  "Mozambique",
  "Nigeria",
  "Papua New Guinea",
  "Peru",
  "Rwanda",
  "Senegal",
  "Tanzania",
  "Thailand",
  "Uganda",
  "Vietnam",
  "Zambia",
  "Zimbabwe",
] as const;

const LARGE_PANELS = [
  "Mad4hatter",
  "AMPLseq",
  "Paragon",
  "SpotMalaria",
  "Pf3k-Amp",
  "PvGT-Seq",
  "MalariaGen-v2",
  "MicroHap-East",
] as const;

const LARGE_AUTHORS = [
  "Okello, Grace",
  "Mensah, Kofi",
  "Achan, Sarah",
  "Diallo, Amadou",
  "Ndiaye, Fatou",
  "Mwangi, Peter",
  "Banda, Chipo",
  "Osei, Kwame",
  "Tadesse, Dawit",
  "Nhantumbo, Lucia",
  "Kone, Ibrahim",
  "Chanda, Mutale",
  "Ssemakula, David",
  "Kamara, Mariama",
  "Silva, Beatriz",
  "Nguyen, Linh",
  "Phiri, Thandiwe",
  "Okafor, Chinedu",
  "Borges, Carlos",
  "Ramos, Sofia",
] as const;

const STUDY_TOPICS = [
  "surveillance",
  "drug resistance cohort",
  "sentinel clinic study",
  "transmission monitoring",
  "cross-border genetics",
  "seasonal malaria survey",
] as const;

const LONG_TITLE_PREFIX =
  "Longitudinal genomic surveillance of antimalarial drug resistance markers and parasite population connectivity across sentinel clinics in";

const BASE_PUBLISHED_MS = Date.UTC(2026, 10, 14);
const DAY_MS = 86_400_000;

/** Deterministic Mulberry32 PRNG returning numbers in `[0, 1)`. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pickDistinct<T>({
  items,
  count,
  rand,
  first,
}: {
  readonly items: readonly T[];
  readonly count: number;
  readonly rand: () => number;
  readonly first?: T;
}): T[] {
  const chosen: T[] = first === undefined ? [] : [first];
  let guard = 0;
  while (chosen.length < count && guard < items.length * 4) {
    guard += 1;
    const candidate = items[Math.floor(rand() * items.length)];
    if (candidate !== undefined && !chosen.includes(candidate)) chosen.push(candidate);
  }
  return chosen;
}

function isoDateDaysBefore(days: number): string {
  return new Date(BASE_PUBLISHED_MS - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Deterministic seeded catalogue for large-list unit and end-to-end tests.
 * Covers 26 countries, 8 panels, collection years 2008 to 2026, specimens from
 * about 20 to 5,000 summing over 100,000 at 150 entries, 1 to 14 authors, long
 * titles over 120 characters, multi-country entries and both P. falciparum and
 * P. vivax.
 */
export function largeCatalogue(count = 150): RepositoryIndex {
  const rand = seededRandom(0x504d4f33);
  const datasets: PublishedDataset[] = [];

  for (let index = 0; index < count; index += 1) {
    const primaryCountry =
      index < LARGE_COUNTRIES.length
        ? LARGE_COUNTRIES[index]
        : LARGE_COUNTRIES[Math.floor(rand() * LARGE_COUNTRIES.length)];
    const countryCount = index % 25 === 4 ? 5 : rand() < 0.2 ? 2 : 1;
    const countries = pickDistinct({
      items: LARGE_COUNTRIES,
      count: countryCount,
      rand,
      first: primaryCountry,
    }).toSorted((a, b) => a.localeCompare(b));

    const primaryPanel =
      index < LARGE_PANELS.length
        ? LARGE_PANELS[index]
        : LARGE_PANELS[Math.floor(rand() * LARGE_PANELS.length)];
    const panelCount = rand() < 0.15 ? 2 : 1;
    const panels = pickDistinct({
      items: LARGE_PANELS,
      count: panelCount,
      rand,
      first: primaryPanel,
    }).toSorted((a, b) => a.localeCompare(b));

    const firstYear = index < 19 ? 2008 + index : 2008 + Math.floor(rand() * 18);
    const span = index < 19 ? Math.min(2, 2026 - firstYear) : Math.floor(rand() * 5);
    const lastYear = Math.min(2026, firstYear + span);

    const authorCount = index % 6 === 0 ? 1 : index % 6 === 1 ? 2 : 3 + Math.floor(rand() * 12);
    const creators = pickDistinct({ items: LARGE_AUTHORS, count: authorCount, rand });

    const bucket = rand();
    const specimens =
      bucket < 0.35
        ? 20 + Math.floor(rand() * 280)
        : bucket < 0.78
          ? 300 + Math.floor(rand() * 1_100)
          : 1_400 + Math.floor(rand() * 3_600);
    const librarySamples = specimens + Math.floor(rand() * 40);
    const targets = 80 + Math.floor(rand() * 320);

    const taxa: readonly number[] =
      index % 40 === 19 ? [5833, 5855] : index % 8 === 3 ? [5855] : [5833];

    const topic = STUDY_TOPICS[index % STUDY_TOPICS.length] ?? "surveillance";
    const yearLabel = firstYear === lastYear ? String(firstYear) : `${firstYear} to ${lastYear}`;
    const title =
      index % 10 === 2
        ? `${LONG_TITLE_PREFIX} ${primaryCountry ?? "Kenya"} (${yearLabel})`
        : `${primaryCountry ?? "Kenya"} ${topic} ${yearLabel}`;

    const id = String(10_001 + index);
    datasets.push(
      dataset({
        id,
        title,
        creators,
        published: isoDateDaysBefore(index * 4),
        countries,
        panels,
        collectionYears: { first: firstYear, last: lastYear },
        taxa,
        bioProjects: index % 4 === 0 ? [`PRJNA${String(900_000 + index)}`] : [],
        summary: {
          ...SUMMARY,
          specimens,
          librarySamples,
          librarySamplesWithDetections: Math.max(1, librarySamples - 2),
          panels: panels.length,
          targets,
          targetsWithCalls: Math.min(targets, 25 + Math.floor(rand() * 180)),
        },
      }),
    );
  }

  return catalogue(datasets);
}
