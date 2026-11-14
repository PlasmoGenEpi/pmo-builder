import { describe, expect, it } from "vitest";

import { getFieldSet } from "../fields";
import { parseFile } from "../import";
import { exampleBlob } from "../import/exampleFiles.testing";
import { FIELD_SET_IDS, type ColumnMapping, type FieldSetId, type FieldSetSpec } from "../types";

import {
  FUZZY_THRESHOLD,
  checkMapping,
  nameSimilarity,
  normalizeName,
  suggestMapping,
  tokenize,
} from "./index";

async function columnsOf(name: string): Promise<readonly string[]> {
  return (await parseFile(await exampleBlob(name), name)).table.columns;
}

function requiredMatches(
  fieldSetId: FieldSetId,
  columns: readonly string[],
): Record<string, string | null> {
  const fieldSet = getFieldSet(fieldSetId);
  const { mapping } = suggestMapping(fieldSet, columns);
  return Object.fromEntries(
    fieldSet.fields
      .filter((field) => field.required)
      .map((field) => [field.key, mapping.fields[field.key] ?? null]),
  );
}

describe("suggestMapping on the MAD4HATTER examples", () => {
  it("matches the allele tables", async () => {
    const files = [
      "mad4hatter_allele_data_example.csv",
      "mad4hatter_allele_data_example_multi_bioinfo.csv",
    ];
    const tables = await Promise.all(files.map(columnsOf));
    const expected = {
      librarySampleName: "SampleID",
      targetName: "Locus",
      seq: "ASV",
      reads: "Reads",
    };
    expect(tables.map((columns) => requiredMatches("microhaplotypes", columns))).toEqual([
      expected,
      expected,
    ]);
    const { mapping } = suggestMapping(
      getFieldSet("microhaplotypes"),
      await columnsOf("mad4hatter_allele_data_example.csv"),
    );
    expect(mapping.fields.microhaplotypeName).toBe("Allele");
    // The pseudo-CIGAR needs a chromosome, start and end the table does not have.
    expect(mapping.fields.pseudocigar).toBeNull();
    expect(checkMapping(getFieldSet("microhaplotypes"), tables[0] ?? [], mapping)).toEqual([]);
  });

  it("matches the panel table without misplacing amplicon coordinates", async () => {
    const columns = await columnsOf("mad4hatter_panel_info_example.csv");
    expect(requiredMatches("panelTargets", columns)).toEqual({
      targetName: "amplicon",
      forwardPrimersSeq: "fwd_primer",
      reversePrimersSeq: "rev_primer",
    });
    const { mapping, matches } = suggestMapping(getFieldSet("panelTargets"), columns);
    // The insert columns match by alias, but there is no chromosome column for them.
    expect(mapping.fields.insertStart).toBeNull();
    expect(mapping.fields.insertEnd).toBeNull();
    expect(matches.insertStart).toEqual({ column: null, confidence: "none" });
    expect(mapping.fields.targetAttributes).toBe("target_type");
    expect(checkMapping(getFieldSet("panelTargets"), columns, mapping)).toEqual([]);
    const used = Object.values(mapping.fields);
    for (const column of [
      "amplicon_start",
      "amplicon_end",
      "amplicon_length",
      "ampInsert_length",
    ]) {
      expect(used).not.toContain(column);
    }
  });

  it("matches the metadata table as specimens", async () => {
    const columns = await columnsOf("mad4hatter_metadata_example.tsv");
    expect(requiredMatches("specimens", columns)).toEqual({ specimenName: "specimen_id" });
    const { mapping } = suggestMapping(getFieldSet("specimens"), columns);
    expect(mapping.fields).toMatchObject({
      collectionDate: "collection_date",
      collectionCountry: "collection_country",
      specimenCollectDevice: "samp_collect_device",
      latLon: "lat_lon",
      geoAdmin3: "geo_admin3",
      hostTaxonId: "host_taxon_id",
      projectName: "project_name",
      specimenStoreLoc: "samp_store_loc",
      specimenTaxonId: "samp_taxon_id",
    });
    // plate_name, plate_row and plate_col are the library prep plate, not the storage plate.
    expect(mapping.fields).toMatchObject({
      storagePlateName: null,
      storagePlateRow: null,
      storagePlateCol: null,
      storagePlatePosition: null,
    });
    expect(checkMapping(getFieldSet("specimens"), columns, mapping)).toEqual([]);
  });

  it("matches the metadata table as library samples", async () => {
    const columns = await columnsOf("mad4hatter_metadata_example.xlsx");
    expect(requiredMatches("librarySamples", columns)).toEqual({
      librarySampleName: "experiment_sample_id",
      specimenName: "specimen_id",
      panelName: "panel_id",
    });
    const { mapping } = suggestMapping(getFieldSet("librarySamples"), columns);
    expect(mapping.fields).toMatchObject({
      sequencingInfoName: "sequencing_info_id",
      libraryPrepPlateName: "plate_name",
      libraryPrepPlateRow: "plate_row",
      libraryPrepPlateCol: "plate_col",
    });
  });

  it("matches both read-count files", async () => {
    expect(requiredMatches("readCountTotals", await columnsOf("example_raw_reads.txt"))).toEqual({
      librarySampleName: "sample",
      totalRawCount: "raw_count",
    });
    expect(requiredMatches("readCountsByStage", await columnsOf("reads_per_stage.txt"))).toEqual({
      librarySampleName: "sample",
      targetName: "target",
      stage: "stage",
      readCount: "reads",
    });
  });

  it("matches the template's own headers exactly", () => {
    const fieldSet = getFieldSet("sequencing");
    const columns = fieldSet.fields.map((field) => field.key);
    const { matches } = suggestMapping(fieldSet, columns);
    for (const field of fieldSet.fields)
      expect(matches[field.key]).toEqual({ column: field.key, confidence: "exact" });
  });
});

describe("suggestMapping rules", () => {
  const unrelated = ["colour", "weight_kg", "notes_2", "favourite_food", "x", "Column 7"];

  it.each([...FIELD_SET_IDS])("does not force a match for %s", (id) => {
    const fieldSet = getFieldSet(id);
    const { matches } = suggestMapping(fieldSet, unrelated);
    const required = fieldSet.fields.filter((entry) => entry.required);
    expect(required.map((field) => matches[field.key])).toEqual(
      required.map(() => ({ column: null, confidence: "none" })),
    );
  });

  it.each([...FIELD_SET_IDS])("never suggests one column twice for %s", async (id) => {
    const files = [
      "mad4hatter_allele_data_example_multi_bioinfo.csv",
      "mad4hatter_panel_info_example.csv",
      "mad4hatter_metadata_example.tsv",
      "reads_per_stage.txt",
    ];
    const fieldSet = getFieldSet(id);
    const everything = [
      ...new Set((await Promise.all(files.map(columnsOf))).flat()),
      ...fieldSet.fields.flatMap((field) => [field.key, field.label, ...field.aliases]),
    ];
    const { mapping } = suggestMapping(fieldSet, everything);
    const used = Object.values(mapping.fields).filter((column) => column !== null);
    expect(new Set(used).size).toBe(used.length);
    expect(mapping.additionalColumns).toEqual([]);
    expect(
      checkMapping(fieldSet, everything, mapping).filter((p) => p.kind !== "missing-required"),
    ).toEqual([]);
  });

  it("compares names without case, spaces, underscores, hyphens or dots", () => {
    for (const column of ["Sample ID", "sample-id", "sample.id", "SAMPLE_ID", " sample_id "]) {
      expect(requiredMatches("readCountTotals", [column, "raw_count"]).librarySampleName).toBe(
        column,
      );
    }
    expect(normalizeName("Library.Sample-Name 1")).toBe("librarysamplename1");
  });

  const fieldSet: FieldSetSpec = {
    id: "microhaplotypes",
    title: "Test",
    allowsAdditionalColumns: true,
    dependencies: [],
    fields: [
      {
        key: "hostName",
        label: "Host name",
        description: "A.",
        required: false,
        kind: "text",
        aliases: ["subject"],
        group: "G",
      },
      {
        key: "specimenName",
        label: "Specimen name",
        description: "A.",
        required: true,
        kind: "text",
        aliases: ["subject"],
      },
      {
        key: "sampleName",
        label: "Sample name",
        description: "A.",
        required: false,
        kind: "text",
        aliases: [],
        group: "G",
      },
    ],
  };

  it("gives a column to the field it matches best, not the first field", () => {
    const ordered: FieldSetSpec = {
      ...fieldSet,
      fields: [
        {
          key: "sampleName",
          label: "Sample name",
          description: "A.",
          required: true,
          kind: "text",
          aliases: [],
        },
        {
          key: "librarySampleName",
          label: "Library sample name",
          description: "A.",
          required: false,
          kind: "text",
          aliases: [],
          group: "G",
        },
      ],
    };
    // `library_sample_name` is fuzzy (0.8) for the first, required field and
    // exact for the second, optional one. The better match wins.
    expect(nameSimilarity("library_sample_name", "sample name")).toBeGreaterThanOrEqual(
      FUZZY_THRESHOLD,
    );
    const { mapping, matches } = suggestMapping(ordered, ["library_sample_name"]);
    expect(mapping.fields).toEqual({ sampleName: null, librarySampleName: "library_sample_name" });
    expect(matches.sampleName).toEqual({ column: null, confidence: "none" });
    expect(matches.librarySampleName).toEqual({
      column: "library_sample_name",
      confidence: "exact",
    });
  });

  it("picks the higher fuzzy score", () => {
    const { mapping, matches } = suggestMapping(fieldSet, [
      "specimen_name",
      "host_specimen_name",
      "sample_name",
    ]);
    expect(mapping.fields).toEqual({
      hostName: "host_specimen_name",
      specimenName: "specimen_name",
      sampleName: "sample_name",
    });
    expect(matches.hostName?.confidence).toBe("fuzzy");
  });

  it("lets a required field win a tie", () => {
    const { mapping } = suggestMapping(fieldSet, ["subject"]);
    expect(mapping.fields).toEqual({ hostName: null, specimenName: "subject", sampleName: null });
  });

  it("prefers an exact or alias match over a fuzzy one", () => {
    const { matches } = suggestMapping(getFieldSet("microhaplotypes"), [
      "sample_name",
      "library_sample",
    ]);
    expect(matches.librarySampleName).toEqual({ column: "sample_name", confidence: "alias" });
  });
});

describe("fuzzy score", () => {
  it.each([
    ["sample name", "library sample name"],
    ["colection_date", "collection_date"],
    ["colectiondate", "collection_date"],
    ["Specimen-ID", "specimen name"],
    ["fwd primer seq", "forward primers seq"],
    ["host_specimen_name", "host name"],
  ])("accepts %j for %j", (column, name) => {
    expect(nameSimilarity(column, name)).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
  });

  it.each([
    ["date", "collection date"],
    ["start", "insert start"],
    ["amplicon_start", "insert_start"],
    ["amplicon_end", "amplicon_gene"],
    ["geo_admin1", "geo_admin2"],
    ["plate_row", "plate_col"],
    ["sample", "library sample name"],
    ["reads", "read count"],
  ])("rejects %j for %j", (column, name) => {
    expect(nameSimilarity(column, name)).toBeLessThan(FUZZY_THRESHOLD);
  });

  it("splits camel case and acronyms into words", () => {
    expect(tokenize("SampleID")).toEqual(["sample", "name"]);
    expect(tokenize("ampInsert_start")).toEqual(["amp", "insert", "start"]);
    expect(tokenize("PseudoCIGAR")).toEqual(["pseudo", "cigar"]);
  });
});

describe("checkMapping", () => {
  const fieldSet = getFieldSet("readCountsByStage");
  const columns = ["sample", "target", "stage", "reads"];

  it("accepts a complete mapping", () => {
    const { mapping } = suggestMapping(fieldSet, columns);
    expect(checkMapping(fieldSet, columns, mapping)).toEqual([]);
  });

  it("reports missing required fields, shared columns and unknown columns", () => {
    const mapping: ColumnMapping = {
      fields: {
        librarySampleName: "sample",
        targetName: "sample",
        stage: null,
        readCount: "gone",
        extra: "x",
      },
      additionalColumns: [],
    };
    expect(checkMapping(fieldSet, columns, mapping)).toEqual([
      { kind: "missing-required", fieldKey: "stage" },
      {
        kind: "duplicate-column",
        column: "sample",
        fieldKeys: ["librarySampleName", "targetName"],
      },
      { kind: "unknown-column", fieldKey: "readCount", column: "gone" },
    ]);
  });

  it("treats an absent key as unmapped", () => {
    expect(checkMapping(fieldSet, columns, { fields: {}, additionalColumns: [] })).toHaveLength(4);
  });
});

describe("fields that only make sense together", () => {
  const fieldSet = getFieldSet("panelTargets");
  const base = ["target", "fwd_primer", "rev_primer"];

  it("leaves a group unmapped when a companion has no column", () => {
    const { mapping } = suggestMapping(fieldSet, [...base, "insert_start", "insert_end"]);
    expect(mapping.fields).toMatchObject({ insertStart: null, insertEnd: null, chrom: null });
  });

  it("maps the group when every companion has a column", () => {
    const { mapping } = suggestMapping(fieldSet, [...base, "insert_start", "insert_end", "chr"]);
    expect(mapping.fields).toMatchObject({
      insertStart: "insert_start",
      insertEnd: "insert_end",
      chrom: "chr",
    });
  });

  it("follows a chain of dependencies to a mapping with no problems", () => {
    const alleles = getFieldSet("microhaplotypes");
    // The chromosome would serve the pseudo-CIGAR, but the allele location
    // needs a start and end too, so the chromosome, the strand, the
    // pseudo-CIGAR and its start and end all drop out.
    const columns = ["sample", "target", "seq", "reads", "chrom", "strand"];
    const withCigar = [...columns, "pseudocigar", "pseudocigar_ref_start", "pseudocigar_ref_end"];
    const { mapping } = suggestMapping(alleles, withCigar);
    expect(mapping.fields).toMatchObject({
      chrom: null,
      strand: null,
      pseudocigar: null,
      pseudocigarStart: null,
      pseudocigarEnd: null,
    });
    expect(checkMapping(alleles, withCigar, mapping)).toEqual([]);

    const complete = [...withCigar, "start", "end"];
    const full = suggestMapping(alleles, complete).mapping;
    expect(full.fields).toMatchObject({
      chrom: "chrom",
      start: "start",
      end: "end",
      pseudocigar: "pseudocigar",
      pseudocigarStart: "pseudocigar_ref_start",
    });
    expect(checkMapping(alleles, complete, full)).toEqual([]);
  });

  it("reports an incomplete group, naming what is mapped and what is missing", () => {
    const columns = [...base, "insert_start"];
    const mapping: ColumnMapping = {
      fields: {
        targetName: "target",
        forwardPrimersSeq: "fwd_primer",
        reversePrimersSeq: "rev_primer",
        insertStart: "insert_start",
      },
      additionalColumns: [],
    };
    expect(checkMapping(fieldSet, columns, mapping)).toEqual([
      {
        kind: "incomplete-group",
        dependencyId: "insert-location",
        mappedKeys: ["insertStart"],
        missing: ["chrom", "insertEnd"],
      },
    ]);
  });

  it("accepts either field of a choice", () => {
    const alleles = getFieldSet("microhaplotypes");
    const columns = ["s", "t", "q", "r", "c", "ps", "pe", "cigar"];
    const fields = {
      librarySampleName: "s",
      targetName: "t",
      seq: "q",
      reads: "r",
      pseudocigar: "cigar",
      pseudocigarStart: "ps",
      pseudocigarEnd: "pe",
    };
    const withOwnChrom = { fields: { ...fields, pseudocigarChrom: "c" }, additionalColumns: [] };
    expect(checkMapping(alleles, columns, withOwnChrom)).toEqual([]);
    const withoutChrom = { fields, additionalColumns: [] };
    expect(checkMapping(alleles, columns, withoutChrom)).toEqual([
      {
        kind: "incomplete-group",
        dependencyId: "pseudocigar",
        mappedKeys: ["pseudocigar"],
        missing: [{ anyOf: ["pseudocigarChrom", "chrom"] }],
      },
    ]);
  });
});

describe("checkMapping and extra columns", () => {
  const fieldSet = getFieldSet("readCountTotals");
  const columns = ["sample", "raw_count", "note"];
  const fields = { librarySampleName: "sample", totalRawCount: "raw_count" };

  it("accepts an unmapped column that is in the table", () => {
    expect(checkMapping(fieldSet, columns, { fields, additionalColumns: ["note"] })).toEqual([]);
  });

  it("reports an extra column the table does not have, and one that is also mapped", () => {
    expect(
      checkMapping(fieldSet, columns, { fields, additionalColumns: ["gone", "sample", "gone"] }),
    ).toEqual([
      { kind: "unknown-additional-column", column: "gone" },
      { kind: "additional-column-mapped", column: "sample", fieldKey: "librarySampleName" },
    ]);
  });
});
