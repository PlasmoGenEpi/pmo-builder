import { describe, expect, it } from "vitest";

import { DEFAULT_LIST_STATE, publishedHref, readListState, writeListState } from "./address";

describe("published list address", () => {
  it("writes the default state as an empty query and a clean path", () => {
    expect(writeListState(DEFAULT_LIST_STATE)).toBe("");
    expect(publishedHref(DEFAULT_LIST_STATE)).toBe("/published");
    expect(readListState("")).toEqual(DEFAULT_LIST_STATE);
    expect(readListState("?")).toEqual(DEFAULT_LIST_STATE);
  });

  it("round-trips search, countries, panel, species, collection year, sort and view", () => {
    const state = {
      search: "maputo surveillance",
      countries: ["Mozambique", "Uganda"],
      panel: "Mad4hatter",
      species: 5855,
      year: 2017,
      sort: "specimens" as const,
      view: "table" as const,
    };
    const query = writeListState(state);
    expect(query).toBe(
      "q=maputo+surveillance&country=Mozambique&country=Uganda&panel=Mad4hatter&species=5855&year=2017&sort=specimens&view=table",
    );
    expect(publishedHref(state)).toBe(`/published?${query}`);
    expect(readListState(query)).toEqual(state);
    expect(readListState(`?${query}`)).toEqual(state);
  });

  it("writes the table view and omits the default list view", () => {
    expect(DEFAULT_LIST_STATE.view).toBe("list");
    expect(writeListState({ ...DEFAULT_LIST_STATE, view: "list" })).toBe("");
    const tableState = { ...DEFAULT_LIST_STATE, view: "table" as const };
    expect(writeListState(tableState)).toBe("view=table");
    expect(readListState("view=table")).toEqual(tableState);
    expect(readListState("view=list")).toEqual(DEFAULT_LIST_STATE);
    expect(readListState("view=grid")).toEqual(DEFAULT_LIST_STATE);
    expect(readListState("view=")).toEqual(DEFAULT_LIST_STATE);
  });

  it("writes non-default sort orders and omits the default newest sort", () => {
    expect(DEFAULT_LIST_STATE.sort).toBe("newest");
    expect(writeListState({ ...DEFAULT_LIST_STATE, sort: "newest" })).toBe("");

    for (const sort of ["specimens", "year", "title"] as const) {
      const state = { ...DEFAULT_LIST_STATE, sort };
      const query = writeListState(state);
      expect(query).toBe(`sort=${sort}`);
      expect(readListState(query)).toEqual(state);
    }
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
    expect(
      readListState("country=&panel=&species=vivax&year=not-a-year&sort=oldest&extra=1"),
    ).toEqual(DEFAULT_LIST_STATE);
    expect(readListState("sort=")).toEqual(DEFAULT_LIST_STATE);
    expect(readListState("sort=newest")).toEqual(DEFAULT_LIST_STATE);
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
