import { describe, expect, it } from "vitest";

import { DEFAULT_LIST_STATE, publishedHref, readListState, writeListState } from "./address";

describe("published list address", () => {
  it("writes the default state as an empty query and a clean path", () => {
    expect(writeListState(DEFAULT_LIST_STATE)).toBe("");
    expect(publishedHref(DEFAULT_LIST_STATE)).toBe("/published");
    expect(readListState("")).toEqual(DEFAULT_LIST_STATE);
    expect(readListState("?")).toEqual(DEFAULT_LIST_STATE);
  });

  it("round-trips search, country, panel and collection year", () => {
    const state = {
      search: "maputo surveillance",
      country: "Mozambique",
      panel: "Mad4hatter",
      year: 2017,
    };
    const query = writeListState(state);
    expect(query).toBe("q=maputo+surveillance&country=Mozambique&panel=Mad4hatter&year=2017");
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
      country: "Côte d'Ivoire",
    };
    expect(readListState(writeListState(punctuation))).toEqual(punctuation);
  });

  it("ignores malformed, empty and unknown query parameters", () => {
    expect(readListState("country=&panel=&year=not-a-year&extra=1")).toEqual(DEFAULT_LIST_STATE);
    expect(readListState("year=0")).toEqual(DEFAULT_LIST_STATE);
    expect(readListState("year=-2020")).toEqual(DEFAULT_LIST_STATE);
    expect(readListState("year=2019.5")).toEqual(DEFAULT_LIST_STATE);
    expect(readListState("year=2021&unknown=foo")).toEqual({
      ...DEFAULT_LIST_STATE,
      year: 2021,
    });
  });
});
