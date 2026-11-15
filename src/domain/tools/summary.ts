/**
 * A PMO's summary: per sample, per target, the reads grid and allele
 * frequencies. The counting is pmotools-ts's (`countTargetsPerLibrarySample`,
 * `countLibrarySamplesPerTarget`, `extractAlleleCountsFreqFromPmo`), run on the
 * PMO after microhaplotypes below the read threshold are dropped
 * (`extractFromPmoWithReadFilter`), so every number follows one threshold.
 */
import {
  countLibrarySamplesPerTarget,
  extractAlleleCountsFreqFromPmo,
  extractFromPmoWithReadFilter,
  type PortableMicrohaplotypeObject,
  type RepresentativeMicrohaplotype,
} from "pmotools-ts";

import { alleleLabels } from "./alleleLabels";
import {
  controlKind,
  densityOf,
  groupFieldsOf,
  plateWell,
  reactionsOf,
  stageReadsOf,
  stagesOf,
} from "./sampleDetails";

import type { PmoSummary, SampleSummary, TargetSummary } from "./types";

type Pmo = PortableMicrohaplotypeObject;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

/** The summary of `pmo`, counting only microhaplotypes with at least `minReads` reads. */
export function summaryOf(pmo: Pmo, minReads: number): PmoSummary {
  const filtered = minReads > 0 ? extractFromPmoWithReadFilter(pmo, minReads) : pmo;
  const runNames = (pmo.bioinformatics_run_info ?? []).map((run) => run.bioinformatics_run_name);
  const representative = filtered.representative_microhaplotypes.targets;
  const targetNames = filtered.target_info.map((target) => target.target_name);

  // The reads grid and the per-sample figures. Every library sample of each
  // run gets a row, even when nothing passes the threshold, and so does a
  // library sample with no detections at all: those are the ones to notice.
  const samples: SampleSummary[] = [];
  const reads: number[] = [];
  const kept = new Map<
    string,
    (typeof filtered.detected_microhaplotypes)[number]["library_samples"][number]
  >();
  filtered.detected_microhaplotypes.forEach((run, runIndex) => {
    for (const sample of run.library_samples)
      kept.set(`${runIndex}:${sample.library_sample_id}`, sample);
  });
  const stages = stagesOf(pmo);
  const addRow = (
    libraryId: number,
    runName: string,
    runIndex: number | null,
    runId: number | null,
  ): void => {
    const library = pmo.library_sample_info[libraryId];
    const row = Array.from({ length: targetNames.length }, () => 0);
    let total = 0;
    let maxAlleles = 0;
    const sample = runIndex === null ? undefined : kept.get(`${runIndex}:${libraryId}`);
    for (const result of sample?.target_results ?? []) {
      const targetId = representative[result.mhaps_target_id]?.target_id;
      if (targetId === undefined) continue;
      const targetReads = result.mhaps.reduce((sum, mhap) => sum + mhap.reads, 0);
      row[targetId] = (row[targetId] ?? 0) + targetReads;
      total += targetReads;
      maxAlleles = Math.max(maxAlleles, result.mhaps.length);
    }
    reads.push(...row);
    const stageReads = stageReadsOf(pmo, { libraryId, runId, stages });
    const specimen = library === undefined ? undefined : pmo.specimen_info[library.specimen_id];
    samples.push({
      libraryId,
      name: library?.library_sample_name ?? String(libraryId),
      specimen:
        library === undefined
          ? null
          : (pmo.specimen_info[library.specimen_id]?.specimen_name ?? null),
      run: runName,
      targets: row.filter((value) => value > 0).length,
      reads: total,
      maxAlleles,
      control: controlKind(specimen?.specimen_type),
      plate: plateWell(pmo, libraryId),
      density: densityOf(pmo, libraryId),
      rawReads: stageReads.raw,
      stageReads: stageReads.stages,
    });
  };
  const detected = new Set<number>();
  pmo.detected_microhaplotypes.forEach((run, runIndex) => {
    const runName =
      typeof run.bioinformatics_run_id === "number"
        ? (runNames[run.bioinformatics_run_id] ?? String(run.bioinformatics_run_id))
        : String(runIndex + 1);
    for (const sample of run.library_samples) {
      detected.add(sample.library_sample_id);
      addRow(
        sample.library_sample_id,
        runName,
        runIndex,
        typeof run.bioinformatics_run_id === "number" ? run.bioinformatics_run_id : null,
      );
    }
  });
  pmo.library_sample_info.forEach((_, libraryId) => {
    if (!detected.has(libraryId)) addRow(libraryId, "", null, null);
  });

  // Per target: samples with data, alleles seen, and expected heterozygosity.
  const sampleCounts = new Map<string, number>();
  for (const [name, count] of countLibrarySamplesPerTarget(filtered, { collapseAcrossRuns: true })
    .rows) {
    if (typeof name === "string" && typeof count === "number") sampleCounts.set(name, count);
  }
  const frequencies = new Map<string, { mhap: number; count: number; freq: number }[]>();
  for (const [name, mhap, count, freq] of extractAlleleCountsFreqFromPmo(filtered, {
    collapseAcrossRuns: true,
  }).rows) {
    if (
      typeof name !== "string" ||
      typeof mhap !== "number" ||
      typeof count !== "number" ||
      typeof freq !== "number"
    )
      continue;
    const list = frequencies.get(name) ?? [];
    list.push({ mhap, count, freq });
    frequencies.set(name, list);
  }
  const microhaplotypes = new Map<string, readonly RepresentativeMicrohaplotype[]>();
  for (const target of representative) {
    const name = filtered.target_info[target.target_id]?.target_name;
    if (name !== undefined) microhaplotypes.set(name, target.microhaplotypes);
  }
  const targets: TargetSummary[] = targetNames.map((name) => {
    const alleles = (frequencies.get(name) ?? []).toSorted(
      (a, b) => b.freq - a.freq || a.mhap - b.mhap,
    );
    const known = microhaplotypes.get(name) ?? [];
    // The others are described against the most common one: the first after
    // sorting by frequency.
    const labels = alleleLabels(known, alleles[0]?.mhap ?? 0);
    return {
      name,
      samples: sampleCounts.get(name) ?? 0,
      alleles: alleles.map((allele) => ({
        mhapId: allele.mhap,
        seq: known[allele.mhap]?.seq ?? "",
        label: labels[allele.mhap] ?? { label: "", source: "alignment", note: null },
        count: allele.count,
        freq: allele.freq,
      })),
      heterozygosity:
        alleles.length === 0
          ? null
          : 1 - alleles.reduce((sum, allele) => sum + allele.freq ** 2, 0),
    };
  });

  const withData = samples.filter((sample) => sample.targets > 0);
  return {
    minReads,
    runs: filtered.detected_microhaplotypes.length,
    librarySamples: pmo.library_sample_info.length,
    samples,
    targets,
    grid: { columns: targetNames.length, reads },
    stages,
    reactions: reactionsOf(pmo),
    groupFields: groupFieldsOf(pmo),
    headline: {
      samplesWithData: withData.length,
      targetsWithData: targets.filter((target) => target.samples > 0).length,
      medianTargets: median(withData.map((sample) => sample.targets)),
      medianReads: median(withData.map((sample) => sample.reads)),
      polyclonal: withData.filter((sample) => sample.maxAlleles > 1).length,
    },
  };
}
