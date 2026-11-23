import { I18nProvider } from "@lingui/react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { App } from "@/app/App";
import { useHashLocation } from "@/app/hashLocation";
import type { ZenodoConfig } from "@/features/review/zenodo";
import { createTestStore } from "@/features/shared/testing";
import { i18n } from "@/i18n";
import { formatCount } from "@/ui";
import { installDomPolyfills } from "@/ui/testPolyfills";

import type { CatalogueLoad } from "./catalogue";
import { DatasetPage } from "./DatasetPage";
import { clearScrollPositionsForTests, PublishedPage } from "./PublishedPage";
import { catalogue, dataset, DATASETS, largeCatalogue } from "./testing";
import { resetSharedCatalogueForTests } from "./useCatalogue";

beforeAll(installDomPolyfills);

afterEach(() => {
  clearScrollPositionsForTests();
  resetSharedCatalogueForTests();
  vi.restoreAllMocks();
});

/** `<Trans>` and an isolated memory router, as in the app. */
function makeWrapper(path = "/published") {
  const location = memoryLocation({ path, record: true });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nProvider i18n={i18n}>
        <Router hook={location.hook}>{children}</Router>
      </I18nProvider>
    );
  }
  return { wrapper: Wrapper, location };
}

function DefaultWrapper({ children }: { children: ReactNode }) {
  const [location] = useState(() => memoryLocation({ path: "/published", record: true }));
  return (
    <I18nProvider i18n={i18n}>
      <Router hook={location.hook}>{children}</Router>
    </I18nProvider>
  );
}

const wrapper = DefaultWrapper;

const ZENODO: ZenodoConfig = {
  community: "pmocommunity",
  communityName: "PMO",
  clientId: null,
};

const gives = (load: CatalogueLoad) => () => Promise.resolve(load);
const PENDING = () => new Promise<CatalogueLoad>(() => undefined);
const READY = gives({ kind: "ready", index: catalogue() });

function titles(): string[] {
  return screen
    .getAllByRole("article")
    .map((card) => within(card).getByRole("heading").textContent);
}

function parseCount(value: string | undefined): number {
  return Number((value ?? "").replaceAll(",", ""));
}

async function choose(
  user: ReturnType<typeof userEvent.setup>,
  field: string,
  option: string | RegExp,
) {
  await user.click(screen.getByRole("combobox", { name: field }));
  await user.click(await screen.findByRole("option", { name: option }));
}

function countryButton() {
  return screen.getByRole("button", { name: /^Country:/ });
}

describe("PublishedPage", () => {
  it("lists the datasets with totals, each linking to its page", async () => {
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper });
    expect(await screen.findByText("3 published PMOs")).toBeInTheDocument();
    expect(titles()).toEqual([
      "Maputo surveillance 2015 to 2019",
      "Northern Uganda cohort",
      "Border travellers, Mozambique and Eswatini",
    ]);
    expect(screen.getByText("1,258")).toBeInTheDocument();
    const [first] = screen.getAllByRole("article");
    if (first === undefined) throw new Error("no dataset");
    expect(within(first).getByText("50 specimens")).toBeInTheDocument();
    expect(within(first).getByText("276 targets")).toBeInTheDocument();
    expect(within(first).getByText("Mad4hatter")).toBeInTheDocument();
    expect(within(first).getByText("Mozambique")).toBeInTheDocument();
    expect(within(first).getByText("2015 to 2019")).toBeInTheDocument();
    expect(screen.getByText("Achan, Sarah · 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Northern Uganda cohort" })).toHaveAttribute(
      "href",
      "/published/302",
    );
    expect(screen.getByRole("link", { name: /PMO community/ })).toHaveAttribute(
      "href",
      "https://zenodo.org/communities/pmocommunity/",
    );
    expect(screen.getByText(/Read from Zenodo on 15 November 2026/)).toBeInTheDocument();
  });

  it("narrows the list by search, countries, panel, species and year, showing cross-filter counts", async () => {
    const user = userEvent.setup();
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper });
    await screen.findByText("3 published PMOs");

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("3 published PMOs");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");

    // Searching by species name and by covered collection year.
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "vivax");
    expect(titles()).toEqual(["Border travellers, Mozambique and Eswatini"]);
    expect(status).toHaveTextContent("1 of 3 published PMOs");
    await user.clear(screen.getByRole("searchbox", { name: "Search" }));

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "2017");
    expect(titles()).toEqual(["Maputo surveillance 2015 to 2019"]);
    expect(status).toHaveTextContent("1 of 3 published PMOs");
    await user.clear(screen.getByRole("searchbox", { name: "Search" }));

    // Choosing two countries lists published PMOs from either.
    await user.click(countryButton());
    await user.click(await screen.findByRole("checkbox", { name: "Uganda (1)" }));
    await user.click(screen.getByRole("checkbox", { name: "Eswatini (1)" }));
    await user.keyboard("{Escape}");
    expect(titles()).toEqual([
      "Northern Uganda cohort",
      "Border travellers, Mozambique and Eswatini",
    ]);
    expect(status).toHaveTextContent("2 of 3 published PMOs");

    // Panel counts reflect the two chosen countries (AMPLseq: 2, Mad4hatter: 1).
    await choose(user, "Panel", "AMPLseq (2)");
    expect(titles()).toEqual([
      "Northern Uganda cohort",
      "Border travellers, Mozambique and Eswatini",
    ]);

    // Country counts reflect the active AMPLseq panel (Mozambique drops from 2 to 1).
    await user.click(countryButton());
    expect(await screen.findByRole("checkbox", { name: "Mozambique (1)" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear countries" }));
    await user.keyboard("{Escape}");

    // Species filter lists species by name with counts reflecting AMPLseq (falciparum: 2, vivax: 1).
    await choose(user, "Species", "Plasmodium vivax (1)");
    expect(titles()).toEqual(["Border travellers, Mozambique and Eswatini"]);
    expect(status).toHaveTextContent("1 of 3 published PMOs");

    await choose(user, "Species", "Any species");
    await choose(user, "Panel", "Any panel");
    await choose(user, "Collected in", "2017 (1)");
    expect(titles()).toEqual(["Maputo surveillance 2015 to 2019"]);
  });

  it("shows whole-catalogue totals without a filtered indicator, then updates them when filtered and clears back", async () => {
    const user = userEvent.setup();
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper });
    await screen.findByText("3 published PMOs");

    const totals = screen.getByRole("region", { name: "Totals" });
    expect(within(totals).queryByText("Filtered list")).not.toBeInTheDocument();
    expect(
      within(totals)
        .getAllByRole("definition")
        .map((el) => el.textContent),
    ).toEqual(["3", "1,258", "3"]);

    await user.click(countryButton());
    await user.click(await screen.findByRole("checkbox", { name: "Mozambique (2)" }));
    await user.keyboard("{Escape}");
    expect(within(totals).getByText("Filtered list")).toBeInTheDocument();
    expect(
      within(totals)
        .getAllByRole("definition")
        .map((el) => el.textContent),
    ).toEqual(["2", "58", "2"]);

    await user.click(countryButton());
    await user.click(await screen.findByRole("button", { name: "Clear countries" }));
    await user.keyboard("{Escape}");
    expect(within(totals).queryByText("Filtered list")).not.toBeInTheDocument();
    expect(
      within(totals)
        .getAllByRole("definition")
        .map((el) => el.textContent),
    ).toEqual(["3", "1,258", "3"]);

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "uganda");
    expect(within(totals).getByText("Filtered list")).toBeInTheDocument();
    expect(
      within(totals)
        .getAllByRole("definition")
        .map((el) => el.textContent),
    ).toEqual(["1", "1,200", "1"]);

    await user.clear(screen.getByRole("searchbox", { name: "Search" }));
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "nothing like this");
    expect(within(totals).getByText("Filtered list")).toBeInTheDocument();
    expect(
      within(totals)
        .getAllByRole("definition")
        .map((el) => el.textContent),
    ).toEqual(["0", "0", "0"]);

    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    expect(within(totals).queryByText("Filtered list")).not.toBeInTheDocument();
    expect(
      within(totals)
        .getAllByRole("definition")
        .map((el) => el.textContent),
    ).toEqual(["3", "1,258", "3"]);
  });

  it("updates totals from a six-digit catalogue when a filter is applied", async () => {
    const user = userEvent.setup();
    render(
      <PublishedPage load={gives({ kind: "ready", index: largeCatalogue(150) })} zenodo={ZENODO} />,
      { wrapper },
    );
    await screen.findByText("150 published PMOs");

    const totals = screen.getByRole("region", { name: "Totals" });
    expect(within(totals).queryByText("Filtered list")).not.toBeInTheDocument();
    const unfilteredValues = within(totals)
      .getAllByRole("definition")
      .map((el) => el.textContent);
    expect(unfilteredValues[0]).toBe("150");
    expect(unfilteredValues[1]).toMatch(/^\d{3},\d{3}$/);
    expect(unfilteredValues[2]).toBe("26");

    await user.click(countryButton());
    await user.click(await screen.findByRole("checkbox", { name: /^Kenya \(\d+\)$/ }));
    await user.keyboard("{Escape}");
    expect(within(totals).getByText("Filtered list")).toBeInTheDocument();
    const filteredValues = within(totals)
      .getAllByRole("definition")
      .map((el) => el.textContent);
    expect(parseCount(filteredValues[0])).toBeGreaterThan(0);
    expect(parseCount(filteredValues[0])).toBeLessThan(150);
    expect(parseCount(filteredValues[1])).toBeGreaterThan(0);
    expect(parseCount(filteredValues[1])).toBeLessThan(parseCount(unfilteredValues[1]));
    expect(parseCount(filteredValues[2])).toBeGreaterThanOrEqual(1);
    expect(parseCount(filteredValues[2])).toBeLessThan(26);
  });

  it("offers to clear the filters when nothing matches and announces zero results", async () => {
    const user = userEvent.setup();
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper });
    await screen.findByText("3 published PMOs");
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "nothing like this");
    expect(screen.getByText("No published PMO matches")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 of 3 published PMOs");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    expect(titles()).toHaveLength(3);
    const search = screen.getByRole("searchbox", { name: "Search" });
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
  });

  it("leaves the filters out when there is only one dataset", async () => {
    render(
      <PublishedPage
        load={gives({ kind: "ready", index: catalogue(DATASETS.slice(0, 1)) })}
        zenodo={ZENODO}
      />,
      { wrapper },
    );
    expect(await screen.findByRole("article")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Country:/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a PMO" })).toHaveAttribute("href", "/build");
  });

  it("opens the first Build step from the Build a PMO link under the list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(catalogue()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const location = memoryLocation({ path: "/published", record: true });
    const user = userEvent.setup();
    render(<App locationHook={location.hook} store={createTestStore()} />);

    const share = await screen.findByRole("region", { name: "Share your data" });
    await user.click(within(share).getByRole("link", { name: "Build a PMO" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Microhaplotypes" }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/build/microhaplotypes");
    expect(location.history).not.toContain("/");
  });

  it("invites a first deposit when nothing has been published", async () => {
    render(
      <PublishedPage load={gives({ kind: "ready", index: catalogue([]) })} zenodo={ZENODO} />,
      { wrapper },
    );
    expect(await screen.findByText("No PMO has been published yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a PMO" })).toHaveAttribute("href", "/build");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("says so when the list is missing or cannot be loaded", async () => {
    const { unmount } = render(<PublishedPage load={gives({ kind: "missing" })} zenodo={null} />, {
      wrapper,
    });
    expect(
      await screen.findByText("This copy of PMO Builder has no list of published PMOs"),
    ).toBeInTheDocument();
    unmount();
    render(<PublishedPage load={gives({ kind: "failed" })} zenodo={ZENODO} />, { wrapper });
    expect(
      await screen.findByText("The list of published PMOs could not be loaded"),
    ).toBeInTheDocument();
  });

  it("keeps search, multiple countries and species in the address without pushing a history entry per letter", async () => {
    const user = userEvent.setup();
    const { wrapper: listWrapper, location } = makeWrapper("/published");
    const { unmount } = render(<PublishedPage load={READY} zenodo={ZENODO} />, {
      wrapper: listWrapper,
    });
    await screen.findByText("3 published PMOs");
    expect(location.history).toEqual(["/published"]);

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "mozambique");
    expect(location.history).toEqual(["/published?q=mozambique"]);

    await user.click(countryButton());
    await user.click(await screen.findByRole("checkbox", { name: "Mozambique (2)" }));
    await user.click(screen.getByRole("checkbox", { name: "Eswatini (1)" }));
    await user.keyboard("{Escape}");
    await choose(user, "Species", "Plasmodium vivax (1)");

    expect(location.history).toEqual([
      "/published?q=mozambique",
      "/published?q=mozambique&country=Mozambique",
      "/published?q=mozambique&country=Eswatini&country=Mozambique",
      "/published?q=mozambique&country=Eswatini&country=Mozambique&species=5855",
    ]);
    expect(titles()).toEqual(["Border travellers, Mozambique and Eswatini"]);

    // Loading the copied address shows the same filtered list.
    const copiedAddress = location.history.at(-1);
    unmount();
    const { wrapper: copiedWrapper } = makeWrapper(copiedAddress);
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper: copiedWrapper });
    expect(await screen.findByText("1 of 3 published PMOs")).toBeInTheDocument();
    expect(titles()).toEqual(["Border travellers, Mozambique and Eswatini"]);
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("mozambique");
    expect(countryButton()).toHaveTextContent("2 countries");
    expect(screen.getByRole("combobox", { name: "Species" })).toHaveTextContent("Plasmodium vivax");

    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    expect(titles()).toHaveLength(3);
    const search = screen.getByRole("searchbox", { name: "Search" });
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
  });

  it("clears the address when clicking Clear the filters", async () => {
    const user = userEvent.setup();
    const { wrapper: listWrapper, location } = makeWrapper(
      "/published?q=maputo&country=Mozambique",
    );
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper: listWrapper });
    await screen.findByText("1 of 3 published PMOs");

    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    expect(location.history.at(-1)).toBe("/published");
    expect(titles()).toHaveLength(3);
  });

  it("restores search, filters and scroll position when going Back from a dataset", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/#/published");
    const scrollDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY");
    let currentScrollY = 0;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => currentScrollY,
    });
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
      const first = args[0];
      if (
        typeof first === "object" &&
        first !== null &&
        "top" in first &&
        typeof first.top === "number"
      ) {
        currentScrollY = first.top;
      }
    });

    try {
      render(
        <I18nProvider i18n={i18n}>
          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/published">
                <PublishedPage load={READY} zenodo={ZENODO} />
              </Route>
              <Route path="/published/:id">
                {(params) => <DatasetPage id={params.id} load={READY} />}
              </Route>
            </Switch>
          </Router>
        </I18nProvider>,
      );

      await screen.findByText("3 published PMOs");
      await user.type(screen.getByRole("searchbox", { name: "Search" }), "mozambique");
      await choose(user, "Panel", "Mad4hatter (2)");
      expect(window.location.hash).toBe("#/published?q=mozambique&panel=Mad4hatter");

      currentScrollY = 640;
      window.dispatchEvent(new Event("scroll"));

      await user.click(screen.getByRole("link", { name: "Maputo surveillance 2015 to 2019" }));
      expect(
        await screen.findByRole("heading", { level: 1, name: "Maputo surveillance 2015 to 2019" }),
      ).toBeInTheDocument();
      expect(window.location.hash).toBe("#/published/301");

      scrollToSpy.mockClear();
      currentScrollY = 0;
      window.history.back();

      expect(await screen.findByText("2 of 3 published PMOs")).toBeInTheDocument();
      expect(window.location.hash).toBe("#/published?q=mozambique&panel=Mad4hatter");
      expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("mozambique");
      expect(titles()).toEqual([
        "Maputo surveillance 2015 to 2019",
        "Border travellers, Mozambique and Eswatini",
      ]);
      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledWith({ top: 640 });
      });
    } finally {
      window.history.replaceState(null, "", "/");
      if (scrollDescriptor !== undefined) {
        Object.defineProperty(window, "scrollY", scrollDescriptor);
      } else {
        Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
      }
    }
  });

  it("sorts the list with a visibly labelled control, updates the address, and works from the keyboard", async () => {
    const user = userEvent.setup();
    const { wrapper: listWrapper, location } = makeWrapper("/published");
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper: listWrapper });
    await screen.findByText("3 published PMOs");

    const sortControl = screen.getByLabelText("Sort by");
    expect(sortControl).toBe(screen.getByRole("combobox", { name: "Sort by" }));
    expect(sortControl).toHaveTextContent("Newest published");

    // Keyboard: focus the sort control, open it, move down to "Most specimens", and select.
    sortControl.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(sortControl).toHaveTextContent("Most specimens");
    expect(location.history).toEqual(["/published", "/published?sort=specimens"]);
    expect(titles()).toEqual([
      "Northern Uganda cohort",
      "Maputo surveillance 2015 to 2019",
      "Border travellers, Mozambique and Eswatini",
    ]);
    // Sorting alone does not filter out entries.
    expect(screen.getByText("3 published PMOs")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear the filters" })).not.toBeInTheDocument();

    await choose(user, "Sort by", "Latest collection year");
    expect(location.history.at(-1)).toBe("/published?sort=year");
    expect(titles()).toEqual([
      "Northern Uganda cohort",
      "Maputo surveillance 2015 to 2019",
      "Border travellers, Mozambique and Eswatini",
    ]);

    await choose(user, "Sort by", "Title");
    expect(location.history.at(-1)).toBe("/published?sort=title");
    expect(titles()).toEqual([
      "Border travellers, Mozambique and Eswatini",
      "Maputo surveillance 2015 to 2019",
      "Northern Uganda cohort",
    ]);

    await choose(user, "Sort by", "Newest published");
    expect(location.history.at(-1)).toBe("/published");
    expect(titles()).toEqual([
      "Maputo surveillance 2015 to 2019",
      "Northern Uganda cohort",
      "Border travellers, Mozambique and Eswatini",
    ]);
  });

  it("orders a 150-entry catalogue by each sort choice and restores sort on Back", async () => {
    const user = userEvent.setup();
    const bigIndex = largeCatalogue(150);
    const loadBig = gives({ kind: "ready", index: bigIndex });
    window.history.replaceState(null, "", "/#/published");

    try {
      render(
        <I18nProvider i18n={i18n}>
          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/published">
                <PublishedPage load={loadBig} zenodo={ZENODO} />
              </Route>
              <Route path="/published/:id">
                {(params) => <DatasetPage id={params.id} load={loadBig} />}
              </Route>
            </Switch>
          </Router>
        </I18nProvider>,
      );

      await screen.findByText("150 published PMOs");
      expect(titles()[0]).toBe(bigIndex.datasets[0]?.title);

      await choose(user, "Sort by", "Most specimens");
      expect(window.location.hash).toBe("#/published?sort=specimens");
      const maxSpecimens = Math.max(...bigIndex.datasets.map((entry) => entry.summary.specimens));
      const mostSpecimensEntry = bigIndex.datasets.find(
        (entry) => entry.summary.specimens === maxSpecimens,
      );
      expect(titles()[0]).toBe(mostSpecimensEntry?.title);

      await choose(user, "Sort by", "Latest collection year");
      expect(window.location.hash).toBe("#/published?sort=year");
      const newest2026Entry = bigIndex.datasets.find(
        (entry) => entry.collectionYears?.last === 2026,
      );
      expect(titles()[0]).toBe(newest2026Entry?.title);

      await choose(user, "Sort by", "Title");
      expect(window.location.hash).toBe("#/published?sort=title");
      const firstTitle = titles()[0] ?? "";
      expect(firstTitle.startsWith("Angola ")).toBe(true);

      // Open the first dataset and press Back: sort order stays in place.
      await user.click(screen.getByRole("link", { name: firstTitle }));
      expect(
        await screen.findByRole("heading", { level: 1, name: firstTitle }),
      ).toBeInTheDocument();
      expect(window.location.hash).toMatch(/^#\/published\/\d+$/);

      window.history.back();
      expect(await screen.findByText("150 published PMOs")).toBeInTheDocument();
      expect(window.location.hash).toBe("#/published?sort=title");
      expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveTextContent("Title");
      expect(titles()[0]).toBe(firstTitle);
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("hides the coverage grid when the catalogue has fewer than 5 entries", async () => {
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper });
    await screen.findByText("3 published PMOs");
    expect(
      screen.queryByRole("button", { name: /Coverage by country and year/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the collapsible coverage grid for a large catalogue, filters on cell choice, and follows other filters", async () => {
    const user = userEvent.setup();
    const bigIndex = largeCatalogue(150);
    const { wrapper: listWrapper, location } = makeWrapper("/published");
    render(<PublishedPage load={gives({ kind: "ready", index: bigIndex })} zenodo={ZENODO} />, {
      wrapper: listWrapper,
    });
    await screen.findByText("150 published PMOs");

    const toggle = screen.getByRole("button", { name: /Coverage by country and year/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("26 countries, 2008 to 2026");

    await user.click(toggle);
    const grid = screen.getByRole("table", { name: "Specimens by country and collection year" });

    // Pick a populated cell directly from the made-up catalogue.
    const sampleEntry = bigIndex.datasets.find(
      (entry) => entry.countries.length > 0 && entry.collectionYears !== null,
    );
    if (sampleEntry === undefined || sampleEntry.collectionYears === null) {
      throw new Error("no sample entry with country and year");
    }
    const targetCountry = sampleEntry.countries[0] ?? "";
    const targetYear = sampleEntry.collectionYears.first;
    const expectedMatching = bigIndex.datasets.filter(
      (entry) =>
        entry.countries.includes(targetCountry) &&
        entry.collectionYears !== null &&
        targetYear >= entry.collectionYears.first &&
        targetYear <= entry.collectionYears.last,
    );
    const expectedSpecimens = expectedMatching.reduce(
      (sum, entry) => sum + entry.summary.specimens,
      0,
    );

    const cellButton = within(grid).getByRole("button", {
      name: new RegExp(
        `^${targetCountry}, ${targetYear}: ${formatCount(expectedSpecimens)} specimens? in ${expectedMatching.length} published PMOs?$`,
      ),
    });
    await user.click(cellButton);

    expect(location.history.at(-1)).toBe(
      `/published?${new URLSearchParams({ country: targetCountry, year: String(targetYear) }).toString()}`,
    );
    expect(countryButton()).toHaveTextContent(targetCountry);
    expect(screen.getByRole("combobox", { name: "Collected in" })).toHaveTextContent(
      String(targetYear),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      `${expectedMatching.length} of 150 published PMOs`,
    );
    expect(cellButton).toHaveAttribute("aria-pressed", "true");

    // Choosing the same selected cell again clears country and year.
    await user.click(cellButton);
    expect(location.history.at(-1)).toBe("/published");
    expect(screen.getByRole("status")).toHaveTextContent("150 published PMOs");

    // Filtering by species updates the coverage grid figures while preserving the grid for country/year choice.
    await choose(user, "Species", /^Plasmodium vivax \(\d+\)$/);
    const vivaxDatasets = bigIndex.datasets.filter((entry) => entry.taxa.includes(5855));
    const vivaxCountries = new Set(vivaxDatasets.flatMap((entry) => entry.countries));
    expect(within(grid).getAllByRole("rowheader")).toHaveLength(vivaxCountries.size);

    const vivaxEntry = vivaxDatasets.find(
      (entry) => entry.countries.length > 0 && entry.collectionYears !== null,
    );
    if (vivaxEntry === undefined || vivaxEntry.collectionYears === null) {
      throw new Error("no vivax entry");
    }
    const vivaxCountry = vivaxEntry.countries[0] ?? "";
    const vivaxYear = vivaxEntry.collectionYears.first;
    const vivaxCell = within(grid).getByRole("button", {
      name: new RegExp(`^${vivaxCountry}, ${vivaxYear}:`),
    });
    vivaxCell.focus();
    await user.keyboard("{Enter}");
    expect(location.history.at(-1)).toBe(
      `/published?${new URLSearchParams({
        country: vivaxCountry,
        species: "5855",
        year: String(vivaxYear),
      }).toString()}`,
    );

    // Search and panel filters also narrow the coverage grid.
    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    await choose(user, "Panel", /^PvGT-Seq \(\d+\)$/);
    const pvgtDatasets = bigIndex.datasets.filter((entry) => entry.panels.includes("PvGT-Seq"));
    const pvgtCountries = new Set(pvgtDatasets.flatMap((entry) => entry.countries));
    expect(within(grid).getAllByRole("rowheader")).toHaveLength(pvgtCountries.size);

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "nothing matches this");
    expect(
      screen.getByText("No matching published PMOs have both a country and a collection year."),
    ).toBeInTheDocument();
  });

  it("shortens long author lists to first author et al. and exposes full long titles on the link", async () => {
    const longTitle =
      "Longitudinal genomic surveillance of antimalarial drug resistance markers and parasite population connectivity across sentinel clinics in Kenya (2018 to 2024)";
    const entries = [
      dataset({
        id: "501",
        title: longTitle,
        creators: ["Okello, Grace", "Mensah, Kofi", "Achan, Sarah", "Diallo, Amadou"],
        published: "2026-11-14",
      }),
      dataset({
        id: "502",
        title: "Two authors study",
        creators: ["Okello, Grace", "Mensah, Kofi"],
        published: "2026-11-10",
      }),
    ];
    render(
      <PublishedPage load={gives({ kind: "ready", index: catalogue(entries) })} zenodo={ZENODO} />,
      { wrapper },
    );
    await screen.findByText("2 published PMOs");

    const link = screen.getByRole("link", { name: longTitle });
    expect(link).toHaveAttribute("title", longTitle);
    expect(screen.getByText("Okello, Grace et al. · 2026")).toBeInTheDocument();
    expect(screen.getByText("Okello, Grace; Mensah, Kofi · 2026")).toBeInTheDocument();
  });

  it("switches between list and table views, syncs table sorting with Sort by, and keeps view on Back", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/#/published");

    try {
      render(
        <I18nProvider i18n={i18n}>
          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/published">
                <PublishedPage load={READY} zenodo={ZENODO} />
              </Route>
              <Route path="/published/:id">
                {(params) => <DatasetPage id={params.id} load={READY} />}
              </Route>
            </Switch>
          </Router>
        </I18nProvider>,
      );

      await screen.findByText("3 published PMOs");
      const listButton = screen.getByRole("radio", { name: "List" });
      const tableButton = screen.getByRole("radio", { name: "Table" });
      expect(listButton).toHaveAttribute("aria-checked", "true");
      expect(tableButton).toHaveAttribute("aria-checked", "false");
      expect(screen.getAllByRole("article")).toHaveLength(3);

      await user.click(tableButton);
      expect(window.location.hash).toBe("#/published?view=table");
      expect(tableButton).toHaveAttribute("aria-checked", "true");
      expect(screen.queryByRole("article")).not.toBeInTheDocument();

      const table = screen.getByRole("table");
      const tableTitles = () =>
        within(table)
          .getAllByRole("row")
          .slice(1)
          .map((row) => within(row).getByRole("link").textContent);

      expect(tableTitles()).toEqual([
        "Maputo surveillance 2015 to 2019",
        "Northern Uganda cohort",
        "Border travellers, Mozambique and Eswatini",
      ]);

      // Sorting from the table column header updates Sort by and the address.
      const specimensHeader = within(table).getByRole("columnheader", { name: /Specimens/ });
      await user.click(within(specimensHeader).getByRole("button"));
      expect(window.location.hash).toBe("#/published?sort=specimens&view=table");
      expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveTextContent("Most specimens");
      expect(specimensHeader).toHaveAttribute("aria-sort", "descending");
      expect(tableTitles()).toEqual([
        "Northern Uganda cohort",
        "Maputo surveillance 2015 to 2019",
        "Border travellers, Mozambique and Eswatini",
      ]);

      // Filtering and clearing filters keeps the table view and sort order.
      await user.type(screen.getByRole("searchbox", { name: "Search" }), "uganda");
      expect(tableTitles()).toEqual(["Northern Uganda cohort"]);
      await user.click(screen.getByRole("button", { name: "Clear the filters" }));
      expect(window.location.hash).toBe("#/published?sort=specimens&view=table");
      expect(tableTitles()).toHaveLength(3);

      // Opening a dataset and pressing Back restores table view and sort.
      await user.click(within(table).getByRole("link", { name: "Northern Uganda cohort" }));
      expect(
        await screen.findByRole("heading", { level: 1, name: "Northern Uganda cohort" }),
      ).toBeInTheDocument();
      window.history.back();

      expect(await screen.findByRole("table")).toBeInTheDocument();
      expect(window.location.hash).toBe("#/published?sort=specimens&view=table");
      expect(screen.getByRole("radio", { name: "Table" })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveTextContent("Most specimens");

      // Switching back to List removes view from the address.
      await user.click(screen.getByRole("radio", { name: "List" }));
      expect(window.location.hash).toBe("#/published?sort=specimens");
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.getAllByRole("article")).toHaveLength(3);
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("renders 50 entries at first, adds 50 with focus on the first new entry, and hides Show more for 50 or fewer", async () => {
    const user = userEvent.setup();
    const bigIndex = largeCatalogue(150);
    const { wrapper: listWrapper, location } = makeWrapper("/published");
    const { unmount } = render(
      <PublishedPage load={gives({ kind: "ready", index: bigIndex })} zenodo={ZENODO} />,
      { wrapper: listWrapper },
    );
    await screen.findByText("150 published PMOs");

    expect(screen.getAllByRole("article")).toHaveLength(50);
    expect(screen.getByText("Showing 50 of 150 published PMOs")).toBeInTheDocument();
    // Totals still count all 150 matching entries, not only the 50 rendered.
    const totals = screen.getByRole("region", { name: "Totals" });
    expect(within(totals).getAllByRole("definition")[0]?.textContent).toBe("150");

    const showMore = screen.getByRole("button", { name: "Show more" });
    await user.click(showMore);

    expect(screen.getAllByRole("article")).toHaveLength(100);
    expect(screen.getByText("Showing 100 of 150 published PMOs")).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/published?shown=100");
    const entry51 = bigIndex.datasets[50];
    if (entry51 === undefined) throw new Error("missing 51st dataset");
    expect(document.activeElement).toBe(screen.getByRole("link", { name: entry51.title }));

    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(screen.getAllByRole("article")).toHaveLength(150);
    expect(screen.getByText("Showing 150 of 150 published PMOs")).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/published?shown=150");
    const entry101 = bigIndex.datasets[100];
    if (entry101 === undefined) throw new Error("missing 101st dataset");
    expect(document.activeElement).toBe(screen.getByRole("link", { name: entry101.title }));
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();

    // With 50 or fewer entries there is no Show more button.
    unmount();
    const { unmount: unmountFifty } = render(
      <PublishedPage load={gives({ kind: "ready", index: largeCatalogue(50) })} zenodo={ZENODO} />,
      { wrapper },
    );
    await screen.findByText("50 published PMOs");
    expect(screen.getAllByRole("article")).toHaveLength(50);
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();

    unmountFifty();
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper });
    await screen.findByText("3 published PMOs");
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("paginates table view by 50, moves focus to the first newly revealed row, and resets on column sort", async () => {
    const user = userEvent.setup();
    const bigIndex = largeCatalogue(150);
    const { wrapper: tableWrapper, location } = makeWrapper("/published?view=table");
    render(<PublishedPage load={gives({ kind: "ready", index: bigIndex })} zenodo={ZENODO} />, {
      wrapper: tableWrapper,
    });
    await screen.findByText("150 published PMOs");

    const table = screen.getByRole("table");
    const bodyRows = () => within(table).getAllByRole("row").slice(1);
    expect(bodyRows()).toHaveLength(50);
    expect(screen.getByText("Showing 50 of 150 published PMOs")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(bodyRows()).toHaveLength(100);
    expect(screen.getByText("Showing 100 of 150 published PMOs")).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/published?view=table&shown=100");
    const entry51 = bigIndex.datasets[50];
    if (entry51 === undefined) throw new Error("missing 51st dataset");
    expect(document.activeElement).toBe(within(table).getByRole("link", { name: entry51.title }));

    const specimensHeader = within(table).getByRole("columnheader", { name: /Specimens/ });
    await user.click(within(specimensHeader).getByRole("button"));
    expect(bodyRows()).toHaveLength(50);
    expect(location.history.at(-1)).toBe("/published?sort=specimens&view=table");
  });

  it("starts again from 50 when a filter, coverage cell or sort changes", async () => {
    const user = userEvent.setup();
    const bigIndex = largeCatalogue(150);
    const { wrapper: listWrapper, location } = makeWrapper("/published");
    render(<PublishedPage load={gives({ kind: "ready", index: bigIndex })} zenodo={ZENODO} />, {
      wrapper: listWrapper,
    });
    await screen.findByText("150 published PMOs");

    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByRole("article")).toHaveLength(100);
    expect(location.history.at(-1)).toBe("/published?shown=100");

    // Changing sort resets shown to 50.
    await choose(user, "Sort by", "Most specimens");
    expect(screen.getAllByRole("article")).toHaveLength(50);
    expect(location.history.at(-1)).toBe("/published?sort=specimens");

    // Expanding then filtering by species resets shown to 50 while Totals keep counting all matches.
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByRole("article")).toHaveLength(100);
    await choose(user, "Species", /^Plasmodium falciparum \(\d+\)$/);
    const falciparumCount = bigIndex.datasets.filter((entry) => entry.taxa.includes(5833)).length;
    expect(falciparumCount).toBeGreaterThan(50);
    expect(screen.getAllByRole("article")).toHaveLength(50);
    expect(location.history.at(-1)).toBe("/published?species=5833&sort=specimens");
    expect(screen.getByText(`Showing 50 of ${falciparumCount} published PMOs`)).toBeInTheDocument();
    const totals = screen.getByRole("region", { name: "Totals" });
    expect(within(totals).getAllByRole("definition")[0]?.textContent).toBe(String(falciparumCount));

    // Expanding then typing in Search resets shown to 50.
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByRole("article")).toHaveLength(100);
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "20");
    expect(screen.getAllByRole("article")).toHaveLength(50);
    expect(location.history.at(-1)).toBe("/published?q=20&species=5833&sort=specimens");

    // Expanding then clearing filters resets shown to 50.
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByRole("article")).toHaveLength(100);
    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    expect(screen.getAllByRole("article")).toHaveLength(50);
    expect(location.history.at(-1)).toBe("/published?sort=specimens");

    // Expanding then selecting a coverage cell resets shown to 50.
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByRole("article")).toHaveLength(100);
    await user.click(screen.getByRole("button", { name: /Coverage by country and year/ }));
    const grid = screen.getByRole("table", { name: "Specimens by country and collection year" });
    const populatedCell = within(grid).getByRole("button", {
      name: /^Angola, 2008: .+ in \d+ published PMOs?$/,
    });
    await user.click(populatedCell);
    expect(location.history.at(-1)).not.toContain("shown=");
  });

  it("restores how many entries were shown and scroll position when going Back from a dataset beyond 50", async () => {
    const user = userEvent.setup();
    const bigIndex = largeCatalogue(150);
    const loadBig = gives({ kind: "ready", index: bigIndex });
    window.history.replaceState(null, "", "/#/published");
    const scrollDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY");
    let currentScrollY = 0;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => currentScrollY,
    });
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
      const first = args[0];
      if (
        typeof first === "object" &&
        first !== null &&
        "top" in first &&
        typeof first.top === "number"
      ) {
        currentScrollY = first.top;
      }
    });

    try {
      render(
        <I18nProvider i18n={i18n}>
          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/published">
                <PublishedPage load={loadBig} zenodo={ZENODO} />
              </Route>
              <Route path="/published/:id">
                {(params) => <DatasetPage id={params.id} load={loadBig} />}
              </Route>
            </Switch>
          </Router>
        </I18nProvider>,
      );

      await screen.findByText("150 published PMOs");
      await user.click(screen.getByRole("button", { name: "Show more" }));
      expect(window.location.hash).toBe("#/published?shown=100");
      expect(screen.getAllByRole("article")).toHaveLength(100);

      currentScrollY = 3_200;
      window.dispatchEvent(new Event("scroll"));

      const entry60 = bigIndex.datasets[59];
      if (entry60 === undefined) throw new Error("missing 60th dataset");
      await user.click(screen.getByRole("link", { name: entry60.title }));
      expect(
        await screen.findByRole("heading", { level: 1, name: entry60.title }),
      ).toBeInTheDocument();

      scrollToSpy.mockClear();
      currentScrollY = 0;
      window.history.back();

      expect(await screen.findByText("Showing 100 of 150 published PMOs")).toBeInTheDocument();
      expect(window.location.hash).toBe("#/published?shown=100");
      expect(screen.getAllByRole("article")).toHaveLength(100);
      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledWith({ top: 3_200 });
      });
    } finally {
      window.history.replaceState(null, "", "/");
      if (scrollDescriptor !== undefined) {
        Object.defineProperty(window, "scrollY", scrollDescriptor);
      } else {
        Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
      }
    }
  });

  it("restores an expanded coverage grid before restoring scroll position on Back", async () => {
    const user = userEvent.setup();
    const bigIndex = largeCatalogue(150);
    const loadBig = gives({ kind: "ready", index: bigIndex });
    window.history.replaceState(null, "", "/#/published");
    const scrollDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY");
    let currentScrollY = 0;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => currentScrollY,
    });
    let coverageExpandedAtScroll = false;
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
      const first = args[0];
      if (
        typeof first === "object" &&
        first !== null &&
        "top" in first &&
        typeof first.top === "number"
      ) {
        if (first.top === 1_450) {
          coverageExpandedAtScroll =
            document.querySelector('[data-testid="coverage-scroll"]') !== null;
        }
        currentScrollY = first.top;
      }
    });

    try {
      render(
        <I18nProvider i18n={i18n}>
          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/published">
                <PublishedPage load={loadBig} zenodo={ZENODO} />
              </Route>
              <Route path="/published/:id">
                {(params) => <DatasetPage id={params.id} load={loadBig} />}
              </Route>
            </Switch>
          </Router>
        </I18nProvider>,
      );

      await screen.findByText("150 published PMOs");
      const toggle = screen.getByRole("button", { name: /Coverage by country and year/ });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("coverage-scroll")).toBeInTheDocument();

      currentScrollY = 1_450;
      window.dispatchEvent(new Event("scroll"));

      const targetEntry = bigIndex.datasets[12];
      if (targetEntry === undefined) throw new Error("missing 13th dataset");
      await user.click(screen.getByRole("link", { name: targetEntry.title }));
      expect(
        await screen.findByRole("heading", { level: 1, name: targetEntry.title }),
      ).toBeInTheDocument();

      scrollToSpy.mockClear();
      coverageExpandedAtScroll = false;
      currentScrollY = 0;
      window.history.back();

      expect(await screen.findByText("150 published PMOs")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Coverage by country and year/ })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(screen.getByTestId("coverage-scroll")).toBeInTheDocument();
      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledWith({ top: 1_450 });
      });
      expect(coverageExpandedAtScroll).toBe(true);
    } finally {
      window.history.replaceState(null, "", "/");
      if (scrollDescriptor !== undefined) {
        Object.defineProperty(window, "scrollY", scrollDescriptor);
      } else {
        Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
      }
    }
  });

  it("operates CountryFilter and ViewSwitch from the keyboard", async () => {
    const user = userEvent.setup();
    const { wrapper: listWrapper, location } = makeWrapper("/published");
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper: listWrapper });
    await screen.findByText("3 published PMOs");

    // CountryFilter: open via Enter, filter by typing, select with Tab + Space, close with Escape.
    const trigger = countryButton();
    trigger.focus();
    await user.keyboard("{Enter}");

    const search = await screen.findByRole("searchbox", { name: "Filter countries" });
    expect(search).toHaveFocus();
    await user.keyboard("uganda");
    const ugandaCheckbox = screen.getByRole("checkbox", { name: "Uganda (1)" });
    await user.tab();
    expect(ugandaCheckbox).toHaveFocus();
    await user.keyboard(" ");
    expect(ugandaCheckbox).toBeChecked();
    await user.keyboard("{Escape}");

    expect(location.history.at(-1)).toBe("/published?country=Uganda");
    expect(titles()).toEqual(["Northern Uganda cohort"]);
    expect(countryButton()).toHaveTextContent("Uganda");

    // Re-open via Space and clear the selected country from the keyboard.
    countryButton().focus();
    await user.keyboard(" ");
    const clearCountries = await screen.findByRole("button", { name: "Clear countries" });
    clearCountries.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");
    expect(location.history.at(-1)).toBe("/published");
    expect(titles()).toHaveLength(3);

    // ViewSwitch (SegmentedControl): switch between List and Table with arrow keys and Space/Enter.
    const listRadio = screen.getByRole("radio", { name: "List" });
    const tableRadio = screen.getByRole("radio", { name: "Table" });
    listRadio.focus();
    expect(listRadio).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(tableRadio).toHaveFocus();
    await user.keyboard(" ");

    expect(tableRadio).toHaveAttribute("aria-checked", "true");
    expect(location.history.at(-1)).toBe("/published?view=table");
    expect(screen.getByRole("table")).toBeInTheDocument();

    await user.keyboard("{ArrowLeft}");
    expect(listRadio).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(listRadio).toHaveAttribute("aria-checked", "true");
    expect(location.history.at(-1)).toBe("/published");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("DatasetPage", () => {
  it("shows what the PMO holds, where to get it and how to cite it", async () => {
    const user = userEvent.setup();
    render(<DatasetPage id="303" load={READY} />, { wrapper });
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Border travellers, Mozambique and Eswatini",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Okello, Grace; Mensah, Kofi")).toBeInTheDocument();
    expect(screen.getByText("Published 14 November 2026")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "See its summary" })).toHaveAttribute(
      "href",
      "/published/303/summary",
    );
    const download = screen.getByRole("link", { name: /download from zenodo/i });
    expect(download).toHaveAttribute(
      "href",
      "https://zenodo.org/api/records/303/files/study.pmo.json.gz/content",
    );
    expect(download).toHaveAttribute("rel", "noreferrer noopener");
    expect(screen.getByText("study.pmo.json.gz, 22 KB")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see the record on zenodo/i })).toHaveAttribute(
      "href",
      "https://zenodo.org/records/303",
    );

    const details = screen.getByRole("region", { name: "About the data" });
    expect(within(details).getByText("Mad4hatter, AMPLseq")).toBeInTheDocument();
    expect(within(details).getByText("Eswatini, Mozambique")).toBeInTheDocument();
    expect(
      within(details).getByText("Plasmodium falciparum, Plasmodium vivax"),
    ).toBeInTheDocument();
    expect(within(details).queryByText("Collected")).not.toBeInTheDocument();
    expect(within(details).getByRole("link", { name: /10\.5281\/zenodo\.303/ })).toHaveAttribute(
      "href",
      "https://doi.org/10.5281/zenodo.303",
    );
    expect(screen.getByRole("region", { name: "What is in the PMO" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy citation" }));
    expect(await navigator.clipboard.readText()).toBe(
      "Okello, Grace; Mensah, Kofi (2026). Border travellers, Mozambique and Eswatini. Zenodo. https://doi.org/10.5281/zenodo.303",
    );
    expect(screen.getByRole("link", { name: "All published PMOs" })).toHaveAttribute(
      "href",
      "/published",
    );
  });

  it("says so when the PMO is not in the list and renders an h1 heading", async () => {
    render(<DatasetPage id="999" load={READY} />, { wrapper });
    expect(await screen.findByText("This PMO is not in the list")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Published PMO" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All published PMOs" })).toBeInTheDocument();
  });

  it("renders a Published PMO h1 in loading, missing and error fallback states", async () => {
    const { unmount: unmountLoading } = render(<DatasetPage id="301" load={PENDING} />, {
      wrapper,
    });
    expect(screen.getByRole("heading", { level: 1, name: "Published PMO" })).toBeInTheDocument();
    unmountLoading();

    const { unmount: unmountMissing } = render(
      <DatasetPage id="301" load={gives({ kind: "missing" })} />,
      { wrapper },
    );
    expect(
      await screen.findByText("This copy of PMO Builder has no list of published PMOs"),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Published PMO" })).toBeInTheDocument();
    unmountMissing();

    render(<DatasetPage id="301" load={gives({ kind: "failed" })} />, { wrapper });
    expect(
      await screen.findByText("The list of published PMOs could not be loaded"),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Published PMO" })).toBeInTheDocument();
  });
});
