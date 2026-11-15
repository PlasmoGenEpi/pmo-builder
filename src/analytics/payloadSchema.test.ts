import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createFactFilter, factsOf, MAX_FACTS } from "../../receiver/src/facts";

import { createAnalytics } from "./analytics";
import { fakeEnvironment } from "./fakeEnvironment";
import { allowedFacts, PAYLOAD_SCHEMA } from "./payloadSchema";
import type { JsonSchema } from "./payloadSchema";

// Vitest runs from the repository root.
const SCHEMA_FILE = resolve("docs/analytics-payload.schema.json");
const FACTS_FILE = resolve("receiver/src/allowed-facts.json");

/** Checks `value` against the subset of JSON Schema that `payloadSchema.ts` uses. */
function matches(schema: JsonSchema, value: unknown): boolean {
  if (schema.oneOf !== undefined) {
    return schema.oneOf.filter((option) => matches(option, value)).length === 1;
  }
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.enum !== undefined && !schema.enum.some((member) => member === value)) return false;
  switch (schema.type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "string":
      return (
        typeof value === "string" &&
        (schema.pattern === undefined || new RegExp(schema.pattern).test(value))
      );
    case "array": {
      const items = schema.items;
      if (!Array.isArray(value) || items === undefined) return false;
      if (value.length > (schema.maxItems ?? 0)) return false;
      if (schema.uniqueItems === true && new Set(value).size !== value.length) return false;
      return value.every((item) => matches(items, item));
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
      const properties = schema.properties ?? {};
      return (
        (schema.required ?? []).every((key) => Object.hasOwn(value, key)) &&
        Object.entries(value).every(([key, item]) => {
          const property = properties[key];
          return (
            Object.hasOwn(properties, key) && property !== undefined && matches(property, item)
          );
        })
      );
    }
    case undefined:
      return true;
  }
  return false;
}

function fullSession(): unknown {
  const fake = fakeEnvironment({ destination: "https://usage.example.org/" });
  const analytics = createAnalytics(fake.env);
  analytics.start();
  analytics.recordDraftRestored();
  for (const step of ["home", "panel", "review"] as const) analytics.recordStepOpened(step);
  analytics.recordTableImported({
    table: "microhaplotypes",
    route: "upload",
    format: "tsv",
    gzip: true,
    rows: 50_000,
    columns: 12,
  });
  analytics.recordMappingEdited("specimens");
  analytics.recordSectionStatus("microhaplotypes", "error");
  analytics.recordBuild({ outcome: "built" });
  analytics.recordValidation({ schemaErrors: 0 });
  analytics.recordDownload({ kind: "plain", bytes: 12_000_000 });
  analytics.recordIssue({ code: "io/invalid-gzip", severity: "error" });
  analytics.recordIssue({ code: "Something else", severity: "warning" });
  analytics.recordPageOpened("published");
  analytics.recordPageOpened("publish-file");
  analytics.recordFileChecked("ready");
  analytics.recordFileChecked("wrong-version");
  analytics.recordPublishOpened("file");
  analytics.recordDepositStarted("file");
  analytics.recordDepositFinished("draft-ready");
  analytics.recordDepositFinished("pop-up-blocked");
  fake.hide();
  return fake.beacons.map((beacon): unknown => JSON.parse(beacon.body));
}

describe("payload schema", () => {
  it("matches the file in docs", () => {
    const generated = `${JSON.stringify(PAYLOAD_SCHEMA, null, 2)}\n`;
    if (process.env["UPDATE_ANALYTICS_SCHEMA"] === "1") writeFileSync(SCHEMA_FILE, generated);
    const onDisk: unknown = JSON.parse(readFileSync(SCHEMA_FILE, "utf8"));
    expect(
      onDisk,
      "Run UPDATE_ANALYTICS_SCHEMA=1 pnpm vitest run src/analytics, then pnpm format",
    ).toEqual(PAYLOAD_SCHEMA);
  });

  it("lists the receiver's allowed facts in the file it reads", () => {
    const generated = allowedFacts();
    if (process.env["UPDATE_ANALYTICS_SCHEMA"] === "1") {
      writeFileSync(FACTS_FILE, `${JSON.stringify(generated, null, 2)}\n`);
    }
    const onDisk: unknown = JSON.parse(readFileSync(FACTS_FILE, "utf8"));
    expect(
      onDisk,
      "Run UPDATE_ANALYTICS_SCHEMA=1 pnpm vitest run src/analytics, then pnpm format",
    ).toEqual(generated);
  });

  it("accepts the records the instrumentation produces", () => {
    const records = fullSession();
    expect(Array.isArray(records) && records.length).toBe(2);
    if (!Array.isArray(records)) return;
    for (const record of records) expect(matches(PAYLOAD_SCHEMA, record)).toBe(true);
  });

  it("rejects anything else", () => {
    const visit = { v: 2, kind: "visit", app: "1.2.3" };
    expect(matches(PAYLOAD_SCHEMA, visit)).toBe(true);
    for (const bad of [
      { ...visit, fileName: "samples.csv" },
      { ...visit, app: "1.2.3; Sample ID" },
      { ...visit, v: 3 },
      { v: 2, kind: "session", app: "1.2.3" },
      null,
      "visit",
    ]) {
      expect(matches(PAYLOAD_SCHEMA, bad)).toBe(false);
    }
    const records = fullSession();
    if (!Array.isArray(records)) throw new Error("expected records");
    const session: unknown = records[1];
    const tweak = (patch: Record<string, unknown>): unknown => ({ ...Object(session), ...patch });
    expect(matches(PAYLOAD_SCHEMA, session)).toBe(true);
    expect(matches(PAYLOAD_SCHEMA, tweak({ steps: ["home", "Sample ID"] }))).toBe(false);
    expect(matches(PAYLOAD_SCHEMA, tweak({ steps: ["home", "home"] }))).toBe(false);
    expect(matches(PAYLOAD_SCHEMA, tweak({ duration: 125 }))).toBe(false);
    expect(
      matches(
        PAYLOAD_SCHEMA,
        tweak({ issues: [{ code: "panel/x", severity: "error", count: "1" }] }),
      ),
    ).toBe(false);
  });
});

describe("the receiver's fact filter", () => {
  const sort = createFactFilter(allowedFacts());

  it("keeps every fact of every record the instrumentation produces", () => {
    const records = fullSession();
    if (!Array.isArray(records)) throw new Error("expected records");
    for (const record of records) {
      const sorted = sort(record);
      expect(sorted?.dropped).toBe(0);
      expect(sorted?.kept.length).toBe(factsOf(record).length);
    }
    const session: unknown = records[1];
    expect(factsOf(session)).toEqual(
      expect.arrayContaining([
        ["pages", "published"],
        ["publish.deposits.file", "1"],
        ["publish.outcomes.draft-ready", "1"],
        ["publish.fileChecks.wrong-version", "1"],
        ["issues", "io/invalid-gzip error 1"],
      ]),
    );
  });

  it("still keeps the facts of a record from the earlier version", () => {
    expect(sort({ v: 1, kind: "visit", app: "0.1.0" })).toEqual({
      kept: [
        ["v", "1"],
        ["kind", "visit"],
        ["app", "0.1.0"],
      ],
      dropped: 0,
    });
  });

  it("drops an unknown value on its own and keeps the rest of the record", () => {
    const records = fullSession();
    if (!Array.isArray(records)) throw new Error("expected records");
    const session = Object(records[1]);
    const sorted = sort({
      ...session,
      steps: ["home", "a-page-from-a-newer-app"],
      fileName: "Kisumu_patient_042.csv",
      app: "1.2.3; Sample ID",
    });
    expect(sorted?.dropped).toBe(3);
    const kept = JSON.stringify(sorted?.kept);
    expect(kept).not.toMatch(/Kisumu|Sample ID|newer/);
    expect(sorted?.kept).toEqual(
      expect.arrayContaining([
        ["steps", "home"],
        ["kind", "session"],
      ]),
    );
  });

  it("refuses what is not a usage record, and caps the facts kept", () => {
    expect(sort(null)).toBeNull();
    expect(sort([1, 2])).toBeNull();
    expect(sort({ kind: "something" })).toBeNull();
    const many = sort({ kind: "visit", steps: Array.from({ length: 900 }, () => "home") });
    expect(many?.kept).toHaveLength(MAX_FACTS);
    expect(many?.dropped).toBe(901 - MAX_FACTS);
  });
});
