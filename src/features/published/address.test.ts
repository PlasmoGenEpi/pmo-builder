import { describe, expect, it } from "vitest";

import { DEFAULT_LIST_STATE, publishedHref, readListState, writeListState } from "./address";

describe("published list address", () => {
  it("writes the default state as an empty query and a clean path", () => {
    expect(writeListState(DEFAULT_LIST_STATE)).toBe("");
    expect(publishedHref(DEFAULT_LIST_STATE)).toBe("/published");
    expect(readListState("")).toEqual(DEFAULT_LIST_STATE);
    expect(readListState("?")).toEqual(DEFAULT_LIST_STATE);
  });

  it("round-trips search, countries, panel, species and collection year", () => {
    const state = {
      search: "maputo surveillance",
      countries: ["Mozambique", "Uganda"],
      panel: "Mad4hatter",
      species: 5855,
      year: 2017,
    };
    const query = writeListState(state);
    expect(query).toBe(
      "q=maputo+surveillance&country=Mozambique&country=Uganda&panel=Mad4hatter&species=5855&year=2017",
    );
    expect(publishedHref(state)).toBe(`/published?${query}`);
    expect(readListState(query)).toEqual(state);
    expect(readListState(`?${query}`)).toEqual(state);
  });

  it("omits blank search text while preserving spaces inside or at the end of a typed query", () => {
    expect(writeListState({ ...DEFAULT_LIST_STATE, search: "   " })).toBe("");
    expect(readListState("q=+++")).toEqual(DEFAULT_LIST_STATE);

    const trailingSpace = { ...DEFAULT_LIST_STATE, search: "maputo " };
    expect(readListState(writeListState(trailingSpace))).toEqual(trailingSpace);

    const punctuation = {
      ...DEFAULT_LIST_STATE,
      search: "a&b+c",
      countries: ["Côte d'Ivoire"],
    };
    expect(readListState(writeListState(punctuation))).toEqual(punctuation);
  });

  it("deduplicates repeated countries and ignores blank entries", () => {
    expect(
      readListState("country=Kenya&country=&country=Kenya&country=Uganda&country=+++"),
    ).toEqual({
      ...DEFAULT_LIST_STATE,
      countries: ["Kenya", "Uganda"],
    });
    expect(
      writeListState({
        ...DEFAULT_LIST_STATE,
        countries: ["Kenya", " ", "Kenya", "Uganda"],
      }),
    ).toBe("country=Kenya&country=Uganda");
  });

  it("ignores malformed, empty and unknown query parameters", () => {
    expect(readListState("country=&panel=&species=vivax&year=not-a-year&extra=1")).toEqual(
      DEFAULT_LIST_STATE,
    );
    expect(readListState("species=0&year=0")).toEqual(DEFAULT_LIST_STATE);
    expect(readListState("species=-5855&year=-2020")).toEqual(DEFAULT_LIST_STATE);
    expect(readListState("species=5855.5&year=2019.5")).toEqual(DEFAULT_LIST_STATE);
    expect(readListState("species=5855&year=2021&unknown=foo")).toEqual({
      ...DEFAULT_LIST_STATE,
      species: 5855,
      year: 2021,
    });
  });
});
