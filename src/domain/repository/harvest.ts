/**
 * Builds the catalogue from the Zenodo community: lists the accepted records
 * that carry the PMO keyword, reads each PMO file, and keeps the ones that
 * match the PMO format.
 *
 * Runs in Node from `scripts/harvest.mjs`, never in the browser.
 */
import {
  checkPmoIntegrity,
  parsePmo,
  validatePmo,
  type PortableMicrohaplotypeObject,
} from "pmotools-ts";

import {
  summarisePmo,
  summarisePublication,
  type MergeSummary,
  type YearRange,
} from "@/domain/build";

import {
  INDEX_VERSION,
  type HarvestResult,
  type PublishedDataset,
  type PublishedFile,
  type PublishedLicence,
  type SkippedRecord,
  type SpecimenRow,
} from "./types";

const ZENODO = "https://zenodo.org";
const RECORD_JSON = "application/vnd.inveniordm.v1+json";

/** The keyword that marks a record as a PMO file. The deposit panel adds it. */
export const PMO_SUBJECT = "Portable Microhaplotype Object";

/** A PMO file larger than this is left out, so one record cannot stall the harvest. */
export const MAX_FILE_BYTES = 500 * 1024 * 1024;

/** Zenodo refuses a larger page to a client that is not signed in. */
const PAGE_SIZE = 25;
/** A guard against a listing that never ends. */
const MAX_PAGES = 1_000;

/** A previous catalogue and its per-specimen rows, passed in for carry-over. */
export interface PreviousCatalogue {
  readonly index: unknown;
  readonly specimens: unknown;
}

/** What a harvest needs. */
export interface HarvestOptions {
  /** The community's identifier. */
  readonly community: string;
  /** Default: the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Default: the time the harvest starts. */
  readonly now?: Date;
  /** Told about each record as it is read or left out. */
  readonly log?: (message: string) => void;
  /** The previous catalogue and specimen rows to carry unchanged records over from. */
  readonly previous?: PreviousCatalogue;
}

/** Raised when the community's listing cannot be read to its end, as opposed to one record being left out. */
export class HarvestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarvestError";
  }
}

type Json = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: unknown, ...path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function text(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The PMO file found in a Zenodo listing hit. */
export interface ListedPmoFile {
  readonly name: string;
  readonly size: number;
  readonly checksum: string | null;
}

/** The record's PMO file: a `.json` or `.json.gz` file, a `.pmo.` name first. */
export function pmoFileOf(record: unknown): ListedPmoFile | null {
  const entries = field(record, "files", "entries");
  if (!isRecord(entries)) return null;
  const files = Object.values(entries)
    .map((entry) => ({
      name: text(field(entry, "key")),
      size: field(entry, "size"),
      checksum: text(field(entry, "checksum")),
    }))
    .filter(
      (file): file is ListedPmoFile =>
        file.name !== null &&
        typeof file.size === "number" &&
        Number.isFinite(file.size) &&
        /\.json(\.gz)?$/i.test(file.name),
    )
    .toSorted(
      (a, b) =>
        Number(/\.pmo\./i.test(b.name)) - Number(/\.pmo\./i.test(a.name)) ||
        a.name.localeCompare(b.name),
    );
  return files[0] ?? null;
}

function fileFingerprintOf(
  recordId: string | null,
  record: unknown,
  found: ListedPmoFile,
): string | null {
  if (recordId === null) return null;
  if (found.checksum !== null) {
    return JSON.stringify(["checksum", recordId, found.name, found.size, found.checksum]);
  }
  const updated = text(field(record, "updated"));
  const revision = text(field(record, "revision_id"));
  if (updated !== null || revision !== null) {
    return JSON.stringify(["revision", recordId, found.name, found.size, updated, revision]);
  }
  return null;
}

function licenceOf(record: unknown): PublishedLicence | null {
  const [first] = list(field(record, "metadata", "rights"));
  const id = text(field(first, "id"));
  if (id === null) return null;
  return { id, title: text(field(first, "title", "en")) ?? id };
}

function taxaOf(pmo: PortableMicrohaplotypeObject): number[] {
  const taxa = new Set<number>();
  for (const specimen of pmo.specimen_info) {
    for (const taxon of specimen.specimen_taxon_id ?? []) {
      if (Number.isInteger(taxon)) taxa.add(taxon);
    }
  }
  return [...taxa].toSorted((a, b) => a - b);
}

function specimenRows(dataset: string, pmo: PortableMicrohaplotypeObject): SpecimenRow[] {
  const libraries = new Map<number, number>();
  for (const library of pmo.library_sample_info) {
    libraries.set(library.specimen_id, (libraries.get(library.specimen_id) ?? 0) + 1);
  }
  return pmo.specimen_info.map((specimen, index) => ({
    dataset,
    specimen: specimen.specimen_name,
    country: text(specimen.collection_country),
    date: text(specimen.collection_date),
    taxa: (specimen.specimen_taxon_id ?? []).filter((taxon) => Number.isInteger(taxon)),
    librarySamples: libraries.get(index) ?? 0,
  }));
}

/** The version the record names, or its number when it is not the first. */
function versionOf(record: unknown): string | null {
  const named = text(field(record, "metadata", "version"));
  if (named !== null) return named;
  const index = field(record, "versions", "index");
  return typeof index === "number" && index > 1 ? String(index) : null;
}

/**
 * The newest version of each record. Zenodo lists only the latest versions,
 * but a record whose versions both appear must not be shown twice.
 */
export function latestVersions(records: readonly unknown[]): unknown[] {
  const best = new Map<string, { readonly record: unknown; readonly index: number }>();
  const order: string[] = [];
  for (const record of records) {
    const key = text(field(record, "parent", "id")) ?? text(field(record, "id")) ?? "";
    const raw = field(record, "versions", "index");
    const index = typeof raw === "number" ? raw : 0;
    const seen = best.get(key);
    if (seen === undefined) order.push(key);
    if (seen === undefined || index > seen.index) best.set(key, { record, index });
  }
  return order.map((key) => best.get(key)?.record);
}

interface ListingDetails {
  readonly id: string;
  readonly title: string;
  readonly creators: readonly string[];
  readonly published: string;
  readonly version: string | null;
  readonly licence: PublishedLicence | null;
  readonly doi: string | null;
  readonly zenodoUrl: string;
  readonly file: PublishedFile;
}

interface CarryOverFields {
  readonly fingerprint: string | null;
  readonly summary: MergeSummary;
  readonly panels: readonly string[];
  readonly countries: readonly string[];
  readonly collectionYears: YearRange | null;
  readonly taxa: readonly number[];
  readonly bioProjects: readonly string[];
}

interface PreviousLookup {
  readonly datasets: ReadonlyMap<string, CarryOverFields>;
  readonly specimens: ReadonlyMap<string, readonly SpecimenRow[]>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isIntegerArray(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "number" && Number.isInteger(item))
  );
}

function parseYearRange(value: unknown): YearRange | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const first = value["first"];
  const last = value["last"];
  if (!isFiniteNumber(first) || !isFiniteNumber(last)) return undefined;
  return { first, last };
}

function parseMergeSummary(value: unknown): MergeSummary | null {
  if (!isRecord(value)) return null;
  const specimens = value["specimens"];
  const librarySamples = value["librarySamples"];
  const librarySamplesWithDetections = value["librarySamplesWithDetections"];
  const panels = value["panels"];
  const targets = value["targets"];
  const targetsWithCalls = value["targetsWithCalls"];
  const genomes = value["genomes"];
  const sequencingRuns = value["sequencingRuns"];
  const projects = value["projects"];
  const bioinformaticsRuns = value["bioinformaticsRuns"];
  const librarySamplesWithReadCounts = value["librarySamplesWithReadCounts"];
  if (
    !isFiniteNumber(specimens) ||
    !isFiniteNumber(librarySamples) ||
    !isFiniteNumber(librarySamplesWithDetections) ||
    !isFiniteNumber(panels) ||
    !isFiniteNumber(targets) ||
    !isFiniteNumber(targetsWithCalls) ||
    !isFiniteNumber(genomes) ||
    !isFiniteNumber(sequencingRuns) ||
    !isFiniteNumber(projects) ||
    !isFiniteNumber(bioinformaticsRuns) ||
    !isFiniteNumber(librarySamplesWithReadCounts)
  ) {
    return null;
  }
  return {
    specimens,
    librarySamples,
    librarySamplesWithDetections,
    panels,
    targets,
    targetsWithCalls,
    genomes,
    sequencingRuns,
    projects,
    bioinformaticsRuns,
    librarySamplesWithReadCounts,
  };
}

function parseSpecimenRow(value: unknown): SpecimenRow | null {
  if (!isRecord(value)) return null;
  const dataset = value["dataset"];
  const specimen = value["specimen"];
  const country = value["country"];
  const date = value["date"];
  const taxa = value["taxa"];
  const librarySamples = value["librarySamples"];
  if (
    typeof dataset !== "string" ||
    typeof specimen !== "string" ||
    (country !== null && typeof country !== "string") ||
    (date !== null && typeof date !== "string") ||
    !isIntegerArray(taxa) ||
    !isFiniteNumber(librarySamples)
  ) {
    return null;
  }
  return { dataset, specimen, country, date, taxa, librarySamples };
}

function parsePrevious(
  previous: PreviousCatalogue | undefined,
  community: string,
): PreviousLookup | null {
  if (previous === undefined) return null;
  if (!isRecord(previous.index)) return null;
  if (previous.index["version"] !== INDEX_VERSION) return null;
  if (previous.index["community"] !== community) return null;
  const rawDatasets = previous.index["datasets"];
  if (!Array.isArray(rawDatasets) || !Array.isArray(previous.specimens)) return null;

  const datasets = new Map<string, CarryOverFields>();
  for (const entry of rawDatasets) {
    if (!isRecord(entry)) return null;
    const id = entry["id"];
    const fileEntry = entry["file"];
    if (typeof id !== "string" || !isRecord(fileEntry)) return null;
    const rawFingerprint = fileEntry["fingerprint"];
    if (rawFingerprint !== null && typeof rawFingerprint !== "string") return null;
    const summary = parseMergeSummary(entry["summary"]);
    const panels = entry["panels"];
    const countries = entry["countries"];
    const collectionYears = parseYearRange(entry["collectionYears"]);
    const taxa = entry["taxa"];
    const bioProjects = entry["bioProjects"];
    if (
      summary === null ||
      !isStringArray(panels) ||
      !isStringArray(countries) ||
      collectionYears === undefined ||
      !isIntegerArray(taxa) ||
      !isStringArray(bioProjects)
    ) {
      return null;
    }
    datasets.set(id, {
      fingerprint: rawFingerprint,
      summary,
      panels,
      countries,
      collectionYears,
      taxa,
      bioProjects,
    });
  }

  const specimens = new Map<string, SpecimenRow[]>();
  for (const rawRow of previous.specimens) {
    const row = parseSpecimenRow(rawRow);
    if (row === null) return null;
    const rows = specimens.get(row.dataset);
    if (rows === undefined) specimens.set(row.dataset, [row]);
    else rows.push(row);
  }

  return { datasets, specimens };
}

function listingDetailsFrom(record: unknown, file: PublishedFile): ListingDetails | null {
  const id = text(field(record, "id"));
  const title = text(field(record, "metadata", "title"));
  if (id === null || title === null) return null;
  return {
    id,
    title,
    creators: list(field(record, "metadata", "creators"))
      .map((creator) => text(field(creator, "person_or_org", "name")))
      .filter((name) => name !== null),
    published: text(field(record, "metadata", "publication_date")) ?? "",
    version: versionOf(record),
    licence: licenceOf(record),
    doi: text(field(record, "pids", "doi", "identifier")),
    zenodoUrl: text(field(record, "links", "self_html")) ?? `${ZENODO}/records/${id}`,
    file,
  };
}

/** The catalogue entry for one record and the PMO read from its file. */
export function datasetFrom(
  record: unknown,
  file: PublishedFile,
  pmo: PortableMicrohaplotypeObject,
): PublishedDataset | null {
  const details = listingDetailsFrom(record, file);
  if (details === null) return null;
  const publication = summarisePublication(pmo);
  return {
    ...details,
    summary: summarisePmo(pmo),
    panels: publication.panels,
    countries: publication.countries,
    collectionYears: publication.collectionYears,
    taxa: taxaOf(pmo),
    bioProjects: publication.projects
      .map((project) => project.accession)
      .filter((accession) => accession !== null),
  };
}

/**
 * Harvests the community. Resolves with the catalogue, the specimen rows and
 * the records left out. Rejects with {@link HarvestError} when the listing
 * itself cannot be read, so a caller can keep the last good catalogue.
 */
export async function harvest(options: HarvestOptions): Promise<HarvestResult> {
  const send = options.fetch ?? globalThis.fetch;
  const log = options.log ?? (() => undefined);
  const headers = { Accept: RECORD_JSON };

  const records: unknown[] = [];
  let reportedTotal: number | null = null;
  const query = new URLSearchParams({
    q: `metadata.subjects.subject:"${PMO_SUBJECT}"`,
    size: String(PAGE_SIZE),
    sort: "newest",
  });
  let next: string | null =
    `${ZENODO}/api/communities/${encodeURIComponent(options.community)}/records?${query.toString()}`;
  for (let page = 0; next !== null; page += 1) {
    if (page >= MAX_PAGES) {
      throw new HarvestError(`Zenodo's listing did not end after ${MAX_PAGES} pages`);
    }
    let response: Response;
    try {
      // oxlint-disable-next-line no-await-in-loop -- one page at a time, to go easy on Zenodo
      response = await send(next, { headers });
    } catch (error) {
      throw new HarvestError(`Zenodo could not be reached: ${String(error)}`);
    }
    if (!response.ok) throw new HarvestError(`Zenodo answered ${response.status} to the listing`);
    // oxlint-disable-next-line no-await-in-loop
    const body: unknown = await response.json();
    const hits = field(body, "hits", "hits");
    if (!Array.isArray(hits))
      throw new HarvestError("Zenodo's listing was not in the expected form");
    const total = field(body, "hits", "total");
    if (typeof total === "number" && Number.isFinite(total) && total >= 0) {
      reportedTotal = reportedTotal === null ? total : Math.max(reportedTotal, total);
    }
    records.push(...hits);
    next = text(field(body, "links", "next"));
  }
  if (reportedTotal !== null && records.length < reportedTotal) {
    throw new HarvestError(
      `Zenodo reported ${reportedTotal} ${reportedTotal === 1 ? "record" : "records"}, but the listing returned ${records.length}`,
    );
  }

  const previous = parsePrevious(options.previous, options.community);
  const datasets: PublishedDataset[] = [];
  const specimens: SpecimenRow[] = [];
  const skipped: SkippedRecord[] = [];
  let carriedOver = 0;
  let downloaded = 0;
  for (const record of latestVersions(records)) {
    const recordId = text(field(record, "id"));
    const id = recordId ?? "unknown";
    const title = text(field(record, "metadata", "title")) ?? "(no title)";
    const skip = (reason: string): void => {
      skipped.push({ id, title, reason });
      log(`left out ${id} "${title}": ${reason}`);
    };
    const found = pmoFileOf(record);
    if (found === null) {
      skip("it has no .json or .json.gz file");
      continue;
    }
    if (found.size > MAX_FILE_BYTES) {
      skip(`its file ${found.name} is larger than the harvester reads`);
      continue;
    }
    const url = `${ZENODO}/api/records/${encodeURIComponent(id)}/files/${encodeURIComponent(found.name)}/content`;
    const fingerprint = fileFingerprintOf(recordId, record, found);
    const publishedFile: PublishedFile = { name: found.name, size: found.size, url, fingerprint };

    const prior = recordId === null ? undefined : previous?.datasets.get(recordId);
    const priorSpecimens = recordId === null ? [] : (previous?.specimens.get(recordId) ?? []);
    if (
      prior !== undefined &&
      fingerprint !== null &&
      fingerprint !== "" &&
      prior.fingerprint === fingerprint &&
      priorSpecimens.length === prior.summary.specimens
    ) {
      const details = listingDetailsFrom(record, publishedFile);
      if (details === null) {
        skip("the record has no title");
        continue;
      }
      datasets.push({
        ...details,
        summary: prior.summary,
        panels: prior.panels,
        countries: prior.countries,
        collectionYears: prior.collectionYears,
        taxa: prior.taxa,
        bioProjects: prior.bioProjects,
      });
      specimens.push(...priorSpecimens);
      carriedOver += 1;
      log(`carried over ${id} "${title}": ${prior.summary.specimens} specimens`);
      continue;
    }

    let data: unknown;
    try {
      // oxlint-disable-next-line no-await-in-loop -- one file at a time, to go easy on Zenodo
      const response = await send(url, {});
      if (!response.ok) {
        skip(`Zenodo answered ${response.status} for ${found.name}`);
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop
      data = await parsePmo(await response.arrayBuffer());
    } catch (error) {
      skip(
        `${found.name} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const checked = validatePmo(data);
    if (!checked.valid) {
      skip(`${found.name} does not match the PMO format (${checked.errorCount} problems)`);
      continue;
    }
    const broken = checkPmoIntegrity(checked.pmo).filter((issue) => issue.severity === "error");
    if (broken.length > 0) {
      skip(`${found.name} has ${broken.length} broken links between its tables`);
      continue;
    }
    const dataset = datasetFrom(record, publishedFile, checked.pmo);
    if (dataset === null) {
      skip("the record has no title");
      continue;
    }
    datasets.push(dataset);
    specimens.push(...specimenRows(dataset.id, checked.pmo));
    downloaded += 1;
    log(`read ${id} "${title}": ${dataset.summary.specimens} specimens`);
  }

  return {
    index: {
      version: INDEX_VERSION,
      harvestedAt: (options.now ?? new Date()).toISOString(),
      community: options.community,
      datasets,
    },
    specimens,
    skipped,
    carriedOver,
    downloaded,
  };
}
