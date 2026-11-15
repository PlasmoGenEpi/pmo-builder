/**
 * Publishing a PMO to Zenodo by hand: where the community's upload page is,
 * and the record details the app suggests. Nothing here talks to Zenodo.
 */
import type { MergeSummary, PersonalField, PublicationSummary } from "@/domain/build";

import { count } from "./reviewModel";

/** The keyword that puts a record in the community's "PMO files" collection. */
export const PMO_KEYWORD = "Portable Microhaplotype Object";

const PMO_DOCS = "https://plasmogenepi.github.io/PMO_Docs/";

/** A Zenodo community identifier: lower-case letters, digits, hyphens and underscores. */
const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * The Zenodo community from `VITE_ZENODO_COMMUNITY`, or `null` when it is
 * unset or not an identifier. The publish panel is hidden when it is `null`.
 */
export function zenodoCommunity(
  value: string | undefined = import.meta.env.VITE_ZENODO_COMMUNITY,
): string | null {
  const slug = value?.trim() ?? "";
  return SLUG.test(slug) ? slug : null;
}

/** Where PMO files are published, and how. */
export interface ZenodoConfig {
  /** The community's identifier. */
  readonly community: string;
  /** What the community is called on screen. */
  readonly communityName: string;
  /**
   * The application registered with Zenodo, or `null` when there is none.
   * Without it the panel only guides the user through uploading by hand.
   */
  readonly clientId: string | null;
}

/** What the build can set. */
export interface ZenodoEnv {
  readonly VITE_ZENODO_COMMUNITY?: string | undefined;
  readonly VITE_ZENODO_COMMUNITY_NAME?: string | undefined;
  readonly VITE_ZENODO_CLIENT_ID?: string | undefined;
}

/** The build's Zenodo settings, or `null` when no community is set. */
export function zenodoConfig(env: ZenodoEnv = import.meta.env): ZenodoConfig | null {
  const community = zenodoCommunity(env.VITE_ZENODO_COMMUNITY);
  if (community === null) return null;
  const name = env.VITE_ZENODO_COMMUNITY_NAME?.trim() ?? "";
  const clientId = env.VITE_ZENODO_CLIENT_ID?.trim() ?? "";
  return {
    community,
    communityName: name === "" ? community : name,
    clientId: clientId === "" ? null : clientId,
  };
}

/** The community's own page. */
export function communityUrl(community: string): string {
  return `https://zenodo.org/communities/${community}/`;
}

/** A new upload with the community already chosen. */
export function uploadUrl(community: string): string {
  return `https://zenodo.org/uploads/new?community=${encodeURIComponent(community)}`;
}

/** What each personal field is called on screen. */
export const PERSONAL_FIELD_LABELS: Readonly<Record<PersonalField, string>> = {
  host_subject_name: "Subject names or codes",
  alternate_identifiers: "Other specimen identifiers",
  lat_lon: "Coordinates",
  geo_admin3: "Smallest administrative area",
  collection_date: "Collection dates that name the day",
  host_age: "Age",
  host_sex: "Sex",
  gravidity: "Pregnancy",
  travel_out_six_month: "Travel history",
  specimen_comments: "Free-text comments",
};

/** The details the app suggests for the Zenodo record. */
export interface SuggestedRecord {
  readonly title: string;
  readonly description: string;
  /** {@link PMO_KEYWORD} first. */
  readonly keywords: readonly string[];
}

function list(items: readonly string[]): string {
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(items);
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function panelPhrase(panels: readonly string[]): string {
  return `the ${list(panels)} ${panels.length === 1 ? "panel" : "panels"}`;
}

function title(summary: MergeSummary, publication: PublicationSummary): string {
  const [project] = publication.projects;
  if (publication.projects.length === 1 && project !== undefined && project.name.trim() !== "")
    return `${project.name.trim()}: microhaplotype data in PMO format`;
  const samples = count(summary.librarySamples, "sample");
  return publication.panels.length === 0
    ? `Microhaplotype data for ${samples} in PMO format`
    : `Microhaplotype data for ${samples} from ${panelPhrase(publication.panels)} in PMO format`;
}

function description(summary: MergeSummary, publication: PublicationSummary): string {
  const years = publication.collectionYears;
  const when =
    years === null
      ? ""
      : years.first === years.last
        ? ` in ${years.first}`
        : ` between ${years.first} and ${years.last}`;
  const where = publication.countries.length === 0 ? "" : ` in ${list(publication.countries)}`;
  const accessions = publication.projects
    .map((project) => project.accession)
    .filter((accession) => accession !== null);
  const parts = [
    `${PMO_KEYWORD} (PMO) file with microhaplotype calls for ${count(summary.librarySamples, "library sample")} from ${count(summary.specimens, "specimen")}, genotyped with ${panelPhrase(publication.panels)} (${count(summary.targets, "target")}).`,
    where === "" && when === "" ? null : `Specimens were collected${where}${when}.`,
    ...publication.projects.map((project) =>
      project.description.trim() === ""
        ? null
        : sentence(`${project.name.trim()}: ${project.description}`),
    ),
    accessions.length === 0
      ? null
      : `Raw reads: ${accessions.length === 1 ? "BioProject" : "BioProjects"} ${list(accessions)}.`,
    `The PMO format is described at ${PMO_DOCS}`,
  ];
  return parts.filter((part) => part !== null).join(" ");
}

/** A title, description and keywords for the record, written from the PMO's own contents. */
export function suggestRecord(
  summary: MergeSummary,
  publication: PublicationSummary,
): SuggestedRecord {
  return {
    title: title(summary, publication),
    description: description(summary, publication),
    keywords: [
      PMO_KEYWORD,
      "PMO",
      "microhaplotype",
      "targeted amplicon sequencing",
      ...publication.panels,
    ],
  };
}
