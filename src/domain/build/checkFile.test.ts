import { gzipPmo, stringifyPmo, type PortableMicrohaplotypeObject } from "pmotools-ts";
import { describe, expect, it } from "vitest";

import { checkPmoFile } from "./checkFile";
import { MAX_LISTED } from "./checkFileResult";
import { buildExamplePmo } from "./testing";

const text = (value: string) => new Blob([value]);

/** The example PMO with its sample names changed, so it does not count as the example. */
function ownPmo(): PortableMicrohaplotypeObject {
  const pmo = buildExamplePmo();
  return {
    ...pmo,
    library_sample_info: pmo.library_sample_info.map((sample, index) =>
      Object.assign({}, sample, { library_sample_name: `lab_sample_${index + 1}` }),
    ),
  };
}

function withVersion(pmo: PortableMicrohaplotypeObject, version: string | undefined): unknown {
  const { pmo_version: _version, ...header } = pmo.pmo_header;
  return {
    ...pmo,
    pmo_header: version === undefined ? header : { ...header, pmo_version: version },
  };
}

describe("checkPmoFile", () => {
  it("reads a gzipped PMO and describes it", async () => {
    const check = await checkPmoFile(new Blob([await gzipPmo(ownPmo())]));
    expect(check).toMatchObject({
      kind: "ready",
      summary: { specimens: 50, librarySamples: 50, targets: 276 },
      publication: { panels: ["Mad4hatter"], countries: ["Mozambique"], exampleData: false },
    });
  });

  it("reads a plain JSON PMO", async () => {
    expect(await checkPmoFile(text(stringifyPmo(ownPmo())))).toMatchObject({ kind: "ready" });
  });

  it("tells the example data apart, so it can be refused", async () => {
    const check = await checkPmoFile(text(stringifyPmo(buildExamplePmo())));
    expect(check).toMatchObject({ kind: "ready", publication: { exampleData: true } });
  });

  it("refuses a file too large to read", async () => {
    expect(await checkPmoFile(text("x".repeat(20)), 10)).toEqual({ kind: "too-large", limit: 10 });
  });

  it("says why a file is not a PMO", async () => {
    expect(
      await checkPmoFile(new Blob([Uint8Array.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 1, 2, 3])])),
    ).toEqual({
      kind: "unreadable",
      reason: "gzip",
    });
    expect(await checkPmoFile(text("sample,reads\ns1,10\n"))).toEqual({
      kind: "unreadable",
      reason: "json",
    });
    expect(await checkPmoFile(text('{"samples": []}'))).toEqual({
      kind: "unreadable",
      reason: "not-pmo",
    });
    // pmotools-ts reads only a JSON object as a PMO.
    expect(await checkPmoFile(text("[1, 2]"))).toEqual({ kind: "unreadable", reason: "json" });
  });

  it("refuses any PMO version but 1.1.0", async () => {
    const pmo = ownPmo();
    const as = (version: string | undefined) =>
      checkPmoFile(text(JSON.stringify(withVersion(pmo, version))));
    expect(await as("1.0.0")).toEqual({ kind: "wrong-version", declared: "1.0.0" });
    expect(await as("0.1.0")).toEqual({ kind: "wrong-version", declared: "0.1.0" });
    expect(await as(undefined)).toEqual({ kind: "wrong-version", declared: null });
    expect(await as("v1.1.0")).toMatchObject({ kind: "ready" });
  });

  it("lists what does not match the PMO format", async () => {
    const pmo = ownPmo();
    const broken = {
      ...pmo,
      specimen_info: pmo.specimen_info.map(({ specimen_name: _name, ...rest }) => rest),
    };
    const check = await checkPmoFile(text(JSON.stringify(broken)));
    expect(check.kind).toBe("invalid");
    if (check.kind !== "invalid") return;
    expect(check.problems).toHaveLength(1);
    expect(check.problems[0]).toMatch(/specimen_name.*\(and 49 more like it\)$/);
    expect(check.unlisted).toBe(0);
    expect(MAX_LISTED).toBe(10);
  });

  it("lists broken links between the PMO's tables", async () => {
    const pmo = ownPmo();
    const broken = {
      ...pmo,
      library_sample_info: pmo.library_sample_info.map((sample) =>
        Object.assign({}, sample, { specimen_id: 9999 }),
      ),
    };
    const check = await checkPmoFile(text(JSON.stringify(broken)));
    expect(check.kind).toBe("invalid");
    if (check.kind !== "invalid") return;
    expect(check.problems.length).toBeGreaterThanOrEqual(1);
    expect(check.unlisted).toBe(0);
  });
});
