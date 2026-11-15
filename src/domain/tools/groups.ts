/**
 * Comparing groups of specimens: by country, administrative area, year,
 * month or project. Every grouping field is optional in PMO, so specimens
 * without a value form their own group (`name: null`) rather than being left
 * out. Allele frequencies come from pmotools-ts
 * (`extractAlleleCountsFreqFromPmo`), per group, after the read threshold.
 */
import {
  extractAlleleCountsFreqFromPmo,
  extractFromPmoWithReadFilter,
  type PortableMicrohaplotypeObject,
} from "pmotools-ts";

import { alleleLabels } from "./alleleLabels";
import { groupValue } from "./sampleDetails";
import type { GroupComparison, GroupKey, GroupRow, TargetAcrossGroups } from "./types";

type Pmo = PortableMicrohaplotypeObject;

/** Orders text by character code, so years and months sort by date. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Frequencies per target name, then per microhaplotype id. */
function frequencies(
  pmo: Pmo,
  librarySampleNames: readonly string[] | undefined,
): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  const table = extractAlleleCountsFreqFromPmo(pmo, {
    collapseAcrossRuns: true,
    librarySampleNames,
  });
  for (const [target, mhap, , freq] of table.rows) {
    if (typeof target !== "string" || typeof mhap !== "number" || typeof freq !== "number")
      continue;
    const forTarget = out.get(target) ?? new Map<number, number>();
    forTarget.set(mhap, freq);
    out.set(target, forTarget);
  }
  return out;
}

function heterozygosity(freqs: ReadonlyMap<number, number> | undefined): number | null {
  if (freqs === undefined || freqs.size === 0) return null;
  let sum = 0;
  for (const freq of freqs.values()) sum += freq * freq;
  return 1 - sum;
}

/**
 * Every month (or year) from the first to the last with specimens, with 0
 * for those without, so that a timeline's spacing follows time.
 */
function fillPeriods(
  counts: ReadonlyMap<string, number>,
  unit: "month" | "year" | null,
): { period: string; specimens: number }[] {
  const known = [...counts.keys()].toSorted(compareText);
  const [first] = known;
  const last = known.at(-1);
  if (unit === null || first === undefined || last === undefined) return [];
  const periods: string[] = [];
  if (unit === "year") {
    for (let year = Number(first); year <= Number(last); year += 1) periods.push(String(year));
  } else {
    let [year, month] = first.split("-").map(Number);
    const [lastYear, lastMonth] = last.split("-").map(Number);
    if (
      year === undefined ||
      month === undefined ||
      lastYear === undefined ||
      lastMonth === undefined
    )
      return [];
    while (year < lastYear || (year === lastYear && month <= lastMonth)) {
      periods.push(`${year}-${String(month).padStart(2, "0")}`);
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  }
  return periods.map((period) => ({ period, specimens: counts.get(period) ?? 0 }));
}

/** The specimens of `pmo` grouped by `key`, compared, counting microhaplotypes with at least `minReads` reads. */
export function compareGroups(pmo: Pmo, key: GroupKey, minReads: number): GroupComparison {
  const filtered = minReads > 0 ? extractFromPmoWithReadFilter(pmo, minReads) : pmo;

  // Which group each specimen and library sample is in. `null` is "not recorded".
  const specimenGroup = pmo.specimen_info.map((_, index) => groupValue(pmo, index, key));
  const names = [...new Set(specimenGroup)].toSorted((a, b) =>
    a === null ? 1 : b === null ? -1 : compareText(a, b),
  );

  // Per library sample: whether anything was counted, and the most alleles at a target.
  const counted = new Map<number, number>();
  for (const run of filtered.detected_microhaplotypes) {
    for (const sample of run.library_samples) {
      const most = Math.max(0, ...sample.target_results.map((result) => result.mhaps.length));
      counted.set(
        sample.library_sample_id,
        Math.max(counted.get(sample.library_sample_id) ?? 0, most),
      );
    }
  }

  const overall = frequencies(filtered, undefined);
  const perGroup = names.map((name) => {
    const libraries = pmo.library_sample_info.flatMap((library, index) =>
      specimenGroup[library.specimen_id] === name ? [{ library, index }] : [],
    );
    const freqs = frequencies(
      filtered,
      libraries.map(({ library }) => library.library_sample_name),
    );
    return { name, libraries, freqs };
  });

  const groups: GroupRow[] = perGroup.map(({ name, libraries, freqs }) => {
    const values = [...freqs.values()].map(heterozygosity).filter((value) => value !== null);
    return {
      name,
      specimens: specimenGroup.filter((group) => group === name).length,
      librarySamples: libraries.length,
      withData: libraries.filter(({ index }) => (counted.get(index) ?? 0) > 0).length,
      polyclonal: libraries.filter(({ index }) => (counted.get(index) ?? 0) > 1).length,
      meanHeterozygosity:
        values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
      alleles: [...freqs.values()].reduce((sum, forTarget) => sum + forTarget.size, 0),
    };
  });

  const targets: TargetAcrossGroups[] = filtered.representative_microhaplotypes.targets.flatMap(
    (target) => {
      const name = filtered.target_info[target.target_id]?.target_name;
      const all = name === undefined ? undefined : overall.get(name);
      if (name === undefined || all === undefined) return [];
      const order = [...all].toSorted((a, b) => b[1] - a[1] || a[0] - b[0]).map(([mhap]) => mhap);
      const labels = alleleLabels(target.microhaplotypes, order[0] ?? 0);
      return [
        {
          name,
          heterozygosity: perGroup.map(({ freqs }) => heterozygosity(freqs.get(name))),
          alleles: order.map((mhap) => ({
            mhapId: mhap,
            seq: target.microhaplotypes[mhap]?.seq ?? "",
            label: labels[mhap] ?? { label: "", source: "alignment", note: null },
            freqs: perGroup.map(({ freqs }) => {
              const forTarget = freqs.get(name);
              return forTarget === undefined ? null : (forTarget.get(mhap) ?? 0);
            }),
          })),
        },
      ];
    },
  );

  // When specimens were collected: by month if any date gives one, else by year.
  const months = pmo.specimen_info.map((_, index) => groupValue(pmo, index, "collection_month"));
  const years = pmo.specimen_info.map((_, index) => groupValue(pmo, index, "collection_year"));
  const unit = months.some((month) => month !== null)
    ? "month"
    : years.some((year) => year !== null)
      ? "year"
      : null;
  const periods = unit === "month" ? months : unit === "year" ? years : [];
  const counts = new Map<string, number>();
  for (const period of periods)
    if (period !== null) counts.set(period, (counts.get(period) ?? 0) + 1);

  return {
    key,
    groups,
    targets,
    timeline: fillPeriods(counts, unit),
    timelineUnit: unit,
    dated: periods.filter((period) => period !== null).length,
  };
}
