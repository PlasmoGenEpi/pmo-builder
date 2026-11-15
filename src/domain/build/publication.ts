/**
 * What someone needs to know about a built PMO before publishing it: which
 * details about the people sampled it holds, and the facts a repository
 * record would describe it with.
 */
import type { PortableMicrohaplotypeObject } from "pmotools-ts";

/**
 * Specimen fields that can help identify a person, alone or together.
 * `collection_date` counts only when it names a day.
 */
export const PERSONAL_FIELDS = [
  "host_subject_name",
  "alternate_identifiers",
  "lat_lon",
  "geo_admin3",
  "collection_date",
  "host_age",
  "host_sex",
  "gravidity",
  "travel_out_six_month",
  "specimen_comments",
] as const;

/** One of {@link PERSONAL_FIELDS}. */
export type PersonalField = (typeof PERSONAL_FIELDS)[number];

/** How many specimens have a value for one personal field. */
export interface PersonalFieldCount {
  readonly field: PersonalField;
  readonly specimens: number;
}

/** One project of the PMO, as a repository record would name it. */
export interface PublicationProject {
  readonly name: string;
  readonly description: string;
  /** The BioProject accession, or `null` when none is given. */
  readonly accession: string | null;
}

/** The first and last year specimens were collected. */
export interface YearRange {
  readonly first: number;
  readonly last: number;
}

/** What the publish panel shows for a built PMO. */
export interface PublicationSummary {
  /** Personal fields with at least one value, in the order of {@link PERSONAL_FIELDS}. */
  readonly personalFields: readonly PersonalFieldCount[];
  readonly projects: readonly PublicationProject[];
  /** Panel names, in PMO order. */
  readonly panels: readonly string[];
  /** Distinct collection countries, sorted. */
  readonly countries: readonly string[];
  /** `null` when no specimen has a collection date with a year. */
  readonly collectionYears: YearRange | null;
}

/** The parts of a PMO the publication facts are read from. */
export type PublicationSource = Pick<
  PortableMicrohaplotypeObject,
  "specimen_info" | "project_info" | "panel_info"
>;

type Specimen = PublicationSource["specimen_info"][number];

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return !Number.isNaN(value);
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some(hasValue);
  return true;
}

/** A date that names a day, such as `2021-03-15`. A year or a month alone does not count. */
const DAY = /^\d{4}-\d{1,2}-\d{1,2}/;
const YEAR = /^(\d{4})(?!\d)/;

const PERSONAL: Readonly<Record<PersonalField, (specimen: Specimen) => boolean>> = {
  host_subject_name: (specimen) => hasValue(specimen.host_subject_name),
  alternate_identifiers: (specimen) => hasValue(specimen.alternate_identifiers),
  lat_lon: (specimen) => hasValue(specimen.lat_lon),
  geo_admin3: (specimen) => hasValue(specimen.geo_admin3),
  collection_date: (specimen) =>
    typeof specimen.collection_date === "string" && DAY.test(specimen.collection_date.trim()),
  host_age: (specimen) => hasValue(specimen.host_age),
  host_sex: (specimen) => hasValue(specimen.host_sex),
  gravidity: (specimen) => hasValue(specimen.gravid) || hasValue(specimen.gravidity),
  travel_out_six_month: (specimen) =>
    hasValue(specimen.has_travel_out_six_month) || hasValue(specimen.travel_out_six_month),
  specimen_comments: (specimen) => hasValue(specimen.specimen_comments),
};

function collectionYears(specimens: readonly Specimen[]): YearRange | null {
  let range: YearRange | null = null;
  for (const specimen of specimens) {
    const match =
      typeof specimen.collection_date === "string"
        ? YEAR.exec(specimen.collection_date.trim())
        : null;
    if (match === null) continue;
    const year = Number(match[1]);
    range =
      range === null
        ? { first: year, last: year }
        : { first: Math.min(range.first, year), last: Math.max(range.last, year) };
  }
  return range;
}

/** Reads the publication facts out of a PMO. */
export function summarisePublication(pmo: PublicationSource): PublicationSummary {
  const specimens = pmo.specimen_info;
  const personalFields = PERSONAL_FIELDS.map((field) => ({
    field,
    specimens: specimens.filter(PERSONAL[field]).length,
  })).filter((entry) => entry.specimens > 0);
  const countries = new Set<string>();
  for (const specimen of specimens) {
    if (typeof specimen.collection_country === "string" && specimen.collection_country.trim())
      countries.add(specimen.collection_country.trim());
  }
  return {
    personalFields,
    projects: (pmo.project_info ?? []).map((project) => ({
      name: project.project_name,
      description: project.project_description,
      accession: hasValue(project.BioProject_accession)
        ? String(project.BioProject_accession).trim()
        : null,
    })),
    panels: pmo.panel_info.map((panel) => panel.panel_name),
    countries: [...countries].toSorted((a, b) => a.localeCompare(b)),
    collectionYears: collectionYears(specimens),
  };
}
