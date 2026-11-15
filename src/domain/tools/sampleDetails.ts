/**
 * Optional facts about a library sample that the Summary can show when the
 * PMO has them: whether its specimen is a control, where it sat on a plate,
 * its parasite density, and its reads at each pipeline stage. Every one is
 * optional in the format, so each returns `null` when absent.
 */
import type { PortableMicrohaplotypeObject } from "pmotools-ts";

import type { ControlKind, Density, GroupField, GroupKey, PlateWell, ReactionGroup } from "./types";

type Pmo = PortableMicrohaplotypeObject;

/** The kind of control a `specimen_type` names, or `null` for a field sample. */
export function controlKind(specimenType: string | null | undefined): ControlKind | null {
  if (typeof specimenType !== "string") return null;
  const type = specimenType.toLowerCase();
  if (!type.includes("control")) return null;
  if (type.includes("neg")) return "negative";
  if (type.includes("pos")) return "positive";
  return "other";
}

/** A library sample's plate position, when complete. */
export function plateWell(pmo: Pmo, libraryId: number): PlateWell | null {
  const plate = pmo.library_sample_info[libraryId]?.library_prep_plate_info;
  if (plate === null || plate === undefined) return null;
  const row = plate.plate_row.trim().toUpperCase();
  if (plate.plate_name.trim() === "" || row === "" || !Number.isFinite(plate.plate_col))
    return null;
  return { plate: plate.plate_name, row, col: plate.plate_col };
}

/**
 * A library sample's parasite density: its own qPCR measurement when it has
 * one, else its specimen's. Of several measurements, the first is used.
 */
export function densityOf(pmo: Pmo, libraryId: number): Density | null {
  const library = pmo.library_sample_info[libraryId];
  const own = library?.qpcr_parasite_density_info?.[0];
  if (own !== undefined && Number.isFinite(own.parasite_density)) {
    return { value: own.parasite_density, method: own.parasite_density_method, from: "library" };
  }
  const specimen = library === undefined ? undefined : pmo.specimen_info[library.specimen_id];
  const theirs = specimen?.parasite_density_info?.[0];
  if (theirs !== undefined && Number.isFinite(theirs.parasite_density)) {
    return {
      value: theirs.parasite_density,
      method: theirs.parasite_density_method,
      from: "specimen",
    };
  }
  return null;
}

/** The pipeline stages named in the read counts by stage, in the order first given. */
export function stagesOf(pmo: Pmo): string[] {
  const seen: string[] = [];
  for (const run of pmo.read_counts_by_stage ?? []) {
    for (const sample of run.read_counts_by_library_sample_by_stage) {
      for (const target of sample.read_counts_for_targets ?? []) {
        for (const stage of target.stages) if (!seen.includes(stage.stage)) seen.push(stage.stage);
      }
    }
  }
  return seen;
}

/**
 * A library sample's read counts by stage in one run: total raw reads, and
 * reads at each of `stages` summed over targets. `null`s where not given.
 */
export function stageReadsOf(
  pmo: Pmo,
  options: {
    readonly libraryId: number;
    readonly runId: number | null;
    readonly stages: readonly string[];
  },
): { readonly raw: number | null; readonly stages: (number | null)[] } {
  const runs = (pmo.read_counts_by_stage ?? []).filter(
    (run) => options.runId === null || (run.bioinformatics_run_id ?? null) === options.runId,
  );
  for (const run of runs) {
    const sample = run.read_counts_by_library_sample_by_stage.find(
      (item) => item.library_sample_id === options.libraryId,
    );
    if (sample === undefined) continue;
    const totals = new Map<string, number>();
    for (const target of sample.read_counts_for_targets ?? []) {
      for (const stage of target.stages)
        totals.set(stage.stage, (totals.get(stage.stage) ?? 0) + stage.reads);
    }
    return {
      raw: sample.total_raw_count,
      stages: options.stages.map((stage) => totals.get(stage) ?? null),
    };
  }
  return { raw: null, stages: options.stages.map(() => null) };
}

/** Every panel's reactions, with their targets as indexes into `target_info`. */
export function reactionsOf(pmo: Pmo): ReactionGroup[] {
  return pmo.panel_info.flatMap((panel) =>
    panel.reactions.map((reaction) => ({
      panel: panel.panel_name,
      name: reaction.reaction_name,
      targets: reaction.panel_targets,
    })),
  );
}

const DATE = /^(\d{4})(?:-(\d{2}))?/;

/** Text with something in it, trimmed; `null` otherwise. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** A specimen's value for a grouping field, as text, or `null` when it has none. */
export function groupValue(pmo: Pmo, specimenId: number, key: GroupKey): string | null {
  const specimen = pmo.specimen_info[specimenId];
  if (specimen === undefined) return null;
  switch (key) {
    case "collection_year":
      return DATE.exec(specimen.collection_date ?? "")?.[1] ?? null;
    case "collection_month": {
      const match = DATE.exec(specimen.collection_date ?? "");
      return match?.[2] === undefined ? null : `${match[1]}-${match[2]}`;
    }
    case "project":
      return typeof specimen.project_id === "number"
        ? (text(pmo.project_info?.[specimen.project_id]?.project_name) ??
            String(specimen.project_id))
        : null;
    case "collection_country":
    case "geo_admin1":
    case "geo_admin2":
    case "geo_admin3":
      return text(specimen[key]);
    default:
      return null;
  }
}

/** The grouping fields, in this order, that at least one specimen has a value for. */
export const GROUP_KEYS: readonly GroupKey[] = [
  "collection_country",
  "geo_admin1",
  "geo_admin2",
  "geo_admin3",
  "collection_year",
  "collection_month",
  "project",
];

/** Which grouping fields the PMO's specimens have, and how many have each. */
export function groupFieldsOf(pmo: Pmo): GroupField[] {
  const total = pmo.specimen_info.length;
  return GROUP_KEYS.flatMap((key) => {
    const values = pmo.specimen_info.map((_, index) => groupValue(pmo, index, key));
    const present = values.filter((value) => value !== null).length;
    if (present === 0) return [];
    return [
      { key, present, total, distinct: new Set(values.filter((value) => value !== null)).size },
    ];
  });
}
