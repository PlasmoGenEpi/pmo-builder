import { PmoError } from "pmotools-ts";
import { describe, expect, it } from "vitest";

import { getFieldSet } from "@/domain/fields";

import {
  describeColumn,
  describeColumnAtStart,
  errorNotice,
  mappingProblemNotice,
  type TableIssueContext,
} from "./notices";

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

describe("field and column names inside messages", () => {
  it("quotes field labels as names rather than lower-casing them", () => {
    expect(
      mappingProblemNotice({ kind: "missing-required", fieldKey: "targetName" }, context).message,
    ).toBe("Choose the column of the allele table that holds “Target name”.");
    expect(
      mappingProblemNotice(
        { kind: "duplicate-column", column: "id", fieldKeys: ["librarySampleName", "targetName"] },
        context,
      ).message,
    ).toBe(
      'Column "id" is chosen for “Library sample name” and “Target name”. Each column can feed only one field.',
    );
  });

  it("names a column with its own words at the start of a sentence and inside one", () => {
    const mapped = { ...context, columns: { targetName: "locus" } };
    expect(describeColumnAtStart(mapped, "locus")).toBe('Column "locus" (target name)');
    expect(describeColumn(mapped, "locus")).toBe('column "locus" (target name)');
    expect(describeColumnAtStart(mapped, "other")).toBe('Column "other"');
  });

  it("puts a read count table's row number in a whole sentence", () => {
    const error = new PmoError("read-counts/missing-name", "missing name", {
      table: "total_raw_count_table",
      row: 3,
      column: "sample",
    });
    expect(errorNotice(error, context).message).toBe(
      'Row 5 of the totals table has no value in column "sample".',
    );
  });
});
