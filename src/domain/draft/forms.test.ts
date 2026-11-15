import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BIOINFORMATICS_METHOD_FIELDS,
  BIOINFORMATICS_RUN_FIELDS,
  GENOME_FIELDS,
  PROJECT_FIELDS,
  SEQUENCING_FIELDS,
} from "@/domain/fields";

import {
  GENOME_FORM_FIELDS,
  METHOD_STEP_FORM_FIELDS,
  PROJECT_FORM_FIELDS,
  RUN_FORM_FIELDS,
  SEQUENCING_FORM_FIELDS,
  SEQUENCING_VOCABULARIES,
  readFieldValue,
} from "./forms";

function child(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;
}

/** The schema's pattern for one `SequencingInfo` field, read from the vendored schema. */
function schemaPattern(key: string): RegExp {
  const file = resolve(
    "node_modules/pmotools-ts/schemas/portable_microhaplotype_object_v1.1.0.schema.json",
  );
  const schema: unknown = JSON.parse(readFileSync(file, "utf8"));
  const properties = child(child(child(schema, "$defs"), "SequencingInfo"), "properties");
  const pattern = child(child(properties, key), "pattern");
  if (typeof pattern !== "string") throw new Error(`no pattern for ${key}`);
  return new RegExp(pattern);
}

describe("sequencing form suggestions", () => {
  it("offers only values the PMO schema and the field's format accept", () => {
    const withSuggestions = SEQUENCING_FORM_FIELDS.filter(
      (field) => "suggestions" in field && field.suggestions !== undefined,
    );
    expect(withSuggestions.map((field) => field.key)).toEqual(Object.keys(SEQUENCING_VOCABULARIES));
    for (const [key, values] of Object.entries(SEQUENCING_VOCABULARIES)) {
      const pattern = schemaPattern(key);
      const field = SEQUENCING_FORM_FIELDS.find((candidate) => candidate.key === key);
      for (const value of values) {
        expect(pattern.test(value), `${key}: ${value}`).toBe(true);
        expect(field?.format?.pattern.test(value), `${key}: ${value}`).toBe(true);
      }
    }
  });

  it("uses a usual value as the example where there is a list", () => {
    for (const field of SEQUENCING_FORM_FIELDS) {
      if (!("suggestions" in field) || field.suggestions === undefined) continue;
      expect(field.suggestions).toContain(field.example);
    }
  });
});

describe("one definition of the record fields", () => {
  it.each([
    ["project", PROJECT_FIELDS, PROJECT_FORM_FIELDS],
    ["sequencing", SEQUENCING_FIELDS, SEQUENCING_FORM_FIELDS],
    ["method steps", BIOINFORMATICS_METHOD_FIELDS, METHOD_STEP_FORM_FIELDS],
    ["runs", BIOINFORMATICS_RUN_FIELDS, RUN_FORM_FIELDS],
    ["genomes", GENOME_FIELDS, GENOME_FORM_FIELDS],
  ] as const)("gives the %s table and form the same fields", (_, fieldSet, form) => {
    const column = fieldSet.fields.map((field) => [field.key, field.label, field.required]);
    const typed = form.map((field) => [field.key, field.label, field.required]);
    expect(column).toEqual(typed);
  });

  it("says a list is one per line in a form and separated by commas in a table", () => {
    const sets = [
      [PROJECT_FIELDS, PROJECT_FORM_FIELDS],
      [BIOINFORMATICS_METHOD_FIELDS, METHOD_STEP_FORM_FIELDS],
      [GENOME_FIELDS, GENOME_FORM_FIELDS],
    ] as const;
    let lists = 0;
    for (const [fieldSet, form] of sets) {
      for (const field of form) {
        if (field.kind !== "list" && field.kind !== "integerList") continue;
        lists += 1;
        const column = fieldSet.fields.find((entry) => entry.key === field.key);
        expect(field.description).toMatch(/, one per line\.$/);
        expect(column?.description).toMatch(/, separated by commas\.$/);
      }
    }
    expect(lists).toBe(4);
  });

  it("lets every date take YYYY-MM or YYYY-MM-DD, as the PMO format does", () => {
    const sets = [SEQUENCING_FIELDS, BIOINFORMATICS_RUN_FIELDS];
    const dates = sets.flatMap((set) => set.fields.filter((field) => field.kind === "date"));
    expect(dates.length).toBeGreaterThan(0);
    for (const field of dates) expect(field.description).toContain("YYYY-MM or YYYY-MM-DD");
    for (const field of [...SEQUENCING_FORM_FIELDS, ...RUN_FORM_FIELDS]) {
      if (field.kind !== "date") continue;
      expect(readFieldValue(field, "2024-03", "table")).toEqual({ kind: "text", value: "2024-03" });
    }
  });
});
