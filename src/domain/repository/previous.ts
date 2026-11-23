/**
 * Validates and indexes a previous harvest's `index.json` and `specimens.json`
 * so {@link harvest} can carry unchanged records over without downloading them.
 */
import type { MergeSummary, YearRange } from "@/domain/build";

import { INDEX_VERSION, type SpecimenRow } from "./types";

/** A previous catalogue and its per-specimen rows, passed in for carry-over. */
export interface PreviousCatalogue {
  readonly index: unknown;
  readonly specimens: unknown;
}

/** The PMO-derived fields carried over from a previous catalogue entry. */
export interface CarryOverFields {
  readonly fingerprint: string | null;
  readonly summary: MergeSummary;
  readonly panels: readonly string[];
  readonly countries: readonly string[];
  readonly collectionYears: YearRange | null;
  readonly taxa: readonly number[];
  readonly bioProjects: readonly string[];
}

/** Indexed previous datasets and specimen rows, keyed by Zenodo record id. */
export interface PreviousLookup {
  readonly datasets: ReadonlyMap<string, CarryOverFields>;
  readonly specimens: ReadonlyMap<string, readonly SpecimenRow[]>;
}

type Json = Readonly<Record<string, unknown>>;

type ParsedYearRange =
  | { readonly ok: true; readonly value: YearRange | null }
  | { readonly ok: false };

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function parseYearRange(value: unknown): ParsedYearRange {
  if (value === null) return { ok: true, value: null };
  if (!isRecord(value)) return { ok: false };
  const first = value["first"];
  const last = value["last"];
  if (!isFiniteNumber(first) || !isFiniteNumber(last)) return { ok: false };
  return { ok: true, value: { first, last } };
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

/**
 * Checks that `previous` matches {@link INDEX_VERSION}, `community`, and the
 * expected catalogue shape, returning a lookup by record id or `null` when it
 * cannot be trusted for carry-over.
 */
export function parsePrevious(
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
      !collectionYears.ok ||
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
      collectionYears: collectionYears.value,
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
