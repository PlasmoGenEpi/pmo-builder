import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createAnalytics } from "./analytics";
import { fakeEnvironment } from "./fakeEnvironment";
import { PAYLOAD_SCHEMA } from "./payloadSchema";
import type { JsonSchema } from "./payloadSchema";

// Vitest runs from the repository root.
const SCHEMA_FILE = resolve("docs/analytics-payload.schema.json");

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

  it("accepts the records the instrumentation produces", () => {
    const records = fullSession();
    expect(Array.isArray(records) && records.length).toBe(2);
    if (!Array.isArray(records)) return;
    for (const record of records) expect(matches(PAYLOAD_SCHEMA, record)).toBe(true);
  });

  it("rejects anything else", () => {
    const visit = { v: 1, kind: "visit", app: "1.2.3" };
    expect(matches(PAYLOAD_SCHEMA, visit)).toBe(true);
    for (const bad of [
      { ...visit, fileName: "samples.csv" },
      { ...visit, app: "1.2.3; Sample ID" },
      { ...visit, v: 2 },
      { v: 1, kind: "session", app: "1.2.3" },
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
