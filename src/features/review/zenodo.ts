/**
 * Publishing a PMO to Zenodo by hand: where the community's upload page is,
 * and the record details the app suggests. Nothing here talks to Zenodo.
 *
 * The record's title, description and keywords stay in English whatever the
 * interface language, so the community's records read alike. Only the labels
 * shown on screen are translated.
 */
import { t } from "@lingui/core/macro";

import type { MergeSummary, PersonalField, PublicationSummary } from "@/domain/build";

import { count } from "./reviewModel";

/** The keyword that marks a record as a PMO file. The list of published PMOs is built from it. */
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
  host_subject_name: t`Subject names or codes`,
  alternate_identifiers: t`Other specimen identifiers`,
  lat_lon: t`Coordinates`,
  geo_admin3: t`Smallest administrative area`,
  collection_date: t`Collection dates that name the day`,
  host_age: t`Age`,
  host_sex: t`Sex`,
  gravidity: t`Pregnancy`,
  travel_out_six_month: t`Travel history`,
  specimen_comments: t`Free-text comments`,
};

/** A person who made the data, as Zenodo stores an author. */
export interface Creator {
  readonly family: string;
  /** Empty when only one name is known. */
  readonly given: string;
}

/** The details the app suggests for the Zenodo record. */
export interface SuggestedRecord {
  readonly title: string;
  readonly description: string;
  /** {@link PMO_KEYWORD} first. */
  readonly keywords: readonly string[];
  /** From the PMO's projects, chief scientist first. The user can change them before depositing. */
  readonly creators: readonly Creator[];
  /** BioProject accessions the PMO names, linked from the record as the data it comes from. */
  readonly accessions: readonly string[];
}

/**
 * Reads one author. "Family, Given" is taken as written. Without a comma, the
 * last word is taken as the family name, as in "Grace Okello".
 */
export function parseCreator(text: string): Creator | null {
  const clean = text.trim().replaceAll(/\s+/g, " ");
  if (clean === "") return null;
  const comma = clean.indexOf(",");
  if (comma !== -1) {
    const family = clean.slice(0, comma).trim();
    const given = clean.slice(comma + 1).trim();
    return family === "" ? (given === "" ? null : { family: given, given: "" }) : { family, given };
  }
  const words = clean.split(" ");
  const family = words.pop() ?? clean;
  return { family, given: words.join(" ") };
}

/** Reads authors written one to a line. Blank lines are skipped. */
export function parseCreators(text: string): Creator[] {
  return text
    .split(/\r?\n/)
    .map(parseCreator)
    .filter((creator) => creator !== null);
}

/** Writes authors one to a line, as "Family, Given". */
export function formatCreators(creators: readonly Creator[]): string {
  return creators
    .map((creator) =>
      creator.given === "" ? creator.family : `${creator.family}, ${creator.given}`,
    )
    .join("\n");
}

/**
 * The Zenodo record a user means, from a record address, a DOI or a number:
 * `https://zenodo.org/records/123`, `10.5281/zenodo.123` or `123`.
 */
export function zenodoRecordId(text: string): string | null {
  const clean = text.trim();
  const match =
    /^(\d+)$/.exec(clean) ??
    /zenodo\.org\/(?:records?|uploads|deposit)\/(\d+)/i.exec(clean) ??
    /10\.5281\/zenodo\.(\d+)/i.exec(clean);
  return match?.[1] ?? null;
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
    creators: dedupeCreators(
      publication.projects.flatMap((project) => project.people.map(parseCreator)),
    ),
    accessions: [
      ...new Set(
        publication.projects
          .map((project) => project.accession)
          .filter((accession) => accession !== null),
      ),
    ],
  };
}

function dedupeCreators(creators: readonly (Creator | null)[]): Creator[] {
  const seen = new Set<string>();
  const unique: Creator[] = [];
  for (const creator of creators) {
    if (creator === null) continue;
    const key = `${creator.family}\u0000${creator.given}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(creator);
  }
  return unique;
}
