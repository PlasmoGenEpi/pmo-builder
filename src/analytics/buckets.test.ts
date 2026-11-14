import { describe, expect, it } from "vitest";

import { bucketColumns, bucketCount, bucketDuration, bucketRows, bucketSize } from "./buckets";

describe("buckets", () => {
  it("puts row counts in coarse buckets", () => {
    expect([0, 1, 9, 10, 999, 1000, 99_999, 100_000, 5e9].map(bucketRows)).toEqual([
      "0",
      "1-9",
      "1-9",
      "10-99",
      "100-999",
      "1000-9999",
      "10000-99999",
      "100000+",
      "100000+",
    ]);
  });

  it("puts column counts, sizes, durations and counts in buckets", () => {
    expect([0, 4, 5, 20, 100].map(bucketColumns)).toEqual(["0", "1-4", "5-9", "20-49", "100+"]);
    expect([0, 9_999, 10_000, 2_500_000, 1e9].map(bucketSize)).toEqual([
      "0-10kb",
      "0-10kb",
      "10-100kb",
      "1-10mb",
      "100mb+",
    ]);
    expect([0, 59_999, 60_000, 3_600_000].map(bucketDuration)).toEqual([
      "0-1m",
      "0-1m",
      "1-5m",
      "60m+",
    ]);
    expect([0, 1, 3, 7, 50, 1000].map(bucketCount)).toEqual([
      "0",
      "1",
      "2-4",
      "5-9",
      "10-99",
      "100+",
    ]);
  });

  it("falls back to the lowest bucket for anything that is not a count", () => {
    for (const odd of [-1, Number.NaN, Number.POSITIVE_INFINITY, "12", null, undefined, {}]) {
      expect(bucketRows(odd)).toBe("0");
      expect(bucketSize(odd)).toBe("0-10kb");
    }
  });
});
