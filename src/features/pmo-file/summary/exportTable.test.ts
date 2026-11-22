import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveFile } from "@/features/review/saveFile";

import { downloadDelimitedTable, formatDelimitedTable, pmoBaseName } from "./exportTable";

vi.mock("@/features/review/saveFile", () => ({ saveFile: vi.fn<typeof saveFile>() }));

beforeEach(() => {
  vi.mocked(saveFile).mockReset();
});

describe("formatDelimitedTable", () => {
  it("formats CSV with headers, numbers, blank missing values and RFC 4180 quoting", () => {
    const csv = formatDelimitedTable({
      headers: ["Target", "Samples with data", "Note"],
      rows: [
        ["t1", 12, "plain"],
        ["t,2", null, 'say "hi"'],
        ["t3", 0, "line 1\nline 2"],
      ],
      format: "csv",
    });

    expect(csv).toBe(
      [
        "Target,Samples with data,Note",
        "t1,12,plain",
        '"t,2",,"say ""hi"""',
        't3,0,"line 1\nline 2"',
        "",
      ].join("\n"),
    );
  });

  it("formats TSV with tab delimiters, quoting tabs and quotes but leaving commas unquoted", () => {
    const tsv = formatDelimitedTable({
      headers: ["Library sample", "Plate well", "Reads"],
      rows: [
        ["S1", "Plate 1, A1", 250],
        ["S\t2", 'well "B2"', null],
      ],
      format: "tsv",
    });

    expect(tsv).toBe(
      [
        "Library sample\tPlate well\tReads",
        "S1\tPlate 1, A1\t250",
        '"S\t2"\t"well ""B2"""\t',
        "",
      ].join("\n"),
    );
  });
});

describe("downloadDelimitedTable", () => {
  it("saves a CSV blob in the browser with text/csv MIME type and .csv extension", async () => {
    downloadDelimitedTable({
      headers: ["Target", "Alleles"],
      rows: [["t1", 3]],
      fileName: "study-summary-targets",
      format: "csv",
    });

    expect(saveFile).toHaveBeenCalledTimes(1);
    const [blob, fileName] = vi.mocked(saveFile).mock.calls[0] ?? [];
    expect(fileName).toBe("study-summary-targets.csv");
    expect(blob?.type).toBe("text/csv;charset=utf-8");
    expect(await blob?.text()).toBe("Target,Alleles\nt1,3\n");
  });

  it("saves a TSV blob in the browser with tab-separated MIME type and .tsv extension", async () => {
    downloadDelimitedTable({
      headers: ["Target", "Alleles"],
      rows: [["t1", 3]],
      fileName: "study-summary-targets",
      format: "tsv",
    });

    expect(saveFile).toHaveBeenCalledTimes(1);
    const [blob, fileName] = vi.mocked(saveFile).mock.calls[0] ?? [];
    expect(fileName).toBe("study-summary-targets.tsv");
    expect(blob?.type).toBe("text/tab-separated-values;charset=utf-8");
    expect(await blob?.text()).toBe("Target\tAlleles\nt1\t3\n");
  });
});

describe("pmoBaseName", () => {
  it("strips PMO file extensions and marks subsets", () => {
    expect(pmoBaseName("study.pmo.json.gz", "original")).toBe("study");
    expect(pmoBaseName("study.json.gz", "subset")).toBe("study-subset");
    expect(pmoBaseName("study.json", "original")).toBe("study");
    expect(pmoBaseName(null, "original")).toBe("pmo");
  });
});
