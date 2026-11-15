import { describe, expect, it } from "vitest";

import { parseDelimited } from "./delimited";
import { createCellInterner } from "./intern";

describe("createCellInterner", () => {
  it("returns the same stored copy for repeated text in a column", () => {
    const intern = createCellInterner();
    const first = intern(0, "ACGT".repeat(40));
    const again = intern(0, "ACGT".repeat(40));
    expect(again).toBe(first);
    expect(again).toBe("ACGT".repeat(40));
  });

  it("keeps the text exactly, blanks and spaces included", () => {
    const intern = createCellInterner();
    expect(["", " ", " a ", "NA"].map((cell) => intern(1, cell))).toEqual(["", " ", " a ", "NA"]);
  });

  it("stops looking up a column whose cells rarely repeat, and still returns the text", () => {
    const intern = createCellInterner();
    const cells = Array.from({ length: 30_000 }, (_, index) => `read-${index}`);
    expect(cells.map((cell) => intern(0, cell))).toEqual(cells);
    // A repeat in the given-up column is returned as text, not looked up.
    expect(intern(0, "read-0")).toBe("read-0");
  });
});

describe("parseDelimited", () => {
  it("shares one copy of a repeated cell across rows", () => {
    const seq = "ACGT".repeat(50);
    const rows = parseDelimited(`sample,seq\ns1,${seq}\ns2,${seq}\n`, ",");
    expect(rows[1]?.[1]).toBe(seq);
    expect(Object.is(rows[1]?.[1], rows[2]?.[1])).toBe(true);
  });

  it("takes a stray carriage return off the last cell with mixed line endings", () => {
    expect(parseDelimited("a,b\nc,d\r\ne,f\n", ",")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
      [""],
    ]);
  });
});
