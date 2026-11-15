/**
 * Short labels that tell a target's microhaplotypes apart, for the Summary.
 * In order of preference:
 *
 * 1. the microhaplotype's pseudoCIGAR, shown as the pipeline wrote it (PMO
 *    does not define its grammar, so it is not interpreted);
 * 2. its `associated_seq_variants`, the format's structured variants;
 * 3. its differences from the target's most common microhaplotype, found by
 *    aligning the two sequences, so that an insertion or deletion is one
 *    difference rather than a shift of every base after it.
 *
 * Positions in (3) count from 1 along the most common sequence, and an
 * insertion or deletion in a repeat is placed as far right as it goes. A
 * substitution reads `C12T`; a deletion of its bases 101 to 109 reads
 * `del 101–109`; an insertion after its base 140 reads `ins 140 ATT`.
 */
import { plural, t } from "@lingui/core/macro";
import type { RepresentativeMicrohaplotype } from "pmotools-ts";

/** Where a label came from. */
export type AlleleLabelSource = "pseudocigar" | "variants" | "alignment";

/** A microhaplotype's label. */
export interface AlleleLabel {
  readonly label: string;
  readonly source: AlleleLabelSource;
  /** How the pipeline made the pseudoCIGAR, when it said. */
  readonly note: string | null;
}

/** The most differences spelled out; the rest are counted. */
const MAX_DIFFERENCES = 4;

/** How far an alignment may stray from the diagonal, beyond the length difference. */
const BAND_SLACK = 16;

type Step = "match" | "sub" | "del" | "ins";

/**
 * Aligns `seq` to `reference` with the fewest edits (substitutions,
 * insertions and deletions each cost 1), within a band around the diagonal,
 * and returns the steps from the start.
 */
function align(reference: string, seq: string): Step[] {
  const n = reference.length;
  const m = seq.length;
  const band = Math.abs(n - m) + BAND_SLACK;
  const width = m + 1;
  const cost = new Uint32Array((n + 1) * width).fill(0xffffffff);
  const inBand = (i: number, j: number): boolean => Math.abs(i * (m / Math.max(1, n)) - j) <= band;
  cost[0] = 0;
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      if ((i === 0 && j === 0) || !inBand(i, j)) continue;
      let best = 0xffffffff;
      if (i > 0 && j > 0) {
        const diagonal = cost[(i - 1) * width + j - 1] ?? 0xffffffff;
        if (diagonal !== 0xffffffff) best = diagonal + (reference[i - 1] === seq[j - 1] ? 0 : 1);
      }
      if (i > 0) {
        const up = cost[(i - 1) * width + j] ?? 0xffffffff;
        if (up !== 0xffffffff) best = Math.min(best, up + 1);
      }
      if (j > 0) {
        const left = cost[i * width + j - 1] ?? 0xffffffff;
        if (left !== 0xffffffff) best = Math.min(best, left + 1);
      }
      cost[i * width + j] = best;
    }
  }
  // Walking back from the end, a gap is taken before an equally good match,
  // so an insertion or deletion in a repeat sits as far right as it can, as
  // variant descriptions conventionally place it.
  const steps: Step[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const here = cost[i * width + j] ?? 0;
    if (i > 0 && (cost[(i - 1) * width + j] ?? 0xffffffff) + 1 === here) {
      steps.push("del");
      i -= 1;
      continue;
    }
    if (j > 0 && (cost[i * width + j - 1] ?? 0xffffffff) + 1 === here) {
      steps.push("ins");
      j -= 1;
      continue;
    }
    steps.push(reference[i - 1] === seq[j - 1] ? "match" : "sub");
    i -= 1;
    j -= 1;
  }
  return steps.toReversed();
}

/** The differences of `seq` from `reference`, in reading order. */
export function differences(reference: string, seq: string): string[] {
  const steps = align(reference, seq);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  let index = 0;
  while (index < steps.length) {
    const step = steps[index];
    if (step === "match") {
      i += 1;
      j += 1;
      index += 1;
    } else if (step === "sub") {
      out.push(`${reference[i] ?? ""}${i + 1}${seq[j] ?? ""}`);
      i += 1;
      j += 1;
      index += 1;
    } else if (step === "del") {
      const start = i + 1;
      while (steps[index] === "del") {
        i += 1;
        index += 1;
      }
      out.push(start === i ? `del ${start}` : `del ${start}–${i}`);
    } else {
      const after = i;
      let inserted = "";
      while (steps[index] === "ins") {
        inserted += seq[j] ?? "";
        j += 1;
        index += 1;
      }
      out.push(`ins ${after} ${inserted}`);
    }
  }
  return out;
}

function joinDifferences(list: readonly string[]): string {
  if (list.length <= MAX_DIFFERENCES) return list.join(", ");
  const rest = list.length - MAX_DIFFERENCES;
  const shown = list.slice(0, MAX_DIFFERENCES).join(", ");
  return plural(rest, { one: `${shown} and # more`, other: `${shown} and # more` });
}

function variantText(microhaplotype: RepresentativeMicrohaplotype): string | null {
  const variants = microhaplotype.associated_seq_variants ?? [];
  if (variants.length === 0) return null;
  return joinDifferences(
    variants.map((variant) => {
      const change =
        typeof variant.ref_seq === "string" && typeof variant.alt_seq === "string"
          ? ` ${variant.ref_seq}>${variant.alt_seq}`
          : "";
      return `${variant.chrom}:${variant.start + 1}${change}`;
    }),
  );
}

/**
 * Labels for one target's microhaplotypes, in the order given. `mostCommon`
 * is the index of the one the others are compared with.
 */
export function alleleLabels(
  microhaplotypes: readonly RepresentativeMicrohaplotype[],
  mostCommon: number,
): AlleleLabel[] {
  const reference = microhaplotypes[mostCommon]?.seq ?? "";
  return microhaplotypes.map((microhaplotype, index) => {
    const pseudocigar = microhaplotype.pseudocigar?.pseudocigar_seq;
    if (typeof pseudocigar === "string" && pseudocigar !== "") {
      return {
        label: pseudocigar,
        source: "pseudocigar",
        note: microhaplotype.pseudocigar?.pseudocigar_generation_description ?? null,
      };
    }
    const variants = variantText(microhaplotype);
    if (variants !== null) return { label: variants, source: "variants", note: null };
    if (index === mostCommon) {
      return {
        label: t({
          message: "most common",
          comment: "Label of a target's most common microhaplotype",
        }),
        source: "alignment",
        note: null,
      };
    }
    const list = differences(reference, microhaplotype.seq);
    return {
      label:
        list.length === 0
          ? t({ message: "same sequence", comment: "A microhaplotype with no differences found" })
          : joinDifferences(list),
      source: "alignment",
      note: null,
    };
  });
}
