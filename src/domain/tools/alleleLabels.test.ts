import { describe, expect, it } from "vitest";

import { alleleLabels, differences } from "./alleleLabels";

const REF = "ACGTACGTACGTACGTACGT";

describe("differences", () => {
  it("names a substitution by base, position and new base", () => {
    expect(differences(REF, "ACGTACGTACCTACGTACGT")).toEqual(["G11C"]);
  });

  it("finds a deletion as one difference, not a shift of every base after it", () => {
    // Bases 9 to 11 (ACG) removed.
    expect(differences(REF, "ACGTACGTTACGTACGT")).toHaveLength(1);
    const [deletion] = differences(REF, "ACGTACGTTACGTACGT");
    expect(deletion).toMatch(/^del \d+–\d+$/);
  });

  it("finds an insertion with its bases", () => {
    expect(differences(REF, "ACGTACGTAAAACGTACGTACGT")).toEqual(["ins 9 AAA"]);
  });

  it("finds a single-base deletion", () => {
    expect(differences("AAAACCCCGGGGTTTT", "AAAACCCGGGGTTTT")).toEqual(["del 8"]);
  });

  it("finds a substitution and an indel in the same sequence", () => {
    const found = differences("GATTACAGATTACAGATTACA", "GATTACACCGATTAGAGATTACA");
    expect(found).toEqual(["ins 7 CC", "C13G"]);
  });

  it("finds nothing between identical sequences", () => {
    expect(differences(REF, REF)).toEqual([]);
  });

  it("handles a sequence much longer than the band would allow by chance", () => {
    const long = "ACGT".repeat(60);
    const withDeletion = long.slice(0, 100) + long.slice(112);
    expect(differences(long, withDeletion)).toHaveLength(1);
  });
});

describe("alleleLabels", () => {
  it("labels by difference from the most common microhaplotype", () => {
    const labels = alleleLabels([{ seq: REF }, { seq: "ACGTACGTACCTACGTACGT" }], 0);
    expect(labels.map((label) => label.label)).toEqual(["most common", "G11C"]);
    expect(labels.every((label) => label.source === "alignment")).toBe(true);
  });

  it("prefers the pipeline's pseudoCIGAR, shown as written, with how it was made", () => {
    const [label] = alleleLabels(
      [
        {
          seq: REF,
          pseudocigar: {
            pseudocigar_seq: "25+25N169+8N188+",
            ref_loc: { genome_id: 0, chrom: "chr1", start: 0, end: 20 },
            pseudocigar_generation_description: "mad4hatter",
          },
        },
      ],
      0,
    );
    expect(label).toEqual({ label: "25+25N169+8N188+", source: "pseudocigar", note: "mad4hatter" });
  });

  it("uses structured variants when there is no pseudoCIGAR", () => {
    const [label] = alleleLabels(
      [
        {
          seq: REF,
          associated_seq_variants: [
            {
              genome_id: 0,
              chrom: "Pf3D7_13_v3",
              start: 1_725_258,
              end: 1_725_259,
              ref_seq: "C",
              alt_seq: "T",
            },
          ],
        },
      ],
      0,
    );
    expect(label).toEqual({ label: "Pf3D7_13_v3:1725259 C>T", source: "variants", note: null });
  });

  it("spells out at most four differences and counts the rest", () => {
    const other = "TCGTTCGTTCGTTCGTTCGT";
    const [, label] = alleleLabels([{ seq: REF }, { seq: other }], 0);
    expect(label?.label).toBe("A1T, A5T, A9T, A13T and 1 more");
  });
});
