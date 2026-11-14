import { describe, expect, it } from "vitest";

import { getFieldSet } from "@/domain/fields";

import { mappingProblemNotice, type TableIssueContext } from "./notices";

const context: TableIssueContext = {
  tableLabel: "allele table",
  tableId: "t1",
  fieldSet: getFieldSet("microhaplotypes"),
  columns: {},
  typed: null,
  raw: null,
};

describe("notices for fields that only make sense together", () => {
  it("asks for all or none when the group is closed", () => {
    const notice = mappingProblemNotice(
      {
        kind: "incomplete-group",
        dependencyId: "masking",
        mappedKeys: ["maskingSeqStart"],
        missing: ["maskingSeqSegmentSize", "maskingReplacementSize"],
      },
      context,
    );
    expect(notice).toEqual({
      severity: "error",
      code: "mapping/incomplete-group",
      message:
        "Masking start is mapped, but Masking length and Masking replacement length are not. Map all three or none.",
      tableId: "t1",
      fieldKey: "maskingSeqStart",
    });
  });

  it("names a choice of fields, and offers to unmap instead", () => {
    const notice = mappingProblemNotice(
      {
        kind: "incomplete-group",
        dependencyId: "pseudocigar",
        mappedKeys: ["pseudocigar"],
        missing: [{ anyOf: ["pseudocigarChrom", "chrom"] }, "pseudocigarStart"],
      },
      context,
    );
    expect(notice.message).toBe(
      "Pseudo-CIGAR is mapped, but Pseudo-CIGAR chromosome (or Chromosome) and Pseudo-CIGAR start are not. Map them too, or unmap Pseudo-CIGAR.",
    );
  });

  it("keeps user data out of the code", () => {
    const notice = mappingProblemNotice(
      { kind: "unknown-additional-column", column: "Patient name" },
      context,
    );
    expect(notice).toMatchObject({
      code: "mapping/unknown-additional-column",
      column: "Patient name",
    });
    expect(notice.code).not.toContain("Patient");
  });
});
