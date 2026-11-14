import { readFileSync } from "node:fs";

import type {
  LibrarySampleInfoTableOptions,
  MhapTableToPmoOptions,
  PanelInfoOptions,
  ReadCountByStageOptions,
  SpecimenInfoTableOptions,
} from "pmotools-ts";
import { describe, expect, expectTypeOf, it } from "vitest";

import { FIELD_SET_IDS, type FieldSetId } from "../types";

import { normalizeName } from "../matching";

import {
  BIOINFORMATICS_METHOD_FIELDS,
  BIOINFORMATICS_RUN_FIELDS,
  FIELD_SETS,
  GENOME_FIELDS,
  PROJECT_FIELDS,
  SEQUENCING_FIELDS,
  getFieldSet,
  type KeyedFieldSetSpec,
  type LIBRARY_SAMPLE_FIELDS,
  type MICROHAPLOTYPE_FIELDS,
  type PANEL_TARGET_FIELDS,
  type READ_COUNT_TOTAL_FIELDS,
  type READ_COUNTS_BY_STAGE_FIELDS,
  type SPECIMEN_FIELDS,
} from "./index";

/** The keys of a keyed field set. */
type KeysOf<T> = T extends KeyedFieldSetSpec<infer K> ? K : never;

/**
 * The single-column options of a builder, without `Col`: every option whose
 * name ends in `Col` and that accepts a string. Options that take only lists
 * end in `Cols` and are excluded by the name pattern.
 */
type SingleColumnKeys<Options> = {
  [Name in keyof Options]-?: Name extends `${infer Key}Col`
    ? string extends NonNullable<Options[Name]>
      ? Key
      : Extract<NonNullable<Options[Name]>, string> extends never
        ? never
        : Key
    : never;
}[keyof Options];

describe("builder field keys", () => {
  it("name real builder options, and cover every single-column option", () => {
    // `${key}Col` must be an option of the builder (catches typos)...
    expectTypeOf<`${KeysOf<typeof MICROHAPLOTYPE_FIELDS>}Col`>().toExtend<
      keyof MhapTableToPmoOptions
    >();
    expectTypeOf<`${KeysOf<typeof PANEL_TARGET_FIELDS>}Col`>().toExtend<keyof PanelInfoOptions>();
    expectTypeOf<`${KeysOf<typeof SPECIMEN_FIELDS>}Col`>().toExtend<
      keyof SpecimenInfoTableOptions
    >();
    expectTypeOf<`${KeysOf<typeof LIBRARY_SAMPLE_FIELDS>}Col`>().toExtend<
      keyof LibrarySampleInfoTableOptions
    >();
    expectTypeOf<`${KeysOf<typeof READ_COUNT_TOTAL_FIELDS>}Col`>().toExtend<
      keyof ReadCountByStageOptions
    >();
    expectTypeOf<`${KeysOf<typeof READ_COUNTS_BY_STAGE_FIELDS>}Col`>().toExtend<
      keyof ReadCountByStageOptions
    >();

    // ...and every single-column option has a field.
    expectTypeOf<KeysOf<typeof MICROHAPLOTYPE_FIELDS>>().toEqualTypeOf<
      SingleColumnKeys<MhapTableToPmoOptions>
    >();
    expectTypeOf<KeysOf<typeof PANEL_TARGET_FIELDS>>().toEqualTypeOf<
      SingleColumnKeys<PanelInfoOptions>
    >();
    expectTypeOf<KeysOf<typeof SPECIMEN_FIELDS>>().toEqualTypeOf<
      SingleColumnKeys<SpecimenInfoTableOptions>
    >();
    expectTypeOf<KeysOf<typeof LIBRARY_SAMPLE_FIELDS>>().toEqualTypeOf<
      SingleColumnKeys<LibrarySampleInfoTableOptions>
    >();
    // One builder serves both read-count tables.
    expectTypeOf<
      KeysOf<typeof READ_COUNT_TOTAL_FIELDS> | KeysOf<typeof READ_COUNTS_BY_STAGE_FIELDS>
    >().toEqualTypeOf<SingleColumnKeys<ReadCountByStageOptions>>();

    // A typo is caught.
    expectTypeOf<"targetNmeCol">().not.toExtend<keyof MhapTableToPmoOptions>();
  });
});

interface SchemaClass {
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, { readonly type?: string | readonly string[] }>>;
}

function schemaClass(name: string): SchemaClass {
  const url = new URL(
    "../../../node_modules/pmotools-ts/schemas/portable_microhaplotype_object_v1.1.0.schema.json",
    import.meta.url,
  );
  const schema: unknown = JSON.parse(readFileSync(url, "utf8"));
  if (typeof schema !== "object" || schema === null || !("$defs" in schema))
    throw new Error("no $defs");
  const defs: unknown = schema.$defs;
  if (typeof defs !== "object" || defs === null || !(name in defs)) throw new Error(`no ${name}`);
  const found: unknown = Object.entries(defs).find(([key]) => key === name)?.[1];
  if (typeof found !== "object" || found === null || !("properties" in found))
    throw new Error(name);
  const required = "required" in found && Array.isArray(found.required) ? found.required : [];
  const properties: Record<string, { type?: string | readonly string[] }> = {};
  if (typeof found.properties === "object" && found.properties !== null) {
    for (const [key, value] of Object.entries(found.properties)) {
      const type: unknown =
        typeof value === "object" && value !== null && "type" in value ? value.type : undefined;
      if (typeof type === "string") properties[key] = { type };
      else if (Array.isArray(type)) {
        properties[key] = {
          type: type.filter((entry): entry is string => typeof entry === "string"),
        };
      } else properties[key] = {};
    }
  }
  return {
    required: required.filter((entry): entry is string => typeof entry === "string"),
    properties,
  };
}

describe("field sets without a builder follow the PMO schema", () => {
  const cases = [
    [GENOME_FIELDS, "GenomeInfo", []],
    [PROJECT_FIELDS, "ProjectInfo", []],
    [SEQUENCING_FIELDS, "SequencingInfo", []],
    [BIOINFORMATICS_METHOD_FIELDS, "BioMethod", []],
    // The methods index is chosen in the app, not read from a column.
    [BIOINFORMATICS_RUN_FIELDS, "BioinformaticsRunInfo", ["bioinformatics_methods_id"]],
  ] as const;

  for (const [fieldSet, className, notColumns] of cases) {
    it(`${fieldSet.id} matches ${className}`, () => {
      const schema = schemaClass(className);
      const expectedKeys = Object.keys(schema.properties).filter(
        (key) => !(notColumns as readonly string[]).includes(key),
      );
      expect(fieldSet.fields.map((field) => field.key).toSorted()).toEqual(expectedKeys.toSorted());
      const actual = fieldSet.fields.map((field) => [field.key, field.required, field.kind]);
      const wanted = fieldSet.fields.map((field) => {
        const type = schema.properties[field.key]?.type;
        const types = typeof type === "string" ? [type] : (type ?? []);
        // taxon_id is a list of integers, read as one inferred number.
        const kind =
          types.includes("integer") || field.key === "taxon_id"
            ? "integer"
            : types.includes("array")
              ? "list"
              : field.kind;
        return [field.key, schema.required.includes(field.key), kind];
      });
      expect(actual).toEqual(wanted);
    });
  }
});

describe("FIELD_SETS", () => {
  it("has one field set per id, in order", () => {
    expect([...FIELD_SETS.keys()]).toEqual([...FIELD_SET_IDS]);
    for (const id of FIELD_SET_IDS) {
      expect(getFieldSet(id).id).toBe(id);
      expect(FIELD_SETS.get(id)).toBe(getFieldSet(id));
    }
  });

  const all = FIELD_SET_IDS.map((id): [FieldSetId, ReturnType<typeof getFieldSet>] => [
    id,
    getFieldSet(id),
  ]);

  it.each(all)("%s has unique keys and well-formed text", (_id, fieldSet) => {
    const keys = fieldSet.fields.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(fieldSet.fields.some((field) => field.required)).toBe(true);
    const sentenceCase = /^[A-Z0-9][^ ]*( ([a-z0-9(][^ ]*|[A-Z]{2,}[^ ]*|BioProject|FASTQ|ID))*$/;
    const badLabels = fieldSet.fields.filter((field) => !sentenceCase.test(field.label));
    expect(badLabels.map((field) => field.label)).toEqual([]);
    const oneSentence = /^[A-Z][^—;]*\.$/;
    const badDescriptions = fieldSet.fields.filter(
      (field) => !oneSentence.test(field.description) || field.description.includes(". "),
    );
    expect(badDescriptions.map((field) => field.description)).toEqual([]);
    // Required fields are listed first and are never grouped; optional ones always are.
    const badGroups = fieldSet.fields.filter(
      (field) => (field.group === undefined) !== field.required,
    );
    expect(badGroups.map((field) => field.key)).toEqual([]);
  });

  it.each(all)("%s has no header name that points at two fields", (_id, fieldSet) => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const field of fieldSet.fields) {
      for (const name of [field.key, field.label, ...field.aliases]) {
        const folded = normalizeName(name);
        const previous = owner.get(folded);
        if (previous !== undefined && previous !== field.key) {
          clashes.push(`"${name}" means both ${previous} and ${field.key}`);
        }
        owner.set(folded, field.key);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("reports field counts", () => {
    const counts = Object.fromEntries(
      all.map(([id, fieldSet]) => [
        id,
        [
          fieldSet.fields.filter((field) => field.required).length,
          fieldSet.fields.filter((field) => !field.required).length,
        ],
      ]),
    );
    expect(counts).toEqual({
      microhaplotypes: [4, 19],
      panelTargets: [3, 13],
      genomes: [4, 2],
      specimens: [1, 33],
      librarySamples: [3, 11],
      project: [2, 4],
      sequencing: [7, 9],
      bioinformaticsMethods: [2, 3],
      bioinformaticsRuns: [1, 1],
      readCountTotals: [2, 0],
      readCountsByStage: [4, 0],
    });
  });
});

describe("field dependencies", () => {
  it("name only fields of their own set, with unique ids", () => {
    for (const fieldSet of FIELD_SETS.values()) {
      const keys = new Set(fieldSet.fields.map((field) => field.key));
      const ids = fieldSet.dependencies.map((dependency) => dependency.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const dependency of fieldSet.dependencies) {
        const named = [
          ...dependency.when,
          ...dependency.needs.flatMap((need) => (typeof need === "string" ? [need] : need.anyOf)),
        ];
        expect(named.filter((key) => !keys.has(key))).toEqual([]);
        expect(dependency.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      }
    }
  });

  it("are switched on only by optional fields", () => {
    for (const fieldSet of FIELD_SETS.values()) {
      for (const dependency of fieldSet.dependencies) {
        for (const key of dependency.when) {
          expect(fieldSet.fields.find((field) => field.key === key)?.required).toBe(false);
        }
      }
    }
  });
});

describe("yes-or-no fields", () => {
  it("use the boolean kind", () => {
    const specimens = getFieldSet("specimens");
    for (const key of ["gravid", "bloodMeal", "hasTravelOutSixMonth"]) {
      expect(specimens.fields.find((field) => field.key === key)?.kind).toBe("boolean");
    }
  });
});
