import type { PortableMicrohaplotypeObject } from "pmotools-ts";
import { describe, expect, it } from "vitest";

import { richPmo } from "@/domain/tools/testing";
import { COLLECTION_YEAR_FIELD } from "@/domain/tools/types";
import { choicesOf, makeSubset, previewSubset } from "@/domain/tools/workingPmo";

import { initialForm, keptSpecimens, requestOf, type SubsetForm } from "./subsetModel";

describe("subsetModel: raw vs derived collection_year", () => {
  it("routes a raw custom collection_year field to criteria and agrees with previewSubset and makeSubset", () => {
    const base = richPmo();
    const pmo: PortableMicrohaplotypeObject = {
      ...base,
      specimen_info: [
        { ...base.specimen_info[0], specimen_name: "spec1", collection_year: "FY20" },
        { ...base.specimen_info[1], specimen_name: "spec2", collection_year: "FY21" },
        { ...base.specimen_info[2], specimen_name: "neg" },
      ],
    };
    const choices = choicesOf(pmo);
    const yearMeta = choices.metadata.find((field) => field.field === COLLECTION_YEAR_FIELD);
    if (yearMeta === undefined) throw new Error("expected collection_year field");

    const form: SubsetForm = {
      ...initialForm(choices),
      specimenMode: "metadata",
      conditions: [{ field: yearMeta.field, source: yearMeta.source, values: ["FY20"] }],
    };

    expect(keptSpecimens(choices, form)).toEqual(["spec1"]);

    const request = requestOf(form);
    expect(request.specimens).toEqual({
      kind: "metadata",
      criteria: { collection_year: ["FY20"] },
    });

    const preview = previewSubset(pmo, request);
    const { outcome, subset } = makeSubset(pmo, request, "study.json");
    if (outcome.kind !== "made" || subset === null) throw new Error(outcome.kind);
    expect(subset.specimen_info.map((s) => s.specimen_name)).toEqual(["spec1"]);
    expect(preview.specimens).toBe(1);
    expect(outcome.summary.specimens).toBe(1);
  });

  it("routes a derived collection_year field to collectionYears when a 1-value raw collection_year was dropped", () => {
    const base = richPmo();
    const pmo: PortableMicrohaplotypeObject = {
      ...base,
      specimen_info: base.specimen_info.map((specimen) =>
        Object.assign({}, specimen, { collection_year: "legacy" }),
      ),
    };
    const choices = choicesOf(pmo);
    const yearMeta = choices.metadata.find((field) => field.field === COLLECTION_YEAR_FIELD);
    if (yearMeta === undefined) throw new Error("expected derived collection_year field");

    const form: SubsetForm = {
      ...initialForm(choices),
      specimenMode: "metadata",
      conditions: [{ field: yearMeta.field, source: yearMeta.source, values: ["2019"] }],
    };

    expect(keptSpecimens(choices, form)).toEqual(["spec1", "spec2"]);

    const request = requestOf(form);
    expect(request.specimens).toEqual({
      kind: "metadata",
      criteria: {},
      collectionYears: ["2019"],
    });

    const preview = previewSubset(pmo, request);
    const { outcome, subset } = makeSubset(pmo, request, "study.json");
    if (outcome.kind !== "made" || subset === null) throw new Error(outcome.kind);
    expect(subset.specimen_info.map((s) => s.specimen_name)).toEqual(["spec1", "spec2"]);
    expect(preview.specimens).toBe(2);
    expect(outcome.summary.specimens).toBe(2);
  });
});
