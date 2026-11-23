import { describe, expect, it } from "vitest";

import { baseNameOf } from "./baseName";

describe("baseNameOf", () => {
  it.each([
    ["study.pmo.gz", "study"],
    ["study.pmo.json.gz", "study"],
    ["Mad4hatter.pmo.json.gz", "Mad4hatter"],
    ["study.json.gz", "study"],
    ["study.pmo.json", "study"],
    ["study.json", "study"],
    ["study.gz", "study"],
    ["STUDY.PMO.GZ", "STUDY"],
    ["study.pmo", "study.pmo"],
    ["study", "study"],
    ["  study.pmo.gz  ", "study"],
    [".pmo.gz", "pmo"],
    [".json", "pmo"],
    ["", "pmo"],
    ["   ", "pmo"],
  ])("%s gives %s", (name, base) => {
    expect(baseNameOf(name)).toBe(base);
  });
});
